# Air-Quality Data Pipeline & Map — Fair Finance Pakistan

Backend implementation of the FFP "AQ showcase" brief: a scheduled ingest job,
a normalised store + cache, four read-only JSON endpoints, and a map-first
front end (`/air-quality-map.html`). The site is **always served from the local
store** — the upstream API is never called on a page load.

```
api/
  config.php        cities (20), source, freshness rules, parameters
  ingest.php        scheduled job  (also: --probe coverage table)
  cities.php        GET /api/cities
  latest.php        GET /api/cities/{id}/latest
  history.php       GET /api/cities/{id}/history?range=24h|7d|30d
  ranking.php       GET /api/ranking
  lib/aqi.php       US-EPA sub-indices, NowCast, banding, rollup
  lib/sources.php   Open-Meteo (no key) + OpenAQ v3 (key) adapters
  lib/store.php     atomic JSON store + history merge/prune
  lib/respond.php   shared JSON/CORS bootstrap
data/               generated store (latest.json, meta.json, history/*.json)
```

## Quick start

```bash
php api/ingest.php          # populate the store (runs on Open-Meteo, no key)
# then open  http://fair-finance.test/air-quality-map.html
```

Works out of the box with **no API key** (Open-Meteo / CAMS model). To use
**measured OpenAQ stations**, set a free key and the source switches automatically:

```bash
setx OPENAQ_API_KEY "your-key"      # Windows; or set in api/config.php
```

## Scheduling (hourly, a few minutes after the hour)

**Windows Task Scheduler** (Laragon host):

```
Program:   C:\laragon\bin\php\php-8.2\php.exe
Arguments: A:\laragon\www\fair-finance\api\ingest.php
Trigger:   Daily, repeat every 1 hour, at HH:05
```

**cron** (Linux deploy): `5 * * * * /usr/bin/php /var/www/fair-finance/api/ingest.php`

---

## §7 — What FFP asked back from the developer

### 1. Per-city / per-parameter availability table
`php api/ingest.php --probe` prints a CSV of which parameters each of the 20
cities actually returned this run (the live coverage table). On the **OpenAQ**
source it reflects real ground-station coverage (run it with the key to finalise
scope); on the **Open-Meteo** model source every criteria pollutant is present
(PM1 is not modelled). PM1 is sparse for PK and treated as optional, as the brief notes.

### 2. API recommendation & tier
- **Primary (measured): OpenAQ v3 — free tier.** Free key, `X-API-Key` header,
  ~60 req/min. 20 cities × 1 location lookup + 1 latest call per hour ≈ 40
  requests/hour — **comfortably inside the free limit**, paced at 0.3 s/request.
  No paid tier needed for this scope. License: **CC BY 4.0** (redisplay OK with attribution).
- **Supplement / gap-filler (modelled): Open-Meteo Air Quality (CAMS).** No key,
  full national coverage, gives the history backfill. License: **CC BY 4.0**.
  Used automatically wherever OpenAQ has no nearby station, with a `"measured": false`
  flag so the UI can label it a modelled estimate.
- **Reference only, NOT used as data sources:** IQAir/AirVisual (commercial terms
  generally prohibit free redisplay) and WAQI/AQICN (attribution + token terms
  restrict bulk redistribution). Keep them as design references per the brief.

### 3. Endpoints & refresh frequency
Implemented exactly as proposed (`/api/cities`, `/api/cities/{id}/latest`,
`/api/cities/{id}/history`, `/api/ranking`). **Ingest hourly**, headline shown as
**NowCast** (12-h weighted) for PM2.5/PM10; a `stale` flag trips after 3 hours of
no fresh data and the UI shows "stale / modelled".

### 4. Licensing constraints
OpenAQ and Open-Meteo are both **CC BY 4.0** — public redisplay is permitted with
attribution, which the map footer and each city's detail panel render
(`source`, `station`, `license`, `measuredAt`). IQAir and WAQI are **not**
redistributed.

---

## Gaps found in the brief (clarified / decided in this implementation)

These were under-specified in the note; the choices made are listed so FFP can
confirm or override:

1. **AQI standard not named.** Chose **US EPA AQI** (matches IQAir/AirNow references).
2. **Multi-pollutant rollup undefined.** City AQI = **max of the per-pollutant
   sub-indices**; that pollutant is reported as `dominant`. (Standard EPA method.)
3. **NowCast only defined for PM.** PM2.5/PM10 use the 12-h NowCast; gases/O₃ use
   the latest hourly sub-index. Documented in `lib/aqi.php`.
4. **Unit normalisation.** Gases arrive as µg/m³ (Open-Meteo) or ppm/ppb (some
   OpenAQ stations) — converted to a common basis before applying EPA breakpoints.
5. **Station aggregation per city.** Multiple stations → nearest-to-centroid within
   25 km (`openaq_radius_m`). FFP may prefer a city-average; easy to switch.
6. **Missing/stale UX is a data contract, not just a UI note.** Every record carries
   `status` (`ok`/`stale`/`unavailable`) and `stale` so the front end renders it consistently.
7. **History retention/size.** 30 days kept; the 30-day endpoint is **downsampled to
   daily averages** to keep payloads small.
8. **Timezone.** All timestamps normalised to **Asia/Karachi (PKT)**.
9. **Rate-limit safety.** Requests paced; serve-from-store guarantees the upstream is
   never hit per page view.
10. **Accessibility.** AQI is never conveyed by colour alone — every marker, badge and
    row carries the numeric AQI and the category label as text.
11. **Endpoint protection.** CORS is open (read-only public data); the web ingest
    trigger can be gated with an `INGEST_TOKEN` env var; `.htaccess` blocks `.tmp`.
12. **Model vs measurement transparency.** `measured` flag distinguishes a real sensor
    reading from a CAMS model estimate — important for a fair-finance/trust audience.
