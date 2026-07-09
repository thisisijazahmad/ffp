/* ============================================================
   Air-Quality map UI — Fair Finance Pakistan
   Consumes the FFP /api/* endpoints (served from the hourly store).
   Map: Leaflet + OpenStreetMap. Clicking a city opens the dedicated
   detail page (air-quality-detail.html?id=<city>).
   ============================================================ */
(function () {
    "use strict";

    // API base = the /api folder next to this page. Uses the plain .php
    // endpoints so it works whether or not .htaccess pretty-routes are on.
    var API = "api/";
    var DETAIL_PAGE = "air-quality-detail.html";

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

    var map, markers = {}, ranking = [];
    var el = {};

    function getJSON(url) {
        return fetch(url).then(function (r) {
            if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ("HTTP " + r.status)); });
            return r.json();
        });
    }

    // Navigate to the dedicated detail page for a city.
    function goToDetail(id) {
        window.location.href = DETAIL_PAGE + "?id=" + encodeURIComponent(id);
    }

    /* ---------- Map ---------- */
    function initMap() {
        map = L.map("aqimMap", { scrollWheelZoom: false }).setView([30.4, 69.3], 5);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 12
        }).addTo(map);
    }

    function markerIcon(aqi) {
        var b = bandFor(aqi);
        var size = aqi == null ? 30 : 30 + Math.min(18, aqi / 18);
        return L.divIcon({
            className: "",
            html: '<div class="aqim-marker" style="width:' + size + 'px;height:' + size +
                  'px;background:' + b.color + ';font-size:' + (size > 38 ? 13 : 11) + 'px;">' +
                  (aqi == null ? "–" : aqi) + "</div>",
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });
    }

    function placeMarkers(cities) {
        cities.forEach(function (c) {
            var m = L.marker([c.lat, c.lon], { icon: markerIcon(c.aqi) }).addTo(map);
            var b = bandFor(c.aqi);
            m.bindPopup(
                '<div class="aqim-pop"><b>' + c.name + "</b><br>" +
                '<span class="aqim-pop-aqi" style="color:' + b.color + '">AQI ' +
                (c.aqi == null ? "n/a" : c.aqi) + " · " + c.band + "</span><br>" +
                '<button data-id="' + c.id + '">View details</button></div>'
            );
            m.on("popupopen", function () {
                var btn = document.querySelector('.aqim-pop button[data-id="' + c.id + '"]');
                if (btn) btn.addEventListener("click", function () { goToDetail(c.id); });
            });
            markers[c.id] = m;
        });
    }

    /* ---------- Ranking ---------- */
    function renderRanking(list) {
        ranking = list;
        el.ranking.innerHTML = "";
        list.forEach(function (c) {
            var b = bandFor(c.aqi);
            var li = document.createElement("li");
            li.className = "aqim-rank-item";
            li.dataset.id = c.id;
            li.innerHTML =
                '<span class="aqim-rank-no">' + c.rank + "</span>" +
                '<span class="aqim-rank-name">' + c.name + "<small>" + c.province + "</small></span>" +
                '<span class="aqim-rank-badge" style="background:' + b.color + '">' + c.aqi + "</span>";
            li.addEventListener("click", function () { goToDetail(c.id); });
            el.ranking.appendChild(li);
        });
    }

    /* ---------- Boot ---------- */
    function boot() {
        el.ranking = document.getElementById("aqimRanking");
        el.updated = document.getElementById("aqimUpdated");

        initMap();

        // The PHP API only runs when the page is served by a web server. Opening
        // the .html over file:// (double-click / Live Server) blocks fetch() and
        // PHP never executes — surface that clearly rather than blaming ingest.
        if (location.protocol === "file:") {
            var msg = "Open this page through the web server (e.g. http://fair-finance.test/air-quality-map.html), not as a file:// path — PHP can't run otherwise.";
            el.updated.textContent = "Not served over HTTP";
            el.ranking.innerHTML = '<li class="aqim-empty">' + msg + "</li>";
            return;
        }

        getJSON(API + "cities.php").then(function (d) {
            placeMarkers(d.cities);
            if (d.generatedAt) el.updated.textContent = "Updated " + new Date(d.generatedAt).toLocaleString();
        }).catch(function (e) {
            el.updated.textContent = "API error: " + e.message + " — run: php api/ingest.php";
        });

        getJSON(API + "ranking.php").then(function (d) {
            renderRanking(d.ranking);
        }).catch(function (e) {
            el.ranking.innerHTML = '<li class="aqim-empty">Ranking unavailable (' + e.message +
                '). If the store is empty, run <code>php api/ingest.php</code> first.</li>';
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
