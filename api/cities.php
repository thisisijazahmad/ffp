<?php
/** GET /api/cities — list of cities with coordinates and which params have data. */
require __DIR__ . '/lib/respond.php';

$latest = require_store($cfg);
$out = [];
foreach ($latest['cities'] as $c) {
    $available = [];
    foreach (($c['pollutants'] ?? []) as $param => $val) {
        if ($val !== null) $available[] = $param;
    }
    $out[] = [
        'id'         => $c['id'],
        'name'       => $c['name'],
        'province'   => $c['province'],
        'lat'        => $c['lat'],
        'lon'        => $c['lon'],
        'aqi'        => $c['aqi'],
        'band'       => $c['band'],
        'color'      => $c['color'],
        'status'     => $c['status'],
        'parameters' => $available,
    ];
}

send_json([
    'generatedAt' => $latest['generatedAt'],
    'timezone'    => $latest['timezone'],
    'count'       => count($out),
    'cities'      => $out,
]);
