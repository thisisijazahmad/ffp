/* ============================================================
   News & Events — static, data-driven from data/news-events.json
   Fair Finance Pakistan.
   Renders the landing grid (with filters/search/show-more) and the
   detail page (?slug=...) entirely client-side, so the section can be
   updated by editing the JSON file — no code changes, no PHP.
   ============================================================ */
(function () {
    "use strict";

    var PAGE = 9;

    /* ---------- helpers ---------- */
    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function formatDate(iso) {
        if (!iso) return "";
        var p = String(iso).split("-");
        if (p.length < 3) return iso;
        // DD-MM-YYYY, e.g. 27-06-2026
        return p[2].padStart(2, "0") + "-" + p[1].padStart(2, "0") + "-" + p[0];
    }
    function pill(type, status) {
        if (type === "Event" && status === "Upcoming") return { label: "Upcoming Event", cls: "is-upcoming" };
        switch (type) {
            case "Event":        return { label: "Event",        cls: "is-event" };
            case "Publication":  return { label: "Publication",  cls: "is-publication" };
            case "Announcement": return { label: "Announcement", cls: "is-announcement" };
            default:             return { label: "News",         cls: "is-news" };
        }
    }
    function normalise(it) {
        var type = it.type || "News";
        var status = it.status || "";
        if (type === "Event" && !status && it.date) {
            var p = it.date.split("-");
            var d = new Date(+p[0], +p[1] - 1, +p[2]);
            var today = new Date(); today.setHours(0, 0, 0, 0);
            status = (d >= today) ? "Upcoming" : "Past";
        }
        var pl = pill(type, status);
        return {
            title: it.title || "", slug: (it.slug || "").toLowerCase().replace(/[^a-z0-9\-]/g, ""),
            type: type, status: status, date: it.date || "", dateLabel: formatDate(it.date),
            location: it.location || "", virtual: !!it.virtual,
            image: it.image || "", heroImage: it.heroImage || "", imageAlt: it.imageAlt || it.title || "",
            excerpt: it.excerpt || "", body: it.body || "",
            partners: it.partners || [], externalLink: it.externalLink || "",
            externalLinkLabel: it.externalLinkLabel || "View link",
            tags: it.tags || [], seo: it.seo || it.excerpt || "",
            featured: !!it.featured, pillLabel: pl.label, pillClass: pl.cls
        };
    }
    // Content is loaded from assets/js/news-data.js (window.NEWS_ITEMS), which is
    // included via a <script> tag — works over http AND when opening the file
    // directly (file://), unlike fetch().
    function loadItems() {
        var raw = window.NEWS_ITEMS || [];
        var items = raw
            .filter(function (it) { return it.published !== false && it.title && it.slug; })
            .map(normalise);
        items.sort(function (a, b) {
            if (a.featured !== b.featured) return a.featured ? -1 : 1;
            return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
        });
        return Promise.resolve(items);
    }
    // Swap a broken <img> for a branded placeholder (card or hero).
    window.neImgFail = function (img) {
        var wrap = img.parentNode, type = img.getAttribute("data-type") || "";
        if (wrap.classList.contains("ne-hero-img")) {
            wrap.classList.add("is-placeholder");
            img.parentNode.removeChild(img);
            var s = document.createElement("span"); s.textContent = type + " · Fair Finance Pakistan";
            wrap.appendChild(s);
        } else {
            var ph = document.createElement("div"); ph.className = "ne-card-placeholder";
            var sp = document.createElement("span"); sp.textContent = type; ph.appendChild(sp);
            img.parentNode.replaceChild(ph, img);
        }
    };

    function cardHTML(it) {
        var url = "news-event.html?slug=" + encodeURIComponent(it.slug);
        var media = it.image
            ? '<img src="' + esc(it.image) + '" alt="' + esc(it.imageAlt) + '" loading="lazy" data-type="' + esc(it.type) + '" onerror="neImgFail(this)">'
            : '<div class="ne-card-placeholder"><span>' + esc(it.type) + "</span></div>";
        var meta = esc(it.dateLabel) + (it.location ? " · " + esc(it.location) : "");
        return '<a class="ne-card" href="' + esc(url) + '" data-type="' + esc(it.type.toLowerCase()) +
               '" data-status="' + esc(it.status.toLowerCase()) + '">' +
               '<div class="ne-card-media">' + media +
            //    '<span class="ne-pill ' + esc(it.pillClass) + '">' + esc(it.pillLabel) + "</span>" +
               '<span class="ne-card-hover">Read more →</span></div>' +
               '<div class="ne-card-body">' +
               '<span class="ne-date">' + meta + "</span>" +
               '<h3 class="ne-card-title">' + esc(it.title) + "</h3>" +
               '<p class="ne-card-excerpt">' + esc(it.excerpt) + "</p></div></a>";
    }

    /* ============================================================
       Landing page
       ============================================================ */
    function initLanding(grid) {
        var chips = Array.prototype.slice.call(document.querySelectorAll(".ne-chip"));
        var noResults = document.getElementById("neNoResults");
        var moreBtn = document.getElementById("neMore");
        var search = document.getElementById("neSearch");
        var filter = "all", query = "", shown = PAGE, cards = [];

        function matchesFilter(c) {
            var t = c.getAttribute("data-type"), s = c.getAttribute("data-status");
            switch (filter) {
                case "news": return t === "news";
                case "event": return t === "event";
                case "upcoming": return s === "upcoming";
                case "past": return s === "past";
                default: return true;
            }
        }
        function apply() {
            var matched = 0;
            cards.forEach(function (c) {
                var ok = matchesFilter(c) && (!query || c.textContent.toLowerCase().indexOf(query) !== -1);
                if (ok) { matched++; c.style.display = matched <= shown ? "" : "none"; }
                else c.style.display = "none";
            });
            noResults.hidden = matched !== 0;
            moreBtn.hidden = matched <= shown;
        }

        loadItems().then(function (items) {
            if (!items.length) { grid.innerHTML = '<p class="ne-empty">No items published yet. Check back soon.</p>'; return; }
            grid.innerHTML = items.map(cardHTML).join("");
            cards = Array.prototype.slice.call(grid.querySelectorAll(".ne-card"));

            chips.forEach(function (chip) {
                chip.addEventListener("click", function () {
                    chips.forEach(function (c) { c.classList.remove("is-active"); c.setAttribute("aria-selected", "false"); });
                    chip.classList.add("is-active"); chip.setAttribute("aria-selected", "true");
                    filter = chip.getAttribute("data-filter"); shown = PAGE; apply();
                });
            });
            if (search) search.addEventListener("input", function () { query = search.value.trim().toLowerCase(); shown = PAGE; apply(); });
            moreBtn.addEventListener("click", function () { shown += PAGE; apply(); });

            // Pre-select a filter from the URL (?filter=event|news|upcoming|past),
            // e.g. the "Events" / "News & Updates" nav sub-tabs.
            var urlFilter = (getParam("filter") || "").toLowerCase();
            var preChip = chips.filter(function (c) { return c.getAttribute("data-filter") === urlFilter; })[0];
            if (preChip && urlFilter !== "all") preChip.click(); else apply();
        }).catch(function (e) {
            grid.innerHTML = '<p class="ne-empty">Could not load items (' + esc(e.message) + ").</p>";
        });
    }

    /* ============================================================
       Detail page
       ============================================================ */
    function getParam(name) {
        var m = new RegExp("[?&]" + name + "=([^&]+)").exec(location.search);
        return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
    }
    function setMeta(sel, val) {
        var el = document.querySelector(sel);
        if (el) el.setAttribute("content", val);
    }
    function relatedItems(item, all, n) {
        var tags = item.tags.map(function (t) { return t.toLowerCase(); });
        return all.filter(function (it) { return it.slug !== item.slug; })
            .map(function (it) {
                var shared = it.tags.filter(function (t) { return tags.indexOf(t.toLowerCase()) !== -1; }).length;
                return { it: it, n: shared };
            })
            .filter(function (x) { return x.n > 0; })
            .sort(function (a, b) { return b.n - a.n; })
            .slice(0, n || 3).map(function (x) { return x.it; });
    }

    function renderDetail(root, item, all) {
        var pageUrl = location.origin + location.pathname + "?slug=" + encodeURIComponent(item.slug);
        var ogImg = item.image || "images/logo.png";

        document.title = item.title + " | Fair Finance Pakistan";
        setMeta('meta[data-ne="desc"]', item.seo);
        setMeta('meta[data-ne="og:type"]', item.type === "Event" ? "article" : "article");
        setMeta('meta[data-ne="og:title"]', item.title);
        setMeta('meta[data-ne="og:description"]', item.seo);
        setMeta('meta[data-ne="og:image"]', ogImg);
        setMeta('meta[data-ne="tw:title"]', item.title);
        setMeta('meta[data-ne="tw:description"]', item.seo);
        setMeta('meta[data-ne="tw:image"]', ogImg);

        // JSON-LD
        var ld = item.type === "Event" ? {
            "@context": "https://schema.org", "@type": "Event", name: item.title, startDate: item.date,
            eventAttendanceMode: item.virtual ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
            eventStatus: "https://schema.org/EventScheduled",
            location: item.location ? { "@type": "Place", name: item.location } : undefined,
            description: item.seo, image: ogImg, url: pageUrl,
            organizer: { "@type": "Organization", name: "Fair Finance Pakistan" }
        } : {
            "@context": "https://schema.org", "@type": "Article", headline: item.title, datePublished: item.date,
            description: item.seo, image: ogImg, url: pageUrl,
            author: { "@type": "Organization", name: "Fair Finance Pakistan" },
            publisher: { "@type": "Organization", name: "Fair Finance Pakistan" }
        };
        var s = document.createElement("script"); s.type = "application/ld+json";
        s.textContent = JSON.stringify(ld); document.head.appendChild(s);

        // Hero uses heroImage when set, otherwise the card image — so the card
        // and the detail hero can show different graphics.
        var heroSrc = item.heroImage || item.image;
        var hero = heroSrc
            ? '<div class="ne-hero-img"><img src="' + esc(heroSrc) + '" alt="' + esc(item.imageAlt) + '" data-type="' + esc(item.type) + '" onerror="neImgFail(this)"></div>'
            : '<div class="ne-hero-img is-placeholder"><span>' + esc(item.type) + " · Fair Finance Pakistan</span></div>";

        var partners = item.partners.length
            ? '<div class="ne-aside-block"><h4></h4><ul class="ne-partners">' +
              item.partners.map(function (p) {
                  // An image path (e.g. infographic/speakers2a.jpg) renders as an image, not text.
                  if (/\.(jpe?g|png|webp|gif|svg)$/i.test(p)) {
                      return '<li class="ne-partner-img"><img src="' + esc(p) + '" alt="' + esc(item.title) + '" loading="lazy"></li>';
                  }
                  return "<li>" + esc(p) + "</li>";
              }).join("") + "</ul></div>" : "";
        var tags = item.tags.length
            ? '<div class="ne-aside-block"><h4>Tags</h4><div class="ne-tags">' +
              item.tags.map(function (t) { return '<span class="ne-tag">' + esc(t) + "</span>"; }).join("") + "</div></div>" : "";
        var ext = item.externalLink
            ? '<a class="ne-ext-btn" href="' + esc(item.externalLink) + '" target="_blank" rel="noopener noreferrer">' + esc(item.externalLinkLabel) + " →</a>" : "";

        var related = relatedItems(item, all, 3);
        var relatedHTML = related.length
            ? '<section class="ne-related"><h2>Related items</h2><div class="ne-grid">' +
              related.map(cardHTML).join("") + "</div></section>" : "";

        var enc = encodeURIComponent(pageUrl), encT = encodeURIComponent(item.title);

        root.innerHTML =
            '<nav class="ne-crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>›</span>' +
                '<a href="news-events.html">News &amp; Events</a><span>›</span><span>' + esc(item.title) + "</span></nav>" +
            '<header class="ne-detail-head"><div class="ne-detail-meta-top">' +
                '<span class="ne-date">' + esc(item.dateLabel) + "</span>" +
                (item.location ? '<span class="ne-loc">📍 ' + esc(item.location) + "</span>" : "") +
                "</div></header>" +
            hero +
            '<div class="ne-detail-grid"><article class="ne-body">' + item.body + "</article>" +
            '<aside class="ne-aside">' + partners + tags + ext +
                '<div class="ne-aside-block"><h4>Share</h4><div class="ne-share">' +
                '<a class="ne-share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=' + enc + '" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn">in</a>' +
                '<a class="ne-share-btn" href="https://twitter.com/intent/tweet?url=' + enc + "&text=" + encT + '" target="_blank" rel="noopener noreferrer" aria-label="Share on X">X</a>' +
                '<a class="ne-share-btn" href="mailto:?subject=' + encT + "&body=" + enc + '" aria-label="Share by email">✉</a>' +
                '<button class="ne-share-btn" type="button" id="neCopy" data-url="' + esc(pageUrl) + '" aria-label="Copy link">🔗</button>' +
                "</div></div></aside></div>" +
            relatedHTML +
            '<a class="ne-back" href="news-events.html">← Back to News &amp; Events</a>';

        var copyBtn = document.getElementById("neCopy");
        if (copyBtn) copyBtn.addEventListener("click", function () {
            var url = copyBtn.getAttribute("data-url");
            var done = function () { var p = copyBtn.textContent; copyBtn.textContent = "✓"; setTimeout(function () { copyBtn.textContent = p; }, 1500); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
            else { var t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(t); done(); }
        });
    }

    function initDetail(root) {
        var slug = getParam("slug").toLowerCase().replace(/[^a-z0-9\-]/g, "");
        if (!slug) { root.innerHTML = notFound(); return; }
        loadItems().then(function (items) {
            var item = null;
            for (var i = 0; i < items.length; i++) if (items[i].slug === slug) { item = items[i]; break; }
            if (!item) { root.innerHTML = notFound(); return; }
            renderDetail(root, item, items);
        }).catch(function (e) {
            root.innerHTML = '<p class="ne-empty">Could not load this item (' + esc(e.message) + ").</p>";
        });
    }
    function notFound() {
        return '<section class="ne-notfound"><h1>Item not found</h1>' +
               "<p>This news or event item doesn’t exist or may have been moved.</p>" +
               '<a class="ne-back" href="news-events.html">← Back to News &amp; Events</a></section>';
    }

    /* ---------- boot ---------- */
    function boot() {
        var grid = document.getElementById("neGrid");
        var detail = document.getElementById("neDetailRoot");
        if (grid) initLanding(grid);
        else if (detail) initDetail(detail);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
