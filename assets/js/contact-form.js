/* ============================================================
   Contact-form AJAX submitter — Fair Finance Pakistan
   Wires every form[data-contact-form] to api/contact.php and
   shows an inline status message. No dependencies.
   ============================================================ */
(function () {
    "use strict";

    var ENDPOINT = "api/contact.php";

    function statusEl(form) {
        var el = form.querySelector(".ff-form-status");
        if (!el) {
            el = document.createElement("p");
            el.className = "ff-form-status";
            el.setAttribute("role", "status");
            el.setAttribute("aria-live", "polite");
            el.style.cssText = "margin:16px 0 0;font-size:15px;line-height:1.5;display:none;";
            form.appendChild(el);
        }
        return el;
    }

    function setStatus(form, msg, kind) {
        var el = statusEl(form);
        el.textContent = msg;
        el.style.display = "block";
        el.style.color = kind === "error" ? "#cc0033" : (kind === "success" ? "#1c8a6a" : "#617176");
    }

    function firstInvalid(form) {
        var required = form.querySelectorAll("[required]");
        for (var i = 0; i < required.length; i++) {
            var f = required[i];
            if (!String(f.value || "").trim()) return f;
            if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value)) return f;
        }
        var email = form.querySelector('input[type="email"], input[name="email"]');
        if (email && email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) return email;
        return null;
    }

    function handle(form) {
        // identify which form
        var source = form.getAttribute("data-contact-form") || "general-contact";

        form.addEventListener("submit", function (e) {
            e.preventDefault();

            // The PHP handler only runs when the page is served by a web server.
            // Over file:// the browser blocks fetch() (a "CORS error") and PHP
            // never executes — tell the user the real cause.
            if (location.protocol === "file:") {
                setStatus(form, "This form needs the site to be opened through the web server " +
                    "(e.g. http://fair-finance.test/about.html), not as a local file.", "error");
                return;
            }

            var bad = firstInvalid(form);
            if (bad) {
                setStatus(form, "Please complete all required fields with a valid email.", "error");
                if (typeof bad.focus === "function") bad.focus();
                return;
            }

            var btn = form.querySelector('button[type="submit"], .cf-submit-btn, .about-submit-btn, .collab-contact-button');
            var originalText = btn ? btn.innerHTML : "";
            if (btn) { btn.disabled = true; btn.dataset.busy = "1"; btn.innerHTML = "Sending…"; }
            setStatus(form, "Sending your message…", "info");

            var data = new FormData(form);
            data.set("form_source", source);

            fetch(ENDPOINT, { method: "POST", body: data, headers: { "Accept": "application/json" } })
                .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
                .then(function (res) {
                    if (res && res.ok) {
                        setStatus(form, res.message || "Thank you — your message has been received.", "success");
                        form.reset();
                    } else {
                        setStatus(form, (res && res.message) || "Sorry, your message could not be sent. Please try again.", "error");
                    }
                })
                .catch(function () {
                    setStatus(form, "Network error — please check your connection and try again.", "error");
                })
                .finally(function () {
                    if (btn) { btn.disabled = false; btn.innerHTML = originalText; delete btn.dataset.busy; }
                });
        });
    }

    function init() {
        var forms = document.querySelectorAll("form[data-contact-form]");
        for (var i = 0; i < forms.length; i++) handle(forms[i]);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
