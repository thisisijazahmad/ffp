<?php
/**
 * Air-Quality pipeline configuration — Fair Finance Pakistan.
 *
 * Single source of truth for cities, data source, freshness rules and storage.
 * Edit the city list / source here; the ingest job and endpoints read from it.
 */

return [
    // Pakistan Standard Time — all timestamps are normalised to this zone.
    'timezone' => 'Asia/Karachi',

    // Where the normalised store + cache live (created automatically).
    'data_dir' => __DIR__.'/../data',

    // Source selection:
    //   'auto'       -> use OpenAQ when an API key is set, else Open-Meteo
    //   'openaq'     -> measured ground stations (needs free API key)
    //   'open-meteo' -> CAMS/model reanalysis, no key, full national coverage
    'source' => 'auto',

    // OpenAQ v3 free key (register at https://explore.openaq.org). Passed as
    // the X-API-Key header. Leave blank to run on Open-Meteo only.
    // You can also set it via the OPENAQ_API_KEY environment variable.
    'openaq_api_key' => getenv('OPENAQ_API_KEY') ?: '',
    'openaq_radius_m' => 25000, // search radius around the city centroid

    // Freshness / staleness policy.
    'stale_hours' => 3,                 // older than this -> flagged "stale"
    'history_retention_days' => 400,    // keep ~13 months so the 365-day view is populated
    'ingest_lookback_days' => 7,        // hours pulled per ingest (Open-Meteo)

    // Headline number shown to non-technical visitors:
    //   'nowcast' -> EPA NowCast (12h weighted) for PM2.5/PM10, hourly for gases
    //   'latest'  -> most recent raw hour
    'headline_mode' => 'nowcast',

    // 20 major cities (indicative list per FFP brief). Slugs are the API {id}.
    'cities' => [
        ['id' => 'karachi',          'name' => 'Karachi',          'province' => 'Sindh',       'lat' => 24.8607, 'lon' => 67.0011],
        ['id' => 'lahore',           'name' => 'Lahore',           'province' => 'Punjab',      'lat' => 31.5497, 'lon' => 74.3436],
        ['id' => 'islamabad',        'name' => 'Islamabad',        'province' => 'ICT',         'lat' => 33.6844, 'lon' => 73.0479],
        ['id' => 'rawalpindi',       'name' => 'Rawalpindi',       'province' => 'Punjab',      'lat' => 33.5651, 'lon' => 73.0169],
        ['id' => 'faisalabad',       'name' => 'Faisalabad',       'province' => 'Punjab',      'lat' => 31.4180, 'lon' => 73.0790],
        ['id' => 'multan',           'name' => 'Multan',           'province' => 'Punjab',      'lat' => 30.1575, 'lon' => 71.5249],
        ['id' => 'peshawar',         'name' => 'Peshawar',         'province' => 'KP',          'lat' => 34.0151, 'lon' => 71.5249],
        ['id' => 'dera-ismail-khan', 'name' => 'Dera Ismail Khan', 'province' => 'KP',          'lat' => 31.8313, 'lon' => 70.9019],
        ['id' => 'quetta',           'name' => 'Quetta',           'province' => 'Balochistan', 'lat' => 30.1798, 'lon' => 66.9750],
        ['id' => 'hyderabad',        'name' => 'Hyderabad',        'province' => 'Sindh',       'lat' => 25.3960, 'lon' => 68.3578],
        ['id' => 'gujranwala',       'name' => 'Gujranwala',       'province' => 'Punjab',      'lat' => 32.1877, 'lon' => 74.1945],
        ['id' => 'sialkot',          'name' => 'Sialkot',          'province' => 'Punjab',      'lat' => 32.4945, 'lon' => 74.5229],
        ['id' => 'bahawalpur',       'name' => 'Bahawalpur',       'province' => 'Punjab',      'lat' => 29.3956, 'lon' => 71.6836],
        ['id' => 'sargodha',         'name' => 'Sargodha',         'province' => 'Punjab',      'lat' => 32.0836, 'lon' => 72.6711],
        ['id' => 'sukkur',           'name' => 'Sukkur',           'province' => 'Sindh',       'lat' => 27.7052, 'lon' => 68.8574],
        ['id' => 'larkana',          'name' => 'Larkana',          'province' => 'Sindh',       'lat' => 27.5600, 'lon' => 68.2264],
        ['id' => 'sheikhupura',      'name' => 'Sheikhupura',      'province' => 'Punjab',      'lat' => 31.7167, 'lon' => 73.9850],
        ['id' => 'mardan',           'name' => 'Mardan',           'province' => 'KP',          'lat' => 34.1989, 'lon' => 72.0231],
        ['id' => 'gujrat',           'name' => 'Gujrat',           'province' => 'Punjab',      'lat' => 32.5731, 'lon' => 74.0789],
        ['id' => 'muzaffarabad',     'name' => 'Muzaffarabad',     'province' => 'AJK',         'lat' => 34.3700, 'lon' => 73.4711],
        // Jamshoro district industrial corridor (Sindh).
        ['id' => 'kotri',            'name' => 'Kotri',            'province' => 'Sindh',       'lat' => 25.3654, 'lon' => 68.3080],
        ['id' => 'nooriabad',        'name' => 'Nooriabad',        'province' => 'Sindh',       'lat' => 25.1447, 'lon' => 67.8503],
    ],

    // Pollutants we attempt to ingest. `aqi` flags whether it contributes to
    // the derived US-EPA AQI band (PM1/NO have no AQI standard -> raw display).
    // `family` groups species under an umbrella for the UI (PM / NOx / SOx).
    // `source` notes where the value comes from: 'model' (Open-Meteo/CAMS) or
    // 'measured' (OpenAQ ground stations, when a nearby sensor reports it).
    'parameters' => [
        'pm1'   => ['label' => 'PM1',   'unit' => 'µg/m³', 'aqi' => false, 'priority' => 'nice',     'family' => 'PM',  'source' => 'measured'],
        'pm2_5' => ['label' => 'PM2.5', 'unit' => 'µg/m³', 'aqi' => true,  'priority' => 'must',     'family' => 'PM',  'source' => 'both'],
        'pm10'  => ['label' => 'PM10',  'unit' => 'µg/m³', 'aqi' => true,  'priority' => 'high',     'family' => 'PM',  'source' => 'both'],
        'ozone' => ['label' => 'O₃',    'unit' => 'µg/m³', 'aqi' => true,  'priority' => 'high',     'family' => 'O₃',  'source' => 'model'],
        'nitrogen_monoxide' => ['label' => 'NO', 'unit' => 'µg/m³', 'aqi' => false, 'priority' => 'high', 'family' => 'NOx', 'source' => 'model'],
        'nitrogen_dioxide'  => ['label' => 'NO₂', 'unit' => 'µg/m³', 'aqi' => true, 'priority' => 'high', 'family' => 'NOx', 'source' => 'model'],
        'sulphur_dioxide'   => ['label' => 'SO₂', 'unit' => 'µg/m³', 'aqi' => true, 'priority' => 'high', 'family' => 'SOx', 'source' => 'model'],
        'carbon_monoxide'   => ['label' => 'CO',  'unit' => 'µg/m³', 'aqi' => true, 'priority' => 'optional', 'family' => 'CO', 'source' => 'model'],
        'methane'           => ['label' => 'CH₄', 'unit' => 'µg/m³', 'aqi' => false, 'priority' => 'nice', 'family' => 'CH₄', 'source' => 'model'],
    ],

    // Umbrella families for the UI. `total` is a derived sum shown alongside the
    // resolvable sub-species (which stay individually visible per the brief).
    'families' => [
        'PM'  => ['label' => 'Particulate matter', 'members' => ['pm1', 'pm2_5', 'pm10']],
        'NOx' => ['label' => 'Nitrogen oxides (NOx)', 'members' => ['nitrogen_monoxide', 'nitrogen_dioxide'], 'total' => true],
        'SOx' => ['label' => 'Sulphur oxides (SOx)', 'members' => ['sulphur_dioxide'], 'total' => true],
    ],

    // NOTE: pollutants with no open public data source for Pakistan (PM5, Black
    // Carbon, total VOC) are intentionally omitted — only pollutants the public
    // APIs (Open-Meteo / OpenAQ) actually provide are shown.
];
