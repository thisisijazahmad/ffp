/* ============================================================
   City air-quality detail page — Fair Finance Pakistan
   Reads ?id=<city> and renders the headline, family-grouped
   pollutant bars, a dual-unit AQI trend (AQI + concentration)
   across 24h / 7d / 30d / 1yr, and hourly + daily history.
   ============================================================ */
(function () {
    "use strict";

    var API = "api/";

    var BANDS = [
        { max: 50,  label: "Good",                           color: "#009966" },
        { max: 100, label: "Moderate",                       color: "#cca300" },
        { max: 150, label: "Unhealthy for Sensitive Groups", color: "#ff9933" },
        { max: 200, label: "Unhealthy",                      color: "#cc0033" },
        { max: 300, label: "Very Unhealthy",                 color: "#8338a8" },
        { max: 9999,label: "Hazardous",                      color: "#7e0023" }
    ];
    function bandFor(aqi) {
        if (aqi == null) return { label: "No data", color: "#b7c3bf" };
        for (var i = 0; i < BANDS.length; i++) if (aqi <= BANDS[i].max) return BANDS[i];
        return BANDS[BANDS.length - 1];
    }

    // EPA sub-index breakpoints (mirror of api/lib/aqi.php) so the chart can plot
    // a per-pollutant AQI line alongside its raw concentration.
    var BREAKPOINTS = {
        pm2_5: { conv: 1, bp: [[0,12,0,50],[12.1,35.4,51,100],[35.5,55.4,101,150],[55.5,150.4,151,200],[150.5,250.4,201,300],[250.5,500.4,301,500]] },
        pm10:  { conv: 1, bp: [[0,54,0,50],[55,154,51,100],[155,254,101,150],[255,354,151,200],[355,424,201,300],[425,604,301,500]] },
        ozone: { conv: 0.509, bp: [[0,54,0,50],[55,70,51,100],[71,85,101,150],[86,105,151,200],[106,200,201,300]] },
        nitrogen_dioxide: { conv: 0.531, bp: [[0,53,0,50],[54,100,51,100],[101,360,101,150],[361,649,151,200],[650,1249,201,300],[1250,2049,301,500]] },
        sulphur_dioxide:  { conv: 0.382, bp: [[0,35,0,50],[36,75,51,100],[76,185,101,150],[186,304,151,200],[305,604,201,300]] },
        carbon_monoxide:  { conv: 0.000873, bp: [[0,4.4,0,50],[4.5,9.4,51,100],[9.5,12.4,101,150],[12.5,15.4,151,200],[15.5,30.4,201,300]] }
    };
    function subIndex(param, ugm3) {
        if (ugm3 == null || isNaN(ugm3)) return null;
        var t = BREAKPOINTS[param];
        if (!t) return null;
        var c = ugm3 * t.conv;
        for (var i = 0; i < t.bp.length; i++) {
            var clo = t.bp[i][0], chi = t.bp[i][1], ilo = t.bp[i][2], ihi = t.bp[i][3];
            if (c <= chi) { if (c < clo) c = clo; return Math.round((ihi - ilo) / (chi - clo) * (c - clo) + ilo); }
        }
        return 500;
    }

    var WHO_PM25_ANNUAL = 5;   // µg/m³
    var BAR_FULL = 200;        // sub-index that fills a bar to 100%

    var el = {}, detailChart = null, cityId = "", latestData = null;
    var state = { range: "24h", pollutant: "aqi", rowsByRange: {} };

    function getJSON(url) {
        return fetch(url).then(function (r) {
            if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ("HTTP " + r.status)); });
            return r.json();
        });
    }
    function getParam(name) {
        var m = new RegExp("[?&]" + name + "=([^&]+)").exec(location.search);
        return m ? decodeURIComponent(m[1]) : "";
    }
    function unitFor(p) {
        if (latestData) for (var i = 0; i < latestData.pollutants.length; i++)
            if (latestData.pollutants[i].param === p) return latestData.pollutants[i].unit;
        return "µg/m³";
    }

    /* ---------- Headline + family-grouped pollutant bars ---------- */
    function renderLatest(d) {
        latestData = d;
        var b = bandFor(d.aqi);
        el.crumbCity.textContent = d.city.name;
        document.title = d.city.name + " Air Quality | Fair Finance Pakistan";
        el.title.textContent = "Air quality in " + d.city.name + ", " + d.city.province;
        var when = d.measuredAt ? new Date(d.measuredAt.replace(" ", "T")).toLocaleString() : "—";
        el.subtitle.textContent = "Latest reading · " + when + (d.measured ? "" : " · modelled estimate");

        el.headline.style.display = "block";
        el.headline.style.background = b.color;
        el.aqiNum.textContent = d.aqi == null ? "--" : d.aqi;
        el.aqiBand.textContent = d.band;

        var dom = null;
        d.pollutants.forEach(function (p) { if (p.param === d.dominant) dom = p; });
        el.mainPollutant.textContent = dom ? dom.label : "—";
        el.mainValue.textContent = dom ? (dom.value + " " + dom.unit) : "";

        renderBars(d);

        var pm25 = null;
        d.pollutants.forEach(function (p) { if (p.param === "pm2_5") pm25 = p.value; });
        if (pm25 != null) {
            el.who.style.display = "block";
            el.who.innerHTML = "PM2.5 concentration is currently <strong>" + (pm25 / WHO_PM25_ANNUAL).toFixed(1) +
                " times</strong> the World Health Organization annual PM2.5 guideline value.";
        }

        el.source.innerHTML =
            "<b>Source:</b> " + (d.source || "—") + " · <b>Station:</b> " + (d.station || "—") +
            " · <b>License:</b> " + (d.license || "—") +
            (d.stale ? ' · <span class="aqim-stale">STALE DATA</span>' : "");

        // Populate the trend pollutant selector.
        el.pollSelect.innerHTML = '<option value="aqi">AQI (overall)</option>' +
            d.pollutants.filter(function (p) { return p.value != null && p.value !== 0; })
                .map(function (p) { return '<option value="' + p.param + '">' + p.label + "</option>"; }).join("");
        el.pollSelect.value = state.pollutant;

        el.content.style.display = "grid";
    }

    function barRow(p, dominant) {
        var pb = p.band || { color: "#b7c3bf" };
        var cat = p.band ? p.band.label : "no AQI standard";
        var sub = p.subindex;
        var pct = sub == null ? 0 : Math.max(2, Math.min(100, Math.round(sub / BAR_FULL * 100)));
        var primary = (p.param === dominant) ? ' · <span class="aqd-bar-primary">primary</span>' : "";
        var srcTag = p.measured
            ? ' <span class="aqd-src-tag is-measured" title="Measured at a ground station (OpenAQ)">measured</span>'
            : ' <span class="aqd-src-tag is-model" title="Model estimate (Open-Meteo / CAMS)">model</span>';
        var conc = p.value == null ? "—" : (p.value + " " + p.unit);
        var row = document.createElement("div");
        row.className = "aqd-bar-row";
        row.innerHTML =
            '<div class="aqd-bar-top"><span class="aqd-bar-name">' + p.label + srcTag + primary + "</span>" +
                '<span class="aqd-bar-sub">' + (sub == null ? "—" : sub) + "</span></div>" +
            '<div class="aqd-bar-track"><span class="aqd-bar-fill" style="width:' + pct + "%;background:" + pb.color + '"></span></div>' +
            '<div class="aqd-bar-foot"><span class="aqd-bar-conc">' + conc + "</span>" +
                '<span class="aqd-bar-cat" style="color:' + pb.color + '">' + cat + "</span></div>";
        return row;
    }

    function renderBars(d) {
        var groups = {};
        d.pollutants.forEach(function (p) {
            var f = p.family || "Other";
            (groups[f] = groups[f] || []).push(p);
        });
        var order = ["PM", "O₃", "NOx", "SOx", "CO", "CH₄"];
        var fams = Object.keys(groups).sort(function (a, c) {
            var ia = order.indexOf(a), ic = order.indexOf(c);
            return (ia < 0 ? 99 : ia) - (ic < 0 ? 99 : ic);
        });

        el.pollBars.innerHTML = "";
        fams.forEach(function (fam) {
            // Only render pollutants that actually have a value (hide 0/blank, e.g. NO ≈ 0).
            var visible = groups[fam].filter(function (p) { return p.value != null && p.value !== 0; });
            if (!visible.length) return; // skip a family with nothing to show

            var meta = (d.families && d.families[fam]) || null;
            var totalHtml = "";
            if (meta && meta.total) {
                var sum = 0, any = false, parts = [];
                groups[fam].forEach(function (p) {
                    if (p.value != null) { sum += p.value; any = true; parts.push(p.label + " " + (Math.round(p.value * 10) / 10)); }
                });
                if (any) {
                    // Show the member split (e.g. NO 0 + NO₂ 44.2) so the sum is transparent.
                    var breakdown = parts.length > 1 ? ' <span class="aqd-fam-breakdown">(' + parts.join(" + ") + ")</span>" : "";
                    totalHtml = '<span class="aqd-fam-total">Σ ' + fam + " " + (Math.round(sum * 10) / 10) + " µg/m³" + breakdown + "</span>";
                }
            }
            var head = document.createElement("div");
            head.className = "aqd-fam-head";
            head.innerHTML = "<span>" + (meta ? meta.label : fam) + "</span>" + totalHtml;
            el.pollBars.appendChild(head);

            visible.sort(function (a, c) {
                return (c.subindex == null ? -1 : c.subindex) - (a.subindex == null ? -1 : a.subindex);
            }).forEach(function (p) { el.pollBars.appendChild(barRow(p, d.dominant)); });
        });

        // "Not available" pollutants from the brief that have no open data source.
        if (d.unavailable && d.unavailable.length) {
            var uh = document.createElement("div");
            uh.className = "aqd-fam-head";
            uh.innerHTML = "<span>Not available from current source</span>";
            el.pollBars.appendChild(uh);
            d.unavailable.forEach(function (u) {
                var row = document.createElement("div");
                row.className = "aqd-bar-row is-unavailable";
                row.title = u.reason;
                row.innerHTML =
                    '<div class="aqd-bar-top"><span class="aqd-bar-name">' + u.label + "</span>" +
                        '<span class="aqd-bar-sub">N/A</span></div>' +
                    '<div class="aqd-bar-foot"><span class="aqd-bar-conc">' + u.reason + "</span></div>";
                el.pollBars.appendChild(row);
            });
        }
    }

    /* ---------- Dual-unit AQI trend ---------- */
    function loadHistory(rng) {
        state.range = rng;
        var btns = el.rangeGroup.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("is-active", btns[i].dataset.range === rng);

        if (state.rowsByRange[rng]) { renderChart(); return; }
        getJSON(API + "history.php?id=" + encodeURIComponent(cityId) + "&range=" + rng).then(function (d) {
            state.rowsByRange[rng] = d.series || [];
            renderChart();
        }).catch(function () { state.rowsByRange[rng] = []; renderChart(); });
    }

    function renderChart() {
        var rows = state.rowsByRange[state.range];
        if (!rows || !rows.length) {
            if (detailChart) { detailChart.destroy(); detailChart = null; }
            el.chartEmpty.textContent = "No readings in this range yet.";
            el.chartEmpty.style.display = "flex";
            return;
        }
        el.chartEmpty.style.display = "none";

        var rng = state.range, p = state.pollutant;
        var labels = rows.map(function (r) {
            var dt = new Date(r.t.replace(" ", "T"));
            return (rng === "30d" || rng === "365d")
                ? dt.toLocaleDateString([], { month: "short", day: "numeric" })
                : dt.toLocaleString([], { weekday: "short", hour: "numeric" });
        });
        var pr = labels.length > 60 ? 0 : 3;

        if (p === "aqi") {
            var vals = rows.map(function (r) { return r.aqi; });
            var colors = vals.map(function (v) { return bandFor(v).color; });
            drawChart(labels, [aqiDataset("AQI", vals, colors, pr, "y")], { leftTitle: "AQI (US)" });
            return;
        }

        var conc = rows.map(function (r) { return r[p] == null ? null : r[p]; });
        var unit = unitFor(p);
        if (BREAKPOINTS[p]) {
            var sub = conc.map(function (c) { return subIndex(p, c); });
            var scolors = sub.map(function (v) { return bandFor(v).color; });
            drawChart(labels, [
                aqiDataset("AQI sub-index", sub, scolors, pr, "y"),
                concDataset("Concentration", conc, unit, Math.max(0, pr - 1), "y2")
            ], { leftTitle: "AQI sub-index", rightTitle: unit });
        } else {
            drawChart(labels, [concDataset("Concentration", conc, unit, pr, "y")], { leftTitle: unit });
        }
    }

    function aqiDataset(label, data, colors, pr, axis) {
        return { label: label, data: data, __kind: "aqi", yAxisID: axis, borderColor: "#294048",
                 borderWidth: 2, tension: 0.35, pointRadius: pr, pointBackgroundColor: colors, pointBorderColor: colors, fill: false };
    }
    function concDataset(label, data, unit, pr, axis) {
        return { label: label, data: data, __kind: "conc", __unit: unit, yAxisID: axis, borderColor: "#c26a2a",
                 borderWidth: 2, tension: 0.3, pointRadius: pr, pointBackgroundColor: "#c26a2a", fill: false };
    }

    function drawChart(labels, datasets, opts) {
        var ctx = el.chartCanvas.getContext("2d");
        if (detailChart) detailChart.destroy();
        var scales = {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: "#617176" } },
            y: { beginAtZero: true, position: "left", grid: { color: "rgba(0,0,0,0.05)" },
                 ticks: { color: "#617176" }, title: { display: !!opts.leftTitle, text: opts.leftTitle, color: "#617176" } }
        };
        if (opts.rightTitle) {
            scales.y2 = { beginAtZero: true, position: "right", grid: { drawOnChartArea: false },
                          ticks: { color: "#617176" }, title: { display: true, text: opts.rightTitle, color: "#617176" } };
        }
        detailChart = new Chart(ctx, {
            type: "line",
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { display: datasets.length > 1, labels: { color: "#617176", boxWidth: 12, usePointStyle: true } },
                    tooltip: { callbacks: { label: function (i) {
                        var ds = i.dataset;
                        if (ds.__kind === "aqi") return ds.label + " " + i.formattedValue + " · " + bandFor(i.parsed.y).label;
                        return ds.label + ": " + i.formattedValue + (ds.__unit ? " " + ds.__unit : "");
                    } } }
                },
                scales: scales
            }
        });
    }

    /* ---------- Hourly list (last 24h, newest first) ---------- */
    function renderHourly() {
        getJSON(API + "history.php?id=" + encodeURIComponent(cityId) + "&range=24h").then(function (d) {
            if (!d.series.length) { el.hourly.innerHTML = '<p class="aqd-muted">No hourly readings available.</p>'; return; }
            el.hourly.innerHTML = "";
            d.series.slice().reverse().forEach(function (r) {
                var b = bandFor(r.aqi);
                var dt = new Date(r.t.replace(" ", "T"));
                var row = document.createElement("div");
                row.className = "aqd-hour-row";
                row.innerHTML =
                    '<span class="aqd-hour-time">' + dt.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) + "</span>" +
                    '<span class="aqd-hour-band">' + b.label + "</span>" +
                    '<span class="aqd-hour-aqi" style="background:' + b.color + '">' + (r.aqi == null ? "–" : r.aqi) + "</span>";
                el.hourly.appendChild(row);
            });
        });
    }

    /* ---------- Daily list (last 7 days) ---------- */
    function renderDaily() {
        getJSON(API + "history.php?id=" + encodeURIComponent(cityId) + "&range=30d").then(function (d) {
            var days = d.series.slice(-7).reverse();
            if (!days.length) { el.daily.innerHTML = '<li class="aqd-muted">No daily history available.</li>'; return; }
            el.daily.innerHTML = "";
            days.forEach(function (r) {
                var b = bandFor(r.aqi);
                var dt = new Date(r.t.replace(" ", "T"));
                var li = document.createElement("li");
                li.className = "aqd-day";
                li.innerHTML =
                    '<span class="aqd-day-name">' + dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + "</span>" +
                    '<span class="aqd-day-band">' + b.label + "</span>" +
                    '<span class="aqd-day-aqi" style="background:' + b.color + '">' + (r.aqi == null ? "–" : r.aqi) + "</span>";
                el.daily.appendChild(li);
            });
        });
    }

    /* ---------- 7-day model forecast ---------- */
    function renderForecast() {
        getJSON(API + "forecast.php?id=" + encodeURIComponent(cityId)).then(function (d) {
            if (!d.days || !d.days.length) return;
            var box = document.getElementById("aqdForecast");
            box.style.display = "block";
            document.getElementById("aqdForecastSrc").textContent =
                "Source: " + d.source + " · updated " + new Date(d.generatedAt).toLocaleString();

            var labelOf = {};
            d.parameters.forEach(function (p) { labelOf[p.param] = p.label; });

            var head = "<tr><th>Forecast</th>" + d.days.map(function (day) {
                var dt = new Date(day.date + "T12:00");
                return "<th>" + dt.toLocaleDateString([], { weekday: "short" }) +
                    "<small>" + dt.toLocaleDateString([], { month: "short", day: "numeric" }) + "</small></th>";
            }).join("") + "</tr>";

            var aqiRow = '<tr class="aqd-fc-aqi"><td>AQI (peak)</td>' + d.days.map(function (day) {
                var b = day.band || bandFor(day.aqi);
                return "<td><span class='aqd-fc-badge' style='background:" + b.color + "'>" + (day.aqi == null ? "–" : day.aqi) + "</span></td>";
            }).join("") + "</tr>";

            var domRow = "<tr><td>Main pollutant</td>" + d.days.map(function (day) {
                return "<td>" + (labelOf[day.dominant] || "—") + "</td>";
            }).join("") + "</tr>";

            var confRow = '<tr class="aqd-fc-conf"><td>Confidence</td>' + d.days.map(function (day) {
                return "<td><span class='aqd-fc-chip is-" + day.confidence.toLowerCase() + "'>" + day.confidence + "</span></td>";
            }).join("") + "</tr>";

            var pollRows = d.parameters.filter(function (p) {
                // Hide rows that are all-empty or only negligible trace amounts (e.g. NO ≈ 0.3).
                var max = 0, has = false;
                d.days.forEach(function (day) { var v = day.pollutants[p.param]; if (v != null) { has = true; if (v > max) max = v; } });
                return has && max >= 0.5;
            }).map(function (p) {
                return "<tr><td>" + p.label + " <small>" + p.unit + "</small></td>" + d.days.map(function (day) {
                    var v = day.pollutants[p.param];
                    return "<td>" + (v == null ? "—" : v) + "</td>";
                }).join("") + "</tr>";
            }).join("");

            document.getElementById("aqdForecastTable").innerHTML = head + aqiRow + domRow + confRow + pollRows;

            var un = (d.unavailable || []).map(function (u) { return u.label; }).join(", ");
            document.getElementById("aqdForecastNote").innerHTML =
                "<strong>Model-based estimate</strong> (numerical forecast, not a measurement). Confidence decreases with the forecast horizon." +
                (un ? " Not forecast — no data source: " + un + "." : "");
        }).catch(function () { /* forecast is best-effort; hide on failure */ });
    }

    function showError(msg) {
        el.error.style.display = "block";
        el.error.textContent = msg;
        el.subtitle.textContent = "";
    }

    /* ---------- Boot ---------- */
    function boot() {
        el.crumbCity = document.getElementById("aqdCrumbCity");
        el.title = document.getElementById("aqdTitle");
        el.subtitle = document.getElementById("aqdSubtitle");
        el.headline = document.getElementById("aqdHeadline");
        el.aqiNum = document.getElementById("aqdAqiNum");
        el.aqiBand = document.getElementById("aqdAqiBand");
        el.mainPollutant = document.getElementById("aqdMainPollutant");
        el.mainValue = document.getElementById("aqdMainValue");
        el.pollBars = document.getElementById("aqdPollBars");
        el.who = document.getElementById("aqdWho");
        el.source = document.getElementById("aqdSource");
        el.pollSelect = document.getElementById("aqdPollSelect");
        el.rangeGroup = document.getElementById("aqdRangeGroup");
        el.chartCanvas = document.getElementById("aqdHistoryChart");
        el.chartEmpty = document.getElementById("aqdChartEmpty");
        el.hourly = document.getElementById("aqdHourly");
        el.daily = document.getElementById("aqdDaily");
        el.content = document.getElementById("aqdContent");
        el.error = document.getElementById("aqdError");

        el.rangeGroup.querySelectorAll("button").forEach(function (b) {
            b.addEventListener("click", function () { loadHistory(b.dataset.range); });
        });
        el.pollSelect.addEventListener("change", function () {
            state.pollutant = el.pollSelect.value;
            renderChart();
        });

        if (location.protocol === "file:") {
            showError("Open this page through the web server (e.g. http://fair-finance.test/air-quality-detail.html?id=lahore), not as a file:// path — PHP can't run otherwise.");
            return;
        }

        cityId = (getParam("id") || "").toLowerCase().replace(/[^a-z0-9\-]/g, "");
        if (!cityId) { showError("No city specified. Go back to the map and pick a city."); return; }

        getJSON(API + "latest.php?id=" + encodeURIComponent(cityId)).then(function (d) {
            renderLatest(d);
            loadHistory("24h");
            renderHourly();
            renderDaily();
            renderForecast();
        }).catch(function (e) {
            showError("Could not load this city: " + e.message);
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
