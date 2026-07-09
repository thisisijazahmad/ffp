<?php
/** GET /api/ranking — cities sorted by current AQI (most polluted first). */
require __DIR__ . '/lib/respond.php';

$latest = require_store($cfg);

$ranked = array_values(array_filter($latest['cities'], fn($c) => $c['aqi'] !== null));
usort($ranked, fn($a, $b) => $b['aqi'] <=> $a['aqi']);

$out = [];
$rank = 1;
foreach ($ranked as $c) {
    $out[] = [
        'rank'     => $rank++,
        'id'       => $c['id'],
        'name'     => $c['name'],
        'province' => $c['province'],
        'aqi'      => $c['aqi'],
        'band'     => $c['band'],
        'color'    => $c['color'],
        'dominant' => $c['dominant'],
        'status'   => $c['status'],
    ];
}

send_json([
    'generatedAt' => $latest['generatedAt'],
    'count'       => count($out),
    'ranking'     => $out,
]);
