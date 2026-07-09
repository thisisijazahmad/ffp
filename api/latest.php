<?php
/** GET /api/cities/{id}/latest — full current record for one city. */
require __DIR__ . '/lib/respond.php';

$id = preg_replace('/[^a-z0-9\-]/', '', strtolower($_GET['id'] ?? ''));
if ($id === '') send_json(['error' => 'missing_id', 'message' => 'Provide ?id=<city>'], 400);

$latest = require_store($cfg);
$city = find_city($latest, $id);
if (!$city) send_json(['error' => 'not_found', 'message' => "Unknown city: $id"], 404);

// Decorate each pollutant with its unit + AQI sub-index band for the UI.
$pollutants = [];
foreach ($cfg['parameters'] as $param => $meta) {
    $val = $city['pollutants'][$param] ?? null;
    if ($val === null) continue;
    $sub = $city['subindices'][$param] ?? null;
    $pollutants[] = [
        'param'    => $param,
        'label'    => $meta['label'],
        'value'    => $val,
        'unit'     => $meta['unit'],
        'subindex' => $sub,
        'family'   => $meta['family'] ?? null,
        'measured' => in_array($param, $city['measuredParams'] ?? [], true),
        'band'     => $sub !== null ? aqi_band($sub) : null,
    ];
}

send_json([
    'generatedAt' => $latest['generatedAt'],
    'city' => [
        'id' => $city['id'], 'name' => $city['name'], 'province' => $city['province'],
        'lat' => $city['lat'], 'lon' => $city['lon'],
    ],
    'aqi'        => $city['aqi'],
    'band'       => $city['band'],
    'color'      => $city['color'],
    'dominant'   => $city['dominant'],
    'pollutants' => $pollutants,
    'source'     => $city['source'],
    'station'    => $city['station'],
    'license'    => $city['license'],
    'measured'   => $city['measured'],
    'measuredAt' => $city['measuredAt'],
    'status'     => $city['status'],
    'stale'      => $city['stale'],
    'families'   => $cfg['families'] ?? [],
    'unavailable'=> array_values($cfg['unavailable'] ?? []),
]);
