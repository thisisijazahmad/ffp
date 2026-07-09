/* ============================================================
   Real-time Air Quality Index engine — Fair Finance Pakistan
   Data: Open-Meteo Air Quality + Geocoding APIs (free, no key)
   https://open-meteo.com/
   ============================================================ */
(function () {
    "use strict";

    /* ---------- EPA US AQI categories ---------- */
    var CATEGORIES = [
        { max: 50,  label: "Good",                            color: "#009966", text: "#0b6b4d",
          headline: "Air quality is satisfactory.",
          advice: ["Air quality poses little or no risk.", "A great day to be active outdoors."] },
        { max: 100, label: "Moderate",                        color: "#cca300", text: "#7a6300",
          headline: "Acceptable air quality.",
          advice: ["Unusually sensitive people should consider reducing prolonged outdoor exertion.",
                   "Most people can stay active outdoors."] },
        { max: 150, label: "Unhealthy for Sensitive Groups",  color: "#ff9933", text: "#a85a00",
          headline: "Sensitive groups may feel effects.",
          advice: ["People with heart or lung disease, older adults and children should limit prolonged exertion.",
                   "Keep quick-relief medicine handy if you have asthma."] },
        { max: 200, label: "Unhealthy",                       color: "#cc0033", text: "#990022",
          headline: "Everyone may begin to feel effects.",
          advice: ["Wear a face mask outdoors.", "Avoid heavy or prolonged outdoor activity.",
                   "Sensitive groups should stay indoors."] },
        { max: 300, label: "Very Unhealthy",                  color: "#8338a8", text: "#5e2580",
          headline: "Health alert — serious effects for all.",
          advice: ["Avoid all outdoor physical activity.", "Keep windows closed; run an air purifier.",
                   "Wear an N95 mask if you must go outside."] },
        { max: Infinity, label: "Hazardous",                  color: "#7e0023", text: "#7e0023",
          headline: "Emergency conditions — whole population affected.",
          advice: ["Remain indoors and keep activity levels low.", "Seal windows and doors.",
                   "Follow local health authority emergency guidance."] }
    ];

    function categoryFor(aqi) {
        if (aqi == null || isNaN(aqi)) return CATEGORIES[0];
        for (var i = 0; i < CATEGORIES.length; i++) {
            if (aqi <= CATEGORIES[i].max) return CATEGORIES[i];
        }
        return CATEGORIES[CATEGORIES.length - 1];
    }

    /* ---------- Pollutant metadata ---------- */
    var POLLUTANTS = [
        { key: "pm2_5",            name: "PM2.5", unit: "µg/m³" },
        { key: "pm10",             name: "PM10",  unit: "µg/m³" },
        { key: "ozone",            name: "O₃",    unit: "µg/m³" },
        { key: "nitrogen_dioxide", name: "NO₂",   unit: "µg/m³" },
        { key: "sulphur_dioxide",  name: "SO₂",   unit: "µg/m³" },
        { key: "carbon_monoxide",  name: "CO",    unit: "µg/m³" }
    ];

    /* EPA sub-index breakpoints. conv = factor to convert µg/m³ to the unit the
       breakpoints use (ppb for gases, ppm for CO; particulates stay µg/m³). */
    var SUBINDEX = {
        pm2_5: { conv: 1, bp: [[0,12,0,50],[12.1,35.4,51,100],[35.5,55.4,101,150],[55.5,150.4,151,200],[150.5,250.4,201,300],[250.5,500.4,301,500]] },
        pm10:  { conv: 1, bp: [[0,54,0,50],[55,154,51,100],[155,254,101,150],[255,354,151,200],[355,424,201,300],[425,604,301,500]] },
        ozone: { conv: 0.509, bp: [[0,54,0,50],[55,70,51,100],[71,85,101,150],[86,105,151,200],[106,200,201,300]] },
        nitrogen_dioxide: { conv: 0.531, bp: [[0,53,0,50],[54,100,51,100],[101,360,101,150],[361,649,151,200],[650,1249,201,300],[1250,2049,301,500]] },
        sulphur_dioxide:  { conv: 0.382, bp: [[0,35,0,50],[36,75,51,100],[76,185,101,150],[186,304,151,200],[305,604,201,300]] },
        carbon_monoxide:  { conv: 0.000873, bp: [[0,4.4,0,50],[4.5,9.4,51,100],[9.5,12.4,101,150],[12.5,15.4,151,200],[15.5,30.4,201,300]] }
    };

    function subIndex(key, raw) {
        if (raw == null || isNaN(raw)) return null;
        var def = SUBINDEX[key];
        var c = raw * def.conv;
        var bp = def.bp;
        for (var i = 0; i < bp.length; i++) {
            if (c <= bp[i][1]) {
                var clo = bp[i][0], chi = bp[i][1], ilo = bp[i][2], ihi = bp[i][3];
                if (c < clo) c = clo;
                return Math.round((ihi - ilo) / (chi - clo) * (c - clo) + ilo);
            }
        }
        return 500;
    }

    function dominantPollutant(series, idx) {
        var best = null, bestVal = -1;
        POLLUTANTS.forEach(function (p) {
            var si = subIndex(p.key, series[p.key][idx]);
            if (si != null && si > bestVal) { bestVal = si; best = p; }
        });
        return best ? { name: best.name, sub: bestVal } : null;
    }

    var QUICK_CITIES = [
        { name: "Lahore",     lat: 31.5497, lon: 74.3436 },
        { name: "Karachi",    lat: 24.8607, lon: 67.0011 },
        { name: "Islamabad",  lat: 33.6844, lon: 73.0479 },
        { name: "Faisalabad", lat: 31.4180, lon: 73.0790 },
        { name: "Peshawar",   lat: 34.0151, lon: 71.5249 },
        { name: "Multan",     lat: 30.1575, lon: 71.5249 }
    ];

    /* ---------- DOM refs ---------- */
    var el = {};
    var ID = function (id) { return document.getElementById(id); };

    /* ---------- State ---------- */
    var state = {
        full: null,        // full multi-day normalized series
        dayIdx: [],        // indices (into full) for the selected date
        dayAqi: [],        // us_aqi values for the selected date
        nowFullIdx: 0,     // index in full closest to the live moment
        nowCursor: -1,     // position in dayIdx that is "now" (-1 if not today)
        metric: "us_aqi",
        cursor: 0,         // position within dayIdx currently displayed
        playing: false,
        speed: 700,
        timer: null
    };

    var chart = null;

    /* ============================================================
       Open-Meteo fetching
       ============================================================ */
    function fetchAirQuality(lat, lon) {
        var hourly = ["us_aqi"].concat(POLLUTANTS.map(function (p) { return p.key; })).join(",");
        var url = "https://air-quality-api.open-meteo.com/v1/air-quality" +
            "?latitude=" + lat +
            "&longitude=" + lon +
            "&hourly=" + hourly +
            "&past_days=7&forecast_days=7&timezone=auto";
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error("Air quality request failed (" + r.status + ")");
            return r.json();
        });
    }

    function geocode(query) {
        var url = "https://geocoding-api.open-meteo.com/v1/search?name=" +
            encodeURIComponent(query) + "&count=6&language=en&format=json";
        return fetch(url).then(function (r) { return r.json(); });
    }

    /* ============================================================
       Helpers for local-date handling
       ============================================================ */
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

    function formatHour(date) {
        return date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    }
    function formatHourShort(date) {
        return date.toLocaleString([], { hour: "numeric" });
    }
    function formatDayLabel(d) {
        return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    }

    /* ============================================================
       Normalize API payload
       ============================================================ */
    function normalize(api, label) {
        var h = api.hourly;
        // API times are naive wall-clock strings in the LOCATION's timezone.
        // Translate the real moment into the location's wall-clock so "now"
        // matches correctly regardless of the viewer's timezone.
        var times = h.time.map(function (t) { return new Date(t); });
        var off = (api.utc_offset_seconds || 0) * 1000;
        var browserOff = new Date().getTimezoneOffset() * 60000;
        var locationNow = Date.now() + off + browserOff;

        var nowIdx = 0, best = Infinity;
        for (var i = 0; i < times.length; i++) {
            var diff = Math.abs(times[i].getTime() - locationNow);
            if (diff < best) { best = diff; nowIdx = i; }
        }

        return {
            label: label,
            times: times,
            series: {
                us_aqi: h.us_aqi,
                pm2_5: h.pm2_5,
                pm10: h.pm10,
                ozone: h.ozone,
                nitrogen_dioxide: h.nitrogen_dioxide,
                sulphur_dioxide: h.sulphur_dioxide,
                carbon_monoxide: h.carbon_monoxide
            },
            nowFullIdx: nowIdx,
            locationNow: locationNow
        };
    }

    /* ============================================================
       Gauge (top semicircle, 0..500)
       ============================================================ */
    var GAUGE = { cx: 170, cy: 160, r: 130 };

    // value 0..500 -> point on the upper semicircle (0 = left, 500 = right)
    function gaugePoint(value, radius) {
        var frac = Math.max(0, Math.min(1, value / 500));
        var rad = (180 - 180 * frac) * Math.PI / 180; // 180°=left ... 0°=right
        return { x: GAUGE.cx + radius * Math.cos(rad), y: GAUGE.cy - radius * Math.sin(rad) };
    }

    // Build the arc as a sampled polyline so the geometry is unambiguous.
    function arcPath(v0, v1) {
        var steps = Math.max(2, Math.round((v1 - v0) / 5));
        var d = "";
        for (var i = 0; i <= steps; i++) {
            var v = v0 + (v1 - v0) * (i / steps);
            var p = gaugePoint(v, GAUGE.r);
            d += (i === 0 ? "M " : "L ") + p.x.toFixed(2) + " " + p.y.toFixed(2) + " ";
        }
        return d.trim();
    }

    function buildGauge() {
        var segs = [
            { from: 0,   to: 50,  color: "#009966" },
            { from: 50,  to: 100, color: "#f2c200" },
            { from: 100, to: 150, color: "#ff9933" },
            { from: 150, to: 200, color: "#cc0033" },
            { from: 200, to: 300, color: "#8338a8" },
            { from: 300, to: 500, color: "#7e0023" }
        ];
        var ns = "http://www.w3.org/2000/svg";
        var svg = el.gauge;
        svg.setAttribute("viewBox", "0 0 340 182");

        segs.forEach(function (seg) {
            var p = document.createElementNS(ns, "path");
            p.setAttribute("d", arcPath(seg.from, seg.to));
            p.setAttribute("fill", "none");
            p.setAttribute("stroke", seg.color);
            p.setAttribute("stroke-width", "24");
            p.setAttribute("stroke-linejoin", "round");
            svg.appendChild(p);
        });

        var needle = document.createElementNS(ns, "line");
        needle.setAttribute("x1", GAUGE.cx);
        needle.setAttribute("y1", GAUGE.cy);
        needle.setAttribute("stroke", "#132126");
        needle.setAttribute("stroke-width", "4");
        needle.setAttribute("stroke-linecap", "round");
        svg.appendChild(needle);

        var hub = document.createElementNS(ns, "circle");
        hub.setAttribute("cx", GAUGE.cx);
        hub.setAttribute("cy", GAUGE.cy);
        hub.setAttribute("r", "9");
        hub.setAttribute("fill", "#132126");
        svg.appendChild(hub);

        el.needle = needle;
    }

    function setNeedle(aqi) {
        var tip = gaugePoint(Math.max(0, Math.min(500, aqi || 0)), GAUGE.r - 16);
        el.needle.setAttribute("x2", tip.x);
        el.needle.setAttribute("y2", tip.y);
    }

    /* ============================================================
       Chart.js plugins
       ============================================================ */
    function hexToRgba(hex, a) {
        var n = parseInt(hex.slice(1), 16);
        return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }

    // Translucent vertical bands coloured by each hour's AQI category.
    var categoryBands = {
        id: "categoryBands",
        beforeDatasetsDraw: function (c) {
            var aqi = c.$dayAqi;
            if (!aqi || !aqi.length) return;
            var meta = c.getDatasetMeta(0);
            var area = c.chartArea, ctx = c.ctx;
            ctx.save();
            for (var i = 0; i < aqi.length; i++) {
                if (!meta.data[i]) continue;
                var x = meta.data[i].x;
                var prevX = meta.data[i - 1] ? meta.data[i - 1].x : area.left;
                var nextX = meta.data[i + 1] ? meta.data[i + 1].x : area.right;
                var left = i === 0 ? area.left : (prevX + x) / 2;
                var right = i === aqi.length - 1 ? area.right : (x + nextX) / 2;
                ctx.fillStyle = hexToRgba(categoryFor(aqi[i]).color, 0.13);
                ctx.fillRect(left, area.top, right - left, area.bottom - area.top);
            }
            ctx.restore();
        }
    };

    // Vertical marker at the current playback hour.
    var cursorLine = {
        id: "cursorLine",
        afterDatasetsDraw: function (c) {
            var idx = c.$cursor;
            if (idx == null) return;
            var meta = c.getDatasetMeta(0);
            if (!meta.data[idx]) return;
            var x = meta.data[idx].x, py = meta.data[idx].y;
            var ctx = c.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, c.chartArea.top);
            ctx.lineTo(x, c.chartArea.bottom);
            ctx.lineWidth = 2;
            ctx.strokeStyle = "rgba(19,33,38,0.55)";
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(x, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = "#132126";
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#fff";
            ctx.stroke();
            ctx.restore();
        }
    };

    function metricMeta() {
        if (state.metric === "us_aqi") return { name: "US AQI", unit: "" };
        var p = POLLUTANTS.filter(function (x) { return x.key === state.metric; })[0];
        return { name: p.name, unit: p.unit };
    }

    function buildChart() {
        var ctx = el.chartCanvas.getContext("2d");
        chart = new Chart(ctx, {
            type: "line",
            data: { labels: [], datasets: [{
                label: "US AQI",
                data: [],
                borderColor: "#1c8a6a",
                borderWidth: 3,
                fill: false,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 5,
                segment: {
                    // colour each segment by the AQI category of its end hour
                    borderColor: function (cx) {
                        var v = state.dayAqi[cx.p1DataIndex];
                        return categoryFor(v).color;
                    }
                }
            }]},
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: function (items) {
                                var t = state.full.times[state.dayIdx[items[0].dataIndex]];
                                return t ? formatHour(t) : "";
                            },
                            label: function (item) {
                                var m = metricMeta();
                                var lines = [m.name + ": " + item.formattedValue + (m.unit ? " " + m.unit : "")];
                                if (state.metric !== "us_aqi") {
                                    lines.push("AQI: " + Math.round(state.dayAqi[item.dataIndex]) +
                                        " · " + categoryFor(state.dayAqi[item.dataIndex]).label);
                                } else {
                                    lines.push(categoryFor(state.dayAqi[item.dataIndex]).label);
                                }
                                return lines;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, color: "#617176" } },
                    y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.05)" }, ticks: { color: "#617176" } }
                },
                onClick: function (e, items) { if (items.length) { pause(); renderIndex(items[0].index); } }
            },
            plugins: [categoryBands, cursorLine]
        });
    }

    function refreshChart() {
        var f = state.full, m = metricMeta();
        chart.data.labels = state.dayIdx.map(function (k) { return formatHourShort(f.times[k]); });
        chart.data.datasets[0].data = state.dayIdx.map(function (k) {
            var v = f.series[state.metric][k];
            return v == null ? null : Math.round(v * 10) / 10;
        });
        chart.data.datasets[0].label = m.name;
        chart.$dayAqi = state.dayAqi;
        chart.$cursor = state.cursor;
        chart.update();
    }

    /* ============================================================
       Day insights (fills the advisory card)
       ============================================================ */
    function buildHourStrip() {
        el.hourStrip.innerHTML = "";
        state.dayIdx.forEach(function (k, i) {
            var aqi = state.full.series.us_aqi[k];
            var cell = document.createElement("div");
            cell.className = "aqi-hour-cell";
            cell.style.background = categoryFor(aqi).color;
            cell.title = formatHour(state.full.times[k]) + " · AQI " + Math.round(aqi);
            cell.dataset.i = i;
            cell.addEventListener("click", function () { pause(); renderIndex(i); });
            el.hourStrip.appendChild(cell);
        });
    }

    function highlightHourCell(i) {
        var cells = el.hourStrip.children;
        for (var j = 0; j < cells.length; j++) {
            cells[j].classList.toggle("is-active", j === i);
        }
    }

    function computeDayStats() {
        var f = state.full, peak = -Infinity, low = Infinity, sum = 0, n = 0, peakK = null, lowK = null;
        state.dayIdx.forEach(function (k) {
            var v = f.series.us_aqi[k];
            if (v == null || isNaN(v)) return;
            sum += v; n++;
            if (v > peak) { peak = v; peakK = k; }
            if (v < low) { low = v; lowK = k; }
        });
        if (!n) return;
        var pc = categoryFor(peak), lc = categoryFor(low);
        el.statPeak.textContent = Math.round(peak);
        el.statPeak.style.color = pc.text;
        el.statPeakTime.textContent = formatHourShort(f.times[peakK]);
        el.statLow.textContent = Math.round(low);
        el.statLow.style.color = lc.text;
        el.statLowTime.textContent = formatHourShort(f.times[lowK]);
        el.statAvg.textContent = Math.round(sum / n);
        el.statAvg.style.color = categoryFor(sum / n).text;
    }

    /* ============================================================
       Render a given hour (cursor within the selected day)
       ============================================================ */
    function renderIndex(cursor) {
        if (!state.dayIdx.length) return;
        cursor = Math.max(0, Math.min(state.dayIdx.length - 1, cursor));
        state.cursor = cursor;
        var k = state.dayIdx[cursor];
        var f = state.full;

        var aqi = Math.round(f.series.us_aqi[k]);
        var cat = categoryFor(aqi);

        setNeedle(aqi);
        el.gaugeValue.textContent = isNaN(aqi) ? "--" : aqi;
        el.gaugeValue.style.color = cat.text;
        el.categoryPill.textContent = cat.label;
        el.categoryPill.style.background = cat.color;

        el.advisoryCard.style.borderLeftColor = cat.color;
        el.advisoryHeadline.textContent = cat.headline;
        el.advisoryList.innerHTML = "";
        cat.advice.forEach(function (a) {
            var li = document.createElement("li");
            li.innerHTML = '<span class="aqi-adv-icon">•</span><span>' + a + "</span>";
            el.advisoryList.appendChild(li);
        });

        POLLUTANTS.forEach(function (p) {
            var node = el.pollutants[p.key];
            if (!node) return;
            var v = f.series[p.key][k];
            node.value.textContent = (v == null || isNaN(v)) ? "--" : Math.round(v * 10) / 10;
        });

        // dominant pollutant for this hour
        var dom = dominantPollutant(f.series, k);
        if (dom) {
            el.dominant.textContent = dom.name + " · sub-AQI " + dom.sub;
            el.dominant.style.background = categoryFor(dom.sub).color;
        }

        // time label / live indicator
        var t = f.times[k];
        if (cursor === state.nowCursor) {
            el.updated.textContent = "Live · " + formatHour(t);
            el.playbackTime.textContent = "";
        } else {
            var rel = k > state.nowFullIdx ? "Forecast" : "Past";
            el.updated.textContent = formatHour(t);
            el.playbackTime.textContent = rel + " · " + formatHour(t);
        }

        if (chart) { chart.$cursor = cursor; chart.update("none"); }
        el.scrubber.value = cursor;
        highlightHourCell(cursor);
    }

    /* ============================================================
       Date selection
       ============================================================ */
    function selectDate(key, startAtNow) {
        pause();
        var f = state.full;
        var idx = [];
        for (var i = 0; i < f.times.length; i++) {
            if (dateKey(f.times[i]) === key) idx.push(i);
        }
        if (!idx.length) return;
        state.dayIdx = idx;
        state.dayAqi = idx.map(function (k) { return f.series.us_aqi[k]; });
        state.nowCursor = idx.indexOf(f.nowFullIdx);

        el.scrubber.max = idx.length - 1;
        el.dayLabel.textContent = formatDayLabel(f.times[idx[0]]);

        refreshChart();
        buildHourStrip();
        computeDayStats();

        var startCursor = (startAtNow && state.nowCursor >= 0) ? state.nowCursor : 0;
        renderIndex(startCursor);
    }

    /* ============================================================
       Playback ("video")
       ============================================================ */
    function play() {
        if (state.playing || !state.dayIdx.length) return;
        if (state.cursor >= state.dayIdx.length - 1) renderIndex(0);
        state.playing = true;
        el.playIcon.style.display = "none";
        el.pauseIcon.style.display = "block";
        state.timer = setInterval(step, state.speed);
    }
    function pause() {
        state.playing = false;
        if (el.playIcon) el.playIcon.style.display = "block";
        if (el.pauseIcon) el.pauseIcon.style.display = "none";
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }
    function step() {
        if (state.cursor >= state.dayIdx.length - 1) { pause(); return; }
        renderIndex(state.cursor + 1);
    }
    function togglePlay() { state.playing ? pause() : play(); }
    function setSpeed(ms, btn) {
        state.speed = ms;
        var buttons = el.speedGroup.querySelectorAll("button");
        for (var i = 0; i < buttons.length; i++) buttons[i].classList.remove("is-active");
        btn.classList.add("is-active");
        if (state.playing) { pause(); play(); }
    }

    /* ============================================================
       Load a location
       ============================================================ */
    function loadLocation(lat, lon, label) {
        pause();
        showError("");
        el.dashboard.classList.add("is-loading");
        fetchAirQuality(lat, lon).then(function (api) {
            state.full = normalize(api, label);
            state.nowFullIdx = state.full.nowFullIdx;
            state.metric = "us_aqi";
            el.metricSelect.value = "us_aqi";
            el.locationName.textContent = label;
            if (!chart) buildChart();

            // configure date picker range
            var f = state.full;
            el.date.min = dateKey(f.times[0]);
            el.date.max = dateKey(f.times[f.times.length - 1]);
            var todayKey = dateKey(new Date(f.locationNow));
            el.date.value = todayKey;

            selectDate(todayKey, true);
            el.dashboard.classList.remove("is-loading");
        }).catch(function (err) {
            el.dashboard.classList.remove("is-loading");
            showError("Could not load air-quality data: " + err.message);
        });
    }

    function showError(msg) {
        if (!msg) { el.error.classList.remove("is-visible"); el.error.textContent = ""; return; }
        el.error.textContent = msg;
        el.error.classList.add("is-visible");
    }

    /* ============================================================
       Search (geocoding)
       ============================================================ */
    var searchTimer = null;
    function onSearchInput() {
        var q = el.search.value.trim();
        if (searchTimer) clearTimeout(searchTimer);
        if (q.length < 2) { el.suggestions.classList.remove("is-open"); return; }
        searchTimer = setTimeout(function () {
            geocode(q).then(function (res) { renderSuggestions(res.results || []); })
                      .catch(function () { el.suggestions.classList.remove("is-open"); });
        }, 250);
    }
    function renderSuggestions(results) {
        el.suggestions.innerHTML = "";
        if (!results.length) { el.suggestions.classList.remove("is-open"); return; }
        results.forEach(function (r) {
            var li = document.createElement("li");
            var place = [r.admin1, r.country].filter(Boolean).join(", ");
            li.innerHTML = "<span>" + r.name + "</span><small>" + place + "</small>";
            li.addEventListener("click", function () {
                el.search.value = r.name;
                el.suggestions.classList.remove("is-open");
                clearActiveChip();
                loadLocation(r.latitude, r.longitude, r.name + (r.country ? ", " + r.country : ""));
            });
            el.suggestions.appendChild(li);
        });
        el.suggestions.classList.add("is-open");
    }
    function useGeolocation() {
        if (!navigator.geolocation) { showError("Geolocation is not supported by your browser."); return; }
        el.geoBtn.disabled = true;
        navigator.geolocation.getCurrentPosition(function (pos) {
            el.geoBtn.disabled = false;
            clearActiveChip();
            el.search.value = "";
            loadLocation(pos.coords.latitude, pos.coords.longitude,
                "Your location (" + pos.coords.latitude.toFixed(2) + ", " + pos.coords.longitude.toFixed(2) + ")");
        }, function () {
            el.geoBtn.disabled = false;
            showError("Unable to get your location. Please search for a city instead.");
        }, { timeout: 10000 });
    }

    /* ---------- Quick-city chips ---------- */
    function buildChips() {
        QUICK_CITIES.forEach(function (c, i) {
            var b = document.createElement("button");
            b.className = "aqi-chip" + (i === 0 ? " is-active" : "");
            b.textContent = c.name;
            b.addEventListener("click", function () {
                clearActiveChip();
                b.classList.add("is-active");
                el.search.value = "";
                loadLocation(c.lat, c.lon, c.name + ", Pakistan");
            });
            el.chips.appendChild(b);
        });
    }
    function clearActiveChip() {
        var chips = el.chips.querySelectorAll(".aqi-chip");
        for (var i = 0; i < chips.length; i++) chips[i].classList.remove("is-active");
    }

    /* ============================================================
       Init
       ============================================================ */
    function cachePollutantNodes() {
        el.pollutants = {};
        POLLUTANTS.forEach(function (p) {
            var box = ID("pollutant-" + p.key);
            if (box) el.pollutants[p.key] = { value: box.querySelector(".aqi-pollutant-value") };
        });
    }

    function init() {
        el.gauge = ID("aqiGauge");
        el.gaugeValue = ID("aqiGaugeValue");
        el.categoryPill = ID("aqiCategoryPill");
        el.playbackTime = ID("aqiPlaybackTime");
        el.updated = ID("aqiUpdated");
        el.locationName = ID("aqiLocationName");
        el.advisoryCard = ID("aqiAdvisoryCard");
        el.advisoryHeadline = ID("aqiAdvisoryHeadline");
        el.advisoryList = ID("aqiAdvisoryList");
        el.hourStrip = ID("aqiHourStrip");
        el.statPeak = ID("aqiStatPeak");
        el.statPeakTime = ID("aqiStatPeakTime");
        el.statLow = ID("aqiStatLow");
        el.statLowTime = ID("aqiStatLowTime");
        el.statAvg = ID("aqiStatAvg");
        el.dominant = ID("aqiDominant");
        el.dayLabel = ID("aqiDayLabel");
        el.chartCanvas = ID("aqiChart");
        el.metricSelect = ID("aqiMetric");
        el.date = ID("aqiDate");
        el.scrubber = ID("aqiScrubber");
        el.playIcon = ID("aqiPlayIcon");
        el.pauseIcon = ID("aqiPauseIcon");
        el.speedGroup = ID("aqiSpeedGroup");
        el.search = ID("aqiSearch");
        el.suggestions = ID("aqiSuggestions");
        el.geoBtn = ID("aqiGeoBtn");
        el.chips = ID("aqiChips");
        el.dashboard = ID("aqiDashboard");
        el.error = ID("aqiError");
        cachePollutantNodes();

        buildGauge();
        buildChips();

        ID("aqiPlayBtn").addEventListener("click", togglePlay);
        el.scrubber.addEventListener("input", function () { pause(); renderIndex(parseInt(el.scrubber.value, 10)); });
        el.metricSelect.addEventListener("change", function () { state.metric = el.metricSelect.value; refreshChart(); renderIndex(state.cursor); });
        el.date.addEventListener("change", function () {
            if (el.date.value) selectDate(el.date.value, el.date.value === dateKey(new Date(state.full.locationNow)));
        });
        el.search.addEventListener("input", onSearchInput);
        el.geoBtn.addEventListener("click", useGeolocation);
        document.addEventListener("click", function (e) {
            if (!el.suggestions.contains(e.target) && e.target !== el.search) el.suggestions.classList.remove("is-open");
        });
        el.speedGroup.querySelectorAll("button").forEach(function (b) {
            b.addEventListener("click", function () { setSpeed(parseInt(b.dataset.speed, 10), b); });
        });

        loadLocation(QUICK_CITIES[0].lat, QUICK_CITIES[0].lon, QUICK_CITIES[0].name + ", Pakistan");
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
