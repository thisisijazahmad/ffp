<?php
/**
 * US EPA AQI maths — sub-indices, NowCast and category banding.
 *
 * The FFP brief asks for a single "Good / Moderate / Unhealthy" band per city
 * but does not specify the standard or how multiple pollutants roll up. We use
 * the US EPA AQI (same scale as IQAir / AirNow, the reference designs):
 *   - per-pollutant sub-index from concentration breakpoints,
 *   - PM2.5 / PM10 headline via the 12-hour NowCast weighting,
 *   - city AQI = max sub-index, and that pollutant is the "dominant" one.
 */

/** EPA breakpoints. `conv` converts µg/m³ -> the unit the breakpoints use
 *  (ppb for gases, ppm for CO; particulates stay µg/m³). */
function aqi_breakpoints(): array
{
    return [
        'pm2_5' => ['conv' => 1, 'bp' => [[0,12,0,50],[12.1,35.4,51,100],[35.5,55.4,101,150],[55.5,150.4,151,200],[150.5,250.4,201,300],[250.5,500.4,301,500]]],
        'pm10'  => ['conv' => 1, 'bp' => [[0,54,0,50],[55,154,51,100],[155,254,101,150],[255,354,151,200],[355,424,201,300],[425,604,301,500]]],
        'ozone' => ['conv' => 0.509, 'bp' => [[0,54,0,50],[55,70,51,100],[71,85,101,150],[86,105,151,200],[106,200,201,300]]],
        'nitrogen_dioxide' => ['conv' => 0.531, 'bp' => [[0,53,0,50],[54,100,51,100],[101,360,101,150],[361,649,151,200],[650,1249,201,300],[1250,2049,301,500]]],
        'sulphur_dioxide'  => ['conv' => 0.382, 'bp' => [[0,35,0,50],[36,75,51,100],[76,185,101,150],[186,304,151,200],[305,604,201,300]]],
        'carbon_monoxide'  => ['conv' => 0.000873, 'bp' => [[0,4.4,0,50],[4.5,9.4,51,100],[9.5,12.4,101,150],[12.5,15.4,151,200],[15.5,30.4,201,300]]],
    ];
}

/** Concentration (µg/m³) -> AQI sub-index for one pollutant, or null. */
function aqi_subindex(string $param, $rawUgm3): ?int
{
    if ($rawUgm3 === null || !is_numeric($rawUgm3)) return null;
    $tables = aqi_breakpoints();
    if (!isset($tables[$param])) return null;
    $c = $rawUgm3 * $tables[$param]['conv'];
    foreach ($tables[$param]['bp'] as [$clo, $chi, $ilo, $ihi]) {
        if ($c <= $chi) {
            if ($c < $clo) $c = $clo;
            return (int) round(($ihi - $ilo) / ($chi - $clo) * ($c - $clo) + $ilo);
        }
    }
    return 500; // above the top breakpoint
}

/**
 * EPA NowCast for PM (concentration, newest-first array of up to 12 hours).
 * Returns the NowCast concentration, or null if too sparse (needs 2 of last 3).
 */
function aqi_nowcast(array $valuesNewestFirst): ?float
{
    $vals = [];
    foreach (array_slice($valuesNewestFirst, 0, 12) as $v) {
        $vals[] = (is_numeric($v) ? (float) $v : null);
    }
    // Require at least 2 of the 3 most recent hours.
    $recent = array_filter(array_slice($vals, 0, 3), fn($v) => $v !== null);
    if (count($recent) < 2) return null;

    $present = array_filter($vals, fn($v) => $v !== null);
    if (count($present) < 2) return null;
    $min = min($present);
    $max = max($present);
    if ($max <= 0) return 0.0;

    $w = $min / $max;
    if ($w < 0.5) $w = 0.5;

    $num = 0.0; $den = 0.0;
    foreach ($vals as $i => $v) {
        if ($v === null) continue;
        $wi = pow($w, $i);
        $num += $wi * $v;
        $den += $wi;
    }
    return $den > 0 ? $num / $den : null;
}

/** AQI value -> category band (label, colors). */
function aqi_band(?int $aqi): array
{
    $bands = [
        [50,  'Good',                           '#009966', '#0b6b4d'],
        [100, 'Moderate',                        '#cca300', '#7a6300'],
        [150, 'Unhealthy for Sensitive Groups',  '#ff9933', '#a85a00'],
        [200, 'Unhealthy',                       '#cc0033', '#990022'],
        [300, 'Very Unhealthy',                  '#8338a8', '#5e2580'],
        [500, 'Hazardous',                       '#7e0023', '#7e0023'],
    ];
    if ($aqi === null) return ['label' => 'No data', 'color' => '#b7c3bf', 'text' => '#617176'];
    foreach ($bands as [$max, $label, $color, $text]) {
        if ($aqi <= $max) return ['label' => $label, 'color' => $color, 'text' => $text];
    }
    return ['label' => 'Hazardous', 'color' => '#7e0023', 'text' => '#7e0023'];
}

/**
 * Roll a per-pollutant hourly history into the headline city AQI.
 *
 * @param array  $series   ['pm2_5' => [newest..oldest], 'ozone' => [...], ...]
 * @param string $mode     'nowcast' | 'latest'
 * @return array { aqi, band, dominant, subindices }
 */
function aqi_rollup(array $series, string $mode = 'nowcast'): array
{
    $subs = [];
    foreach ($series as $param => $valuesNewestFirst) {
        if (aqi_subindex($param, 1) === null && $param !== 'pm2_5' && $param !== 'pm10') {
            // not an AQI pollutant (e.g. pm1) -> skip
        }
        $value = null;
        if ($mode === 'nowcast' && in_array($param, ['pm2_5', 'pm10'], true)) {
            $value = aqi_nowcast($valuesNewestFirst);
        } else {
            foreach ($valuesNewestFirst as $v) { if (is_numeric($v)) { $value = (float) $v; break; } }
        }
        $si = aqi_subindex($param, $value);
        if ($si !== null) $subs[$param] = $si;
    }

    if (!$subs) {
        return ['aqi' => null, 'band' => aqi_band(null), 'dominant' => null, 'subindices' => []];
    }
    arsort($subs);
    $dominant = array_key_first($subs);
    $aqi = $subs[$dominant];
    return [
        'aqi' => $aqi,
        'band' => aqi_band($aqi),
        'dominant' => $dominant,
        'subindices' => $subs,
    ];
}
