<?php
/**
 * Scheduled ingest job — Fair Finance Pakistan AQ pipeline.
 *
 * Run once per hour, a few minutes after the top of the hour:
 *   php api/ingest.php                 (CLI)
 *   http://<site>/api/ingest.php?key=  (web, if INGEST_TOKEN set)
 *
 * Coverage probe (the §7 availability table):
 *   php api/ingest.php --probe         -> CSV of which params each city reports
 *
 * It fetches each city from the configured source, computes the NowCast/AQI
 * band, writes the normalised store and merges hourly history. The public
 * endpoints then serve from the store — upstream is never called per request.
 */

$cfg = require __DIR__ . '/config.php';
require __DIR__ . '/lib/aqi.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/sources.php';

date_default_timezone_set($cfg['timezone']);

$isCli   = (PHP_SAPI === 'cli');
$argvArr = $isCli ? $argv : [];
$probe   = in_array('--probe', $argvArr, true) || (isset($_GET['probe']));

// Simple optional protection for the web trigger.
if (!$isCli) {
    header('Content-Type: text/plain; charset=utf-8');
    $token = getenv('INGEST_TOKEN') ?: '';
    if ($token && ($_GET['key'] ?? '') !== $token) {
        http_response_code(403);
        exit("Forbidden: missing or invalid ingest token.\n");
    }
}

store_init($cfg);

// One-time backfill: pull ~365 days of model history so the 365-day/52-week
// trend view is populated.  Run once:  php api/ingest.php --backfill
if (in_array('--backfill', $argvArr, true) || isset($_GET['backfill'])) {
    run_backfill($cfg);
    exit;
}

$nowTs = time();
$staleSeconds = $cfg['stale_hours'] * 3600;
$snapshot = [];
$coverage = [];
$ok = 0; $stale = 0; $fail = 0;

foreach ($cfg['cities'] as $city) {
    $fetched = source_fetch($cfg, $city);

    if (!$fetched || empty($fetched['times'])) {
        $snapshot[] = city_record($city, null, $nowTs, $staleSeconds);
        $coverage[$city['id']] = array_fill_keys(array_keys($cfg['parameters']), false);
        $fail++;
        log_line("✗ {$city['name']}: no data");
        usleep(300000);
        continue;
    }

    // Build newest-first arrays per parameter for the AQI rollup.
    $times = $fetched['times'];
    $n = count($times);
    $newestFirst = [];
    $latestPoint = [];
    $present = [];
    foreach ($fetched['series'] as $param => $vals) {
        $rev = array_reverse(array_slice($vals, max(0, $n - 12)));
        $newestFirst[$param] = $rev;
        // latest non-null value for the tile display
        $latestPoint[$param] = null;
        foreach ($rev as $v) { if (is_numeric($v)) { $latestPoint[$param] = round($v, 1); break; } }
        $present[$param] = ($latestPoint[$param] !== null);
    }
    $coverage[$city['id']] = $present;

    $roll = aqi_rollup($newestFirst, $cfg['headline_mode']);
    $measuredAt = $times[$n - 1];
    $measuredTs = strtotime($measuredAt);
    $age = $nowTs - $measuredTs;
    $status = ($age > $staleSeconds) ? 'stale' : 'ok';
    if ($status === 'stale') $stale++; else $ok++;

    $snapshot[] = [
        'id'        => $city['id'],
        'name'      => $city['name'],
        'province'  => $city['province'],
        'lat'       => $city['lat'],
        'lon'       => $city['lon'],
        'aqi'       => $roll['aqi'],
        'band'      => $roll['band']['label'],
        'color'     => $roll['band']['color'],
        'textColor' => $roll['band']['text'],
        'dominant'  => $roll['dominant'],
        'pollutants'=> $latestPoint,
        'subindices'=> $roll['subindices'],
        'source'    => $fetched['source'],
        'station'   => $fetched['station'],
        'license'   => $fetched['license'],
        'measured'  => $fetched['measured'] ?? false,
        'measuredParams' => $fetched['measuredParams'] ?? [],
        'measuredAt'=> $measuredAt,
        'status'    => $status,
        'stale'     => $status === 'stale',
    ];

    // Append hourly rows (with per-hour AQI) to history.
    $rows = [];
    foreach ($times as $i => $t) {
        $row = ['t' => $t];
        $hourSeries = [];
        foreach ($fetched['series'] as $param => $vals) {
            $row[$param] = isset($vals[$i]) && is_numeric($vals[$i]) ? round($vals[$i], 1) : null;
            $hourSeries[$param] = [$row[$param]];
        }
        $row['aqi'] = aqi_rollup($hourSeries, 'latest')['aqi'];
        $rows[] = $row;
    }
    store_merge_history($cfg, $city['id'], $rows);

    log_line(sprintf("✓ %-16s AQI %-4s %-22s [%s] %s",
        $city['name'],
        $roll['aqi'] ?? '--',
        $roll['band']['label'],
        $fetched['source'],
        $status === 'stale' ? '(STALE)' : ''
    ));

    usleep(300000); // pace requests (well under OpenAQ's ~60/min limit)
}

