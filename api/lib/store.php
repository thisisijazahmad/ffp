<?php
/**
 * Normalised JSON store + cache layer.
 *
 * The site is served entirely from this store; endpoints never call the
 * upstream API live. The ingest job writes here once per hour.
 *
 *   data/latest.json        -> snapshot of every city's current AQI
 *   data/history/{id}.json  -> rolling hourly history per city
 *   data/meta.json          -> last ingest run metadata
 */

function store_paths(array $cfg): array
{
    $dir = $cfg['data_dir'];
    return [
        'dir'     => $dir,
        'history' => $dir . '/history',
        'latest'  => $dir . '/latest.json',
        'meta'    => $dir . '/meta.json',
    ];
}

function store_init(array $cfg): void
{
    $p = store_paths($cfg);
    if (!is_dir($p['dir']))     @mkdir($p['dir'], 0775, true);
    if (!is_dir($p['history'])) @mkdir($p['history'], 0775, true);
}

/** Atomic JSON write (temp file + rename) so readers never see half a file. */
function store_write(string $path, $data): bool
{
    $tmp = $path . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) return false;
    if (file_put_contents($tmp, $json, LOCK_EX) === false) return false;
    return rename($tmp, $path);
}

function store_read(string $path)
{
    if (!is_file($path)) return null;
    $raw = file_get_contents($path);
    if ($raw === false) return null;
    return json_decode($raw, true);
}

function store_history_path(array $cfg, string $cityId): string
{
    return store_paths($cfg)['history'] . '/' . preg_replace('/[^a-z0-9\-]/', '', $cityId) . '.json';
}

/**
 * Merge new hourly rows into a city's history, de-duplicating by timestamp and
 * pruning beyond the retention window. Each row: ['t' => ISO8601, params...].
 */
function store_merge_history(array $cfg, string $cityId, array $rows): void
{
    $path = store_history_path($cfg, $cityId);
    $existing = store_read($path) ?: [];

    $byTime = [];
    foreach ($existing as $r) { if (isset($r['t'])) $byTime[$r['t']] = $r; }
    foreach ($rows as $r)     { if (isset($r['t'])) $byTime[$r['t']] = $r; }

    $cutoff = time() - ($cfg['history_retention_days'] * 86400);
    $merged = [];
    foreach ($byTime as $t => $r) {
        if (strtotime($t) >= $cutoff) $merged[] = $r;
    }
    usort($merged, fn($a, $b) => strcmp($a['t'], $b['t']));
    store_write($path, $merged);
}
