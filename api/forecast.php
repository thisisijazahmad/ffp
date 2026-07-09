<?php
/**
 * GET /api/forecast?id={city} — 7-day model-based air-quality forecast.
 *
 * Sourced from the Open-Meteo (CAMS) air-quality FORECAST endpoint. This is a
 * numerical-model prediction, not a measurement — the UI labels it as such and
 * shows a horizon-based confidence (forecasts degrade with lead time). Cached
 * per city for a few hours so we don't hammer upstream on every page view.
 */
require __DIR__ . '/lib/respond.php';

$id = preg_replace('/[^a-z0-9\-]/', '', strtolower($_GET['id'] ?? ''));
if ($id === '') send_json(['error' => 'missing_id', 'message' => 'Provide ?id=<city>'], 400);

$city = null;
foreach ($cfg['cities'] as $c) { if ($c['id'] === $id) { $city = $c; break; } }
if (!$city) send_json(['error' => 'not_found', 'message' => "Unknown city: $id"], 404);

// Serve from a short-lived cache when fresh.
$cacheDir = $cfg['data_dir'] . '/forecast';
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0775, true);
$cacheFile = $cacheDir . '/' . $id . '.json';
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < 3 * 3600) {
    $cached = json_decode(file_get_contents($cacheFile), true);
    if ($cached) send_json($cached);
}

// Forecast pollutants available from the model (no PM1 — that's measured-only).
$params = ['pm2_5', 'pm10', 'ozone', 'nitrogen_monoxide', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide', 'methane'];

$url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
    . '?latitude=' . $city['lat'] . '&longitude=' . $city['lon']
    . '&hourly=' . implode(',', $params)
    . '&forecast_days=7&past_days=0'
    . '&timezone=' . rawurlencode($cfg['timezone']);

$data = forecast_get($url);
if (!$data || empty($data['hourly']['time'])) {
    // Fall back to a stale cache if we have one, else error.
    if (is_file($cacheFile)) { $old = json_decode(file_get_contents($cacheFile), true); if ($old) send_json($old); }
    send_json(['error' => 'upstream', 'message' => 'Forecast source unavailable'], 502);
}

$h = $data['hourly'];
$byDay = [];
foreach ($h['time'] as $i => $t) {
    $day = substr($t, 0, 10);
    if (!isset($byDay[$day])) {
        $byDay[$day] = ['sum' => array_fill_keys($params, 0.0), 'cnt' => array_fill_keys($params, 0), 'peak' => null, 'dominant' => null];
    }
    $hourSeries = [];
    foreach ($params as $p) {
        $v = $h[$p][$i] ?? null;
        $hourSeries[$p] = [is_numeric($v) ? $v : null];
        if (is_numeric($v)) { $byDay[$day]['sum'][$p] += $v; $byDay[$day]['cnt'][$p]++; }
    }
    $roll = aqi_rollup($hourSeries, 'latest');
    if ($roll['aqi'] !== null && ($byDay[$day]['peak'] === null || $roll['aqi'] > $byDay[$day]['peak'])) {
        $byDay[$day]['peak'] = $roll['aqi'];
        $byDay[$day]['dominant'] = $roll['dominant'];
    }
}

$days = []; $di = 0;
foreach ($byDay as $day => $agg) {
    $poll = [];
    foreach ($params as $p) $poll[$p] = $agg['cnt'][$p] ? round($agg['sum'][$p] / $agg['cnt'][$p], 1) : null;
    $days[] = [
        'date'       => $day,
        'aqi'        => $agg['peak'],
        'band'       => aqi_band($agg['peak']),
        'dominant'   => $agg['dominant'],
        'confidence' => $di <= 1 ? 'High' : ($di <= 4 ? 'Medium' : 'Low'),
        'pollutants' => $poll,
    ];
    if (++$di >= 7) break;
}

// Pollutant labels/units for the forecast table.
$paramMeta = [];
foreach ($params as $p) {
    $m = $cfg['parameters'][$p] ?? null;
    $paramMeta[] = ['param' => $p, 'label' => $m['label'] ?? $p, 'unit' => $m['unit'] ?? 'µg/m³', 'family' => $m['family'] ?? null];
}

$resp = [
    'id'          => $id,
    'city'        => ['name' => $city['name'], 'province' => $city['province']],
    'source'      => 'Open-Meteo (CAMS model)',
    'model'       => true,
    'generatedAt' => date('c'),
    'horizonDays' => count($days),
    'parameters'  => $paramMeta,
    'unavailable' => array_values($cfg['unavailable'] ?? []),
    'days'        => $days,
];

@file_put_contents($cacheFile, json_encode($resp, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
send_json($resp);

/** Minimal cURL JSON GET (web-safe — no STDERR use). */
function forecast_get(string $url): ?array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_USERAGENT => 'FairFinancePakistan-AQ/1.0',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $code >= 400) return null;
    $json = json_decode($body, true);
    return is_array($json) ? $json : null;
}
