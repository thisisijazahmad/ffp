/* ============================================================
   Homepage live air-quality widgets — Fair Finance Pakistan
   - Banner ticker: scrolling AQI + key pollutant per city
   - Hero summary block: most-polluted city right now
   Reads the same /api/* store the map/detail pages use.
   ============================================================ */
(function () {
    "use strict";

    var API = "api/";
    var BANDS = [
        { max: 50, color: "#009966" }, { max: 100, color: "#cca300" },
        { max: 150, color: "#ff9933" }, { max: 200, color: "#cc0033" },
        { max: 300, color: "#8338a8" }, { max: 9999, color: "#7e0023" }
    ];
    function colorFor(aqi) {
        if (aqi == null) return "#b7c3bf";
        for (var i = 0; i < BANDS.length; i++) if (aqi <= BANDS[i].max) return BANDS[i].color;
        return "#7e0023";
    }
    function getJSON(url) {
        return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    }
    function detailUrl(id) { return "air-quality-detail.html?id=" + encodeURIComponent(id); }

    function boot() {
        // The API only responds when served over HTTP (PHP). Skip silently on file://.
        if (location.protocol === "file:") return;

        getJSON(API + "ranking.php").then(function (d) {
            var list = (d && d.ranking) ? d.ranking : [];
            if (!list.length) return;
            buildTicker(list);
            buildHeroSummary(list);
        }).catch(function () { /* homepage widgets are best-effort */ });
    }

    function buildTicker(list) {
        var track = document.getElementById("aqTickerTrack");
        if (!track) return;
        var itemsHtml = list.map(function (c) {
            var col = colorFor(c.aqi);
            return '<a class="aq-ticker-item" href="' + detailUrl(c.id) + '">' +
                '<span class="aq-ticker-dot" style="background:' + col + '"></span>' +
                '<span class="aq-ticker-city">' + c.name + '</span>' +
                '<span class="aq-ticker-aqi" style="color:' + col + '">AQI ' + (c.aqi == null ? "n/a" : c.aqi) + '</span>' +
                (c.dominant ? '<span class="aq-ticker-dom">' + prettyParam(c.dominant) + '</span>' : '') +
                '</a>';
        }).join('<span class="aq-ticker-sep">•</span>');
        // Duplicate the sequence so the marquee loops seamlessly.
        track.innerHTML = itemsHtml + '<span class="aq-ticker-sep">•</span>' + itemsHtml;
    }

    function buildHeroSummary(list) {
        // A page may carry more than one summary block (e.g. one per hero slide).
        var boxes = document.querySelectorAll(".aq-hero-summary");
        if (!boxes.length) return;
        var top = list[0];
        var label = top.name + ", " + top.province + " — " + (top.band || "");
        Array.prototype.forEach.call(boxes, function (box) {
            var badge = box.querySelector(".aq-hero-badge");
            var city = box.querySelector(".aq-hero-city");
            if (badge) {
                badge.textContent = top.aqi == null ? "--" : top.aqi;
                badge.style.background = colorFor(top.aqi);
            }
            if (city) city.textContent = label;
            box.href = detailUrl(top.id);
            box.style.display = "inline-flex";
        });
    }

    function prettyParam(p) {
        var m = { pm2_5: "PM2.5", pm10: "PM10", pm1: "PM1", ozone: "O₃",
                  nitrogen_dioxide: "NO₂", nitrogen_monoxide: "NO",
                  sulphur_dioxide: "SO₂", carbon_monoxide: "CO" };
        return m[p] || p;
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