store_write(store_paths($cfg)['latest'], [
    'generatedAt' => date('c'),
    'timezone'    => $cfg['timezone'],
    'headlineMode'=> $cfg['headline_mode'],
    'cities'      => $snapshot,
]);

store_write(store_paths($cfg)['meta'], [
    'lastRun'     => date('c'),
    'cityCount'   => count($cfg['cities']),
    'ok'          => $ok,
    'stale'       => $stale,
    'failed'      => $fail,
    'source'      => $cfg['source'],
]);

log_line("\nDone: $ok ok · $stale stale · $fail failed @ " . date('c'));

if ($probe) emit_coverage($cfg, $coverage);

/* ---------------- helpers ---------------- */

/** Pull ~365 days of model history for every city and merge it into the store. */
function run_backfill(array $cfg): void
{
    $cfg['ingest_lookback_days'] = 365;
    $n = 0;
    foreach ($cfg['cities'] as $city) {
        $f = source_open_meteo($cfg, $city);
        if (!$f || empty($f['times'])) { log_line("✗ backfill {$city['name']}: no data"); usleep(300000); continue; }
        $rows = [];
        foreach ($f['times'] as $i => $t) {
            $row = ['t' => $t];
            $hourSeries = [];
            foreach ($f['series'] as $param => $vals) {
                $row[$param] = isset($vals[$i]) && is_numeric($vals[$i]) ? round($vals[$i], 1) : null;
                $hourSeries[$param] = [$row[$param]];
            }
            $row['aqi'] = aqi_rollup($hourSeries, 'latest')['aqi'];
            $rows[] = $row;
        }
        store_merge_history($cfg, $city['id'], $rows);
        log_line(sprintf("✓ backfill %-16s %d hours", $city['name'], count($rows)));
        $n++;
        usleep(400000);
    }
    log_line("\nBackfill done: $n cities @ " . date('c'));
}

function city_record(array $city, ?array $roll, int $nowTs, int $staleSeconds): array
{
    return [
        'id' => $city['id'], 'name' => $city['name'], 'province' => $city['province'],
        'lat' => $city['lat'], 'lon' => $city['lon'],
        'aqi' => null, 'band' => 'No data', 'color' => '#b7c3bf', 'textColor' => '#617176',
        'dominant' => null, 'pollutants' => [], 'subindices' => [],
        'source' => null, 'station' => null, 'license' => null, 'measured' => false,
        'measuredAt' => null, 'status' => 'unavailable', 'stale' => true,
    ];
}

function log_line(string $s): void
{
    echo $s . "\n";
    if (function_exists('flush')) @flush();
}

/** Emit the per-city / per-parameter availability table (§7 deliverable). */
function emit_coverage(array $cfg, array $coverage): void
{
    $params = array_keys($cfg['parameters']);
    $head = array_merge(['city'], $params);
    echo "\nCOVERAGE TABLE (CSV)\n";
    echo implode(',', $head) . "\n";
    foreach ($cfg['cities'] as $city) {
        $row = [$city['name']];
        foreach ($params as $p) {
            $row[] = !empty($coverage[$city['id']][$p]) ? 'yes' : 'no';
        }
        echo implode(',', $row) . "\n";
    }
}
