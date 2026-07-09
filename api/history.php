<?php
/** GET /api/cities/{id}/history?range=24h|7d|30d — hourly trend series. */
require __DIR__ . '/lib/respond.php';

$id = preg_replace('/[^a-z0-9\-]/', '', strtolower($_GET['id'] ?? ''));
if ($id === '') send_json(['error' => 'missing_id', 'message' => 'Provide ?id=<city>'], 400);

$range = $_GET['range'] ?? '24h';
$spans = ['24h' => 86400, '7d' => 7 * 86400, '30d' => 30 * 86400, '365d' => 365 * 86400];
$span = $spans[$range] ?? $spans['24h'];

$rows = store_read(store_history_path($cfg, $id));
if ($rows === null) send_json(['error' => 'not_found', 'message' => "No history for: $id"], 404);

$cutoff = time() - $span;
$rows = array_values(array_filter($rows, fn($r) => isset($r['t']) && strtotime($r['t']) >= $cutoff));

// Downsample longer views to keep payloads small: 30d -> daily, 365d -> weekly.
if ($range === '30d' || $range === '365d') {
    $weekly = ($range === '365d');
    $buckets = [];
    foreach ($rows as $r) {
        $key = $weekly ? date('o-\WW', strtotime($r['t'])) : substr($r['t'], 0, 10);
        $buckets[$key][] = $r;
    }
    $rows = [];
    foreach ($buckets as $group) {
        $agg = ['t' => substr($group[0]['t'], 0, 10) . 'T12:00'];
        foreach (array_keys($cfg['parameters']) as $p) {
            $vals = array_filter(array_column($group, $p), fn($v) => is_numeric($v));
            $agg[$p] = $vals ? round(array_sum($vals) / count($vals), 1) : null;
        }
        $aqis = array_filter(array_column($group, 'aqi'), fn($v) => is_numeric($v));
        $agg['aqi'] = $aqis ? (int) round(array_sum($aqis) / count($aqis)) : null;
        $rows[] = $agg;
    }
}

send_json([
    'id'     => $id,
    'range'  => $range,
    'count'  => count($rows),
    'series' => $rows,
]);
