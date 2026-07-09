<?php
/** Shared endpoint bootstrap: config, JSON headers, CORS, cache, store helpers. */

$cfg = require __DIR__ . '/../config.php';
require __DIR__ . '/aqi.php';
require __DIR__ . '/store.php';

date_default_timezone_set($cfg['timezone']);

function send_json($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Cache-Control: public, max-age=120'); // served from hourly store
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function require_store(array $cfg): array
{
    $latest = store_read(store_paths($cfg)['latest']);
    if (!$latest) {
        send_json([
            'error' => 'store_empty',
            'message' => 'Ingest has not run yet. Run: php api/ingest.php',
        ], 503);
    }
    return $latest;
}

function find_city(array $latest, string $id): ?array
{
    foreach ($latest['cities'] as $c) {
        if ($c['id'] === $id) return $c;
    }
    return null;
}
