/* ============================================================
   Global header behaviour — Fair Finance Pakistan
   Toggles the slide-out search panel in .global-nav.

   Only include this on pages that do NOT already carry the same
   logic inline, or the two handlers cancel each other out.
   ============================================================ */
(function () {
    "use strict";

    function boot() {
        var toggle = document.querySelector(".search-toggle");
        var panel = document.getElementById("headerSearchPanel");
        var input = document.getElementById("headerSearchInput");
        if (!toggle || !panel || !input) return;

        function closePanel() {
            panel.classList.remove("is-open");
            toggle.setAttribute("aria-expanded", "false");
        }

        toggle.addEventListener("click", function (e) {
            e.preventDefault();
            var willOpen = !panel.classList.contains("is-open");
            panel.classList.toggle("is-open", willOpen);
            toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
            if (willOpen) input.focus();
        });

        document.addEventListener("click", function (e) {
            if (!panel.contains(e.target) && !toggle.contains(e.target)) {
                closePanel();
            }
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closePanel();
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
