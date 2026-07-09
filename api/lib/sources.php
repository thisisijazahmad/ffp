<?php
/**
 * Data-source adapters. Each returns a normalised hourly series for one city:
 *
 *   [
 *     'source'  => 'OpenAQ' | 'Open-Meteo',
 *     'station' => 'human readable station/source name',
 *     'license' => 'CC BY 4.0',
 *     'times'   => [ISO8601, ...]                 // oldest -> newest
 *     'series'  => ['pm2_5' => [..], 'pm10'=>[..], ...]  // aligned to times, µg/m³
 *   ]
 *
 * Open-Meteo needs no key and covers all 20 cities (CAMS model). OpenAQ uses
 * measured ground stations but needs a free key and has patchy PK coverage,
 * so it is the primary measurement source with Open-Meteo as the gap-filler.
 */

function http_get_json(string $url, array $headers = [], int $timeout = 20): ?array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $headers),
        CURLOPT_USERAGENT => 'FairFinancePakistan-AQ/1.0',
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) { fwrite(STDERR, "HTTP error: $err\n"); return null; }
    if ($code >= 400)    { fwrite(STDERR, "HTTP $code for $url\n"); return null; }
    $json = json_decode($body, true);
    return is_array($json) ? $json : null;
}

/* ---------------- Open-Meteo (no key) ---------------- */

function source_open_meteo(array $cfg, array $city): ?array
{
    $params = ['pm2_5', 'pm10', 'ozone', 'nitrogen_monoxide', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide', 'methane'];
    $past = max(2, (int) $cfg['ingest_lookback_days']);
    $url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
        . '?latitude=' . $city['lat'] . '&longitude=' . $city['lon']
        . '&hourly=' . implode(',', $params)
        . '&past_days=' . $past . '&forecast_days=1'
        . '&timezone=' . rawurlencode($cfg['timezone']);

    $data = http_get_json($url);
    if (!$data || empty($data['hourly']['time'])) return null;

    $h = $data['hourly'];
    $series = [];
    foreach ($params as $p) {
        $series[$p] = $h[$p] ?? array_fill(0, count($h['time']), null);
    }
    return [
        'source'  => 'Open-Meteo (CAMS model)',
        'station' => 'Open-Meteo air-quality reanalysis',
        'license' => 'CC BY 4.0',
        'times'   => $h['time'],   // local wall-clock in $cfg timezone
        'series'  => $series,
        'measured' => false,       // model, not a ground sensor
    ];
}

/* ---------------- OpenAQ v3 (free key) ---------------- */

function source_openaq(array $cfg, array $city): ?array
{
    $key = $cfg['openaq_api_key'];
    if (!$key) return null;
    $headers = ['X-API-Key: ' . $key];

    // 1) Nearby stations within radius. NOTE: no `order_by=distance` — that
    // parameter makes OpenAQ v3 return HTTP 422. Radius already bounds results.
    $locUrl = 'https://api.openaq.org/v3/locations'
        . '?coordinates=' . $city['lat'] . ',' . $city['lon']
        . '&radius=' . (int) $cfg['openaq_radius_m']
        . '&limit=25';
    $loc = http_get_json($locUrl, $headers);
    if (empty($loc['results'])) return null;

    // OpenAQ sensor names -> our keys. Measured overlay is limited to the
    // particulates ground sensors report reliably in µg/m³ (esp. PM1, which
    // the model has no equivalent for).
    $map  = ['pm25' => 'pm2_5', 'pm2_5' => 'pm2_5', 'pm10' => 'pm10', 'pm1' => 'pm1'];
    $want = ['pm1', 'pm2_5', 'pm10'];

    $point = []; $ts = null; $stationName = null; $calls = 0;
    foreach ($loc['results'] as $location) {
        $missing = array_diff($want, array_keys($point));
        if (!$missing || $calls >= 4) break;

        // Map this station's sensor ids -> our keys; skip stations with nothing new.
        $sensorParam = []; $offers = false;
        foreach (($location['sensors'] ?? []) as $s) {
            $n = strtolower($s['parameter']['name'] ?? '');
            if (!isset($map[$n])) continue;
            $sensorParam[$s['id']] = $map[$n];
            if (in_array($map[$n], $missing, true)) $offers = true;
        }
        if (!$offers) continue;

        $latest = http_get_json('https://api.openaq.org/v3/locations/' . $location['id'] . '/latest?limit=100', $headers);
        $calls++;
        usleep(150000); // pace sub-requests under the free-tier rate limit
        if (empty($latest['results'])) continue;

        foreach ($latest['results'] as $m) {
            $sid = $m['sensorsId'] ?? null;
            $ourKey = ($sid !== null) ? ($sensorParam[$sid] ?? null) : null;
            if ($ourKey === null || !in_array($ourKey, $want, true) || isset($point[$ourKey])) continue;
            $val = $m['value'] ?? null;
            if ($val === null) continue;
            $point[$ourKey] = round((float) $val, 1); // PM reported in µg/m³
            $ts = $m['datetime']['utc'] ?? $ts;
            if ($stationName === null) $stationName = $location['name'] ?? ('OpenAQ #' . $location['id']);
        }
    }
    if (!$point) return null;

    $iso = $ts ? date('Y-m-d\TH:i', strtotime($ts)) : date('Y-m-d\TH:i');
    $series = [];
    foreach (array_keys($cfg['parameters']) as $p) $series[$p] = [$point[$p] ?? null];
    return [
        'source'   => 'OpenAQ',
        'station'  => $stationName ?? 'OpenAQ',
        'license'  => 'CC BY 4.0',
        'times'    => [$iso],
        'series'   => $series,
        'measured' => true,
        'measuredParams' => array_keys($point),
    ];
}

/** Convert gas concentrations to µg/m³ when OpenAQ reports ppm/ppb. */
function openaq_to_ugm3(string $param, float $value, string $unit): float
{
    $unit = trim($unit);
    if ($unit === '' || str_contains($unit, 'µg') || str_contains($unit, 'ug')) return $value;
    // molecular weights for the ideal-gas conversion at 25°C, 1 atm
    $mw = ['ozone' => 48, 'nitrogen_dioxide' => 46, 'sulphur_dioxide' => 64, 'carbon_monoxide' => 28];
    if (!isset($mw[$param])) return $value;
    $ppb = str_contains($unit, 'ppm') ? $value * 1000 : $value; // assume ppb otherwise
    return $ppb * $mw[$param] / 24.45;
}

/* ---------------- Dispatcher ---------------- */

function source_fetch(array $cfg, array $city): ?array
{
    // Model is the reliable base (full hourly series, all model params + NO).
    $base = source_open_meteo($cfg, $city);

    // If explicitly forced to a single source, honour that.
    if ($cfg['source'] === 'open-meteo') return $base;
    if (!$cfg['openaq_api_key']) return $base;

    // Otherwise overlay measured PM (incl. PM1) from the nearest ground station
    // onto the newest model hour — gases stay model-based, so nothing regresses.
    $meas = source_openaq($cfg, $city);
    if ($cfg['source'] === 'openaq' && !$base) return $meas; // model down, forced openaq
    if (!$base) return $meas;
    if (!$meas) return $base;

    // Only overlay if the measured point is reasonably fresh (<= 6h old).
    $measTs = strtotime($meas['times'][0] ?? '');
    if (!$measTs || (time() - $measTs) > 6 * 3600) return $base;

    $last = count($base['times']) - 1;
    $overlaid = [];
    foreach ($meas['series'] as $p => $vals) {
        $v = end($vals);
        if ($v === null || !is_numeric($v)) continue;
        if (empty($base['series'][$p]) || !is_array($base['series'][$p])) {
            $base['series'][$p] = array_fill(0, count($base['times']), null);
        }
        $base['series'][$p][$last] = $v;
        $overlaid[] = $p;
    }
    if ($overlaid) {
        $base['station'] = $meas['station'] . ' (measured PM) + Open-Meteo (model)';
        $base['measured'] = true;
        $base['measuredParams'] = $overlaid;
    }
    return $base;
}
