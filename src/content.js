/* Usage Meter for Claude — content script (ISOLATED world)
 *
 * Calls Claude's own usage API directly (no waiting, no sniffing):
 *   GET /api/organizations                  -> find org uuid (chat capability)
 *   GET /api/organizations/{uuid}/usage     -> { five_hour:{utilization,resets_at},
 *                                                seven_day:{utilization,resets_at} }
 *
 * Renders two meters ("5 Hrs", "Weekly") just above the composer. Fetches on
 * load, re-polls every pollSeconds while the tab is visible, refreshes on
 * tab-focus, and force-refreshes right after a response finishes streaming.
 * Last values are cached so the bar shows instantly on the next page load.
 */
(function () {
  "use strict";

  var TAG = "[UsageMeter]";
  var BAR_ID = "cum-bar";
  var ORG_TTL = 10 * 60 * 1000; // re-resolve org id at most every 10 min

  var DEFAULTS = {
    pollSeconds: 15,   // live-ish refresh while tab is visible
    debug: false,
    hidden: false,     // full hide (popup only)
    collapsed: false,  // minimized to a small restore chip
    staleMinutes: 10
  };

  var cfg = shallow(DEFAULTS);
  var usage = null;          // { five:{pct,resetMs}|null, weekly:{...}|null, at }
  var status = "loading";    // loading | ok | empty | error
  var orgId = null, orgIdAt = 0, orgInFlight = null;
  var usageInFlight = false;
  var pollTimer = null, uiTimer = null;

  function shallow(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function log() { if (cfg.debug) { try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (_) {} } }

  /* ----------------------------- storage ----------------------------- */
  function loadAll() {
    return new Promise(function (res) {
      chrome.storage.local.get(["cfg", "usage", "orgId", "orgIdAt"], function (d) {
        if (d.cfg) {
          var stored = d.cfg;
          cfg = Object.assign(shallow(DEFAULTS), stored);
          // migrate older "✕ = hidden with no way back" state
          if (typeof stored.collapsed === "undefined" && cfg.hidden) {
            cfg.hidden = false;
            chrome.storage.local.set({ cfg: cfg });
          }
        }
        if (d.usage) { usage = d.usage; status = (usage.five || usage.weekly) ? "ok" : status; }
        if (d.orgId) { orgId = d.orgId; orgIdAt = d.orgIdAt || 0; }
        res();
      });
    });
  }

  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local" || !ch.cfg) return;
    cfg = Object.assign(shallow(DEFAULTS), ch.cfg.newValue || {});
    restartPolling();
    render();
  });

  // popup <-> content
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === "cum-poll") { loadUsage(true).then(function () { sendResponse({ ok: true, status: status }); }); return true; }
    if (msg.type === "cum-status") { sendResponse({ hasData: !!(usage && (usage.five || usage.weekly)), at: usage && usage.at, status: status, cfg: cfg }); return true; }
  });

  /* --------------------------- API calls ----------------------------- */
  function getOrgId() {
    if (orgId && Date.now() - orgIdAt < ORG_TTL) return Promise.resolve(orgId);
    if (orgInFlight) return orgInFlight;
    orgInFlight = fetch("/api/organizations", { credentials: "include", headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("orgs " + r.status); return r.json(); })
      .then(function (orgs) {
        if (!Array.isArray(orgs) || !orgs.length) throw new Error("no orgs");
        var org = null;
        for (var i = 0; i < orgs.length; i++) {
          if (orgs[i] && orgs[i].capabilities && orgs[i].capabilities.indexOf("chat") > -1) { org = orgs[i]; break; }
        }
        if (!org) org = orgs[0];
        var id = org.uuid || org.id;
        if (!id) throw new Error("no org id");
        orgId = id; orgIdAt = Date.now();
        try { chrome.storage.local.set({ orgId: orgId, orgIdAt: orgIdAt }); } catch (_) {}
        return id;
      })
      .then(function (id) { orgInFlight = null; return id; }, function (e) { orgInFlight = null; throw e; });
    return orgInFlight;
  }

  function loadUsage(force) {
    if (usageInFlight) return Promise.resolve();
    usageInFlight = true;
    if (!usage) { status = "loading"; render(); }
    return getOrgId()
      .then(function (id) {
        return fetch("/api/organizations/" + id + "/usage", { credentials: "include", headers: { Accept: "application/json" }, cache: "no-store" });
      })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error("auth " + r.status);
        if (!r.ok) throw new Error("usage " + r.status);
        return r.json();
      })
      .then(function (data) {
        log("usage payload:", data);
        usage = parseUsage(data);
        status = (usage.five || usage.weekly) ? "ok" : "empty";
        try { chrome.storage.local.set({ usage: usage }); } catch (_) {}
        render();
      })
      .catch(function (err) {
        log("loadUsage error:", err);
        // If the org id might be stale, drop it so the next try re-resolves.
        if (("" + err).indexOf("usage 4") > -1) { orgId = null; }
        if (!usage) { status = ("" + err).indexOf("auth") > -1 ? "error" : "error"; render(); }
      })
      .then(function () { usageInFlight = false; });
  }

  /* ---------------------------- parsing ------------------------------ */
  // Primary: exact fields. Fallback: scan for utilization/resets pairs.
  function oneNode(node) {
    if (node && typeof node.utilization === "number") {
      // Claude's usage API returns utilization as a 0–100 percentage already
      // (1 means 1%, 17 means 17%). Do NOT rescale — just clamp to 0–100.
      // (The old "fraction form" heuristic wrongly turned 1% into 100%.)
      var p = Math.max(0, Math.min(100, node.utilization));
      return { pct: p, resetMs: node.resets_at ? Date.parse(node.resets_at) : null };
    }
    return null;
  }

  var WEEKLY_RE = /(seven|7)[\s_-]*day|weekl|week/i;
  var FIVEH_RE = /(five|5)[\s_-]*(h\b|hr|hour)|hourly|session/i;

  function parseUsage(data) {
    var five = oneNode(data && data.five_hour);
    var weekly = oneNode(data && data.seven_day);
    if (five || weekly) return { five: five, weekly: weekly, at: Date.now() };

    // Fallback scan (in case Anthropic renames the wrapper keys)
    var found = [];
    (function scan(obj, key) {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) scan(obj[i], key); return; }
      if (typeof obj.utilization === "number") {
        var n = oneNode(obj);
        if (n) { n.hint = (String(key || "") + " " + Object.keys(obj).join(" ")).toLowerCase(); found.push(n); }
      }
      var ks = Object.keys(obj);
      for (var j = 0; j < ks.length; j++) scan(obj[ks[j]], ks[j]);
    })(data, "");

    var f = null, w = null;
    for (var k = 0; k < found.length; k++) {
      var h = found[k].hint || "";
      if (!w && WEEKLY_RE.test(h)) { w = found[k]; continue; }
      if (!f && FIVEH_RE.test(h)) { f = found[k]; }
    }
    if (!f && !w && found.length) { f = found[0]; w = found[1] || null; }
    return { five: f, weekly: w, at: Date.now() };
  }

  function metersFromUsage(u) {
    var out = [];
    if (u && u.five) out.push({ label: "5 Hrs", usedPct: u.five.pct, reset: u.five.resetMs ? new Date(u.five.resetMs) : null });
    if (u && u.weekly) out.push({ label: "Weekly", usedPct: u.weekly.pct, reset: u.weekly.resetMs ? new Date(u.weekly.resetMs) : null });
    return out;
  }

  /* ---------------------------- rendering ---------------------------- */
  function colorClass(p) { return p >= 80 ? "cum-red" : p >= 50 ? "cum-amber" : "cum-green"; }

  // Precise, human time-until-reset, e.g. "2 hr 48 min", "4 days 6 hr".
  function relFuture(d) {
    if (!d) return "";
    var ms = +d - Date.now();
    if (ms <= 0) return "resets now";
    var totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return "< 1 min";
    var days = Math.floor(totalMin / 1440);
    var hrs = Math.floor((totalMin % 1440) / 60);
    var mins = totalMin % 60;
    var parts = [];
    if (days > 0) {
      parts.push(days + " day" + (days > 1 ? "s" : ""));
      if (hrs > 0) parts.push(hrs + " hr");
    } else if (hrs > 0) {
      parts.push(hrs + " hr");
      if (mins > 0) parts.push(mins + " min");
    } else {
      parts.push(mins + " min");
    }
    return parts.join(" ");
  }
  function relPast(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 10) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
  }

  function setCollapsed(v) { cfg.collapsed = v; try { chrome.storage.local.set({ cfg: cfg }); } catch (_) {} render(); }

  var barEl = null, els = null;

  // Build the bar skeleton ONCE; later we only update text/width/colors so the
  // fills animate smoothly and nothing flickers.
  function buildStructure(bar) {
    bar.textContent = "";
    var main = document.createElement("div"); main.className = "cum-main";
    var body = document.createElement("div"); body.className = "cum-body";

    function meterRow(labelText) {
      var row = document.createElement("div"); row.className = "cum-meter";
      var label = document.createElement("span"); label.className = "cum-label"; label.textContent = labelText;
      var track = document.createElement("span"); track.className = "cum-track";
      var fill = document.createElement("span"); fill.className = "cum-fill"; track.appendChild(fill);
      var pct = document.createElement("span"); pct.className = "cum-pct";
      var reset = document.createElement("span"); reset.className = "cum-reset";
      row.appendChild(label); row.appendChild(track); row.appendChild(pct); row.appendChild(reset);
      return { row: row, fill: fill, pct: pct, reset: reset };
    }

    var five = meterRow("5 Hrs");
    var divider = document.createElement("span"); divider.className = "cum-divider";
    var weekly = meterRow("Weekly");
    var statusEl = document.createElement("span"); statusEl.className = "cum-status";
    body.appendChild(five.row); body.appendChild(divider); body.appendChild(weekly.row); body.appendChild(statusEl);

    var meta = document.createElement("div"); meta.className = "cum-meta";
    var live = document.createElement("span"); live.className = "cum-live"; live.title = "Live";
    var updated = document.createElement("span"); updated.className = "cum-updated";
    var min = document.createElement("span"); min.className = "cum-min"; min.title = "Minimize";
    min.innerHTML = svg('<path d="M18 15l-6-6-6 6"/>');
    min.addEventListener("click", function () { setCollapsed(true); });
    meta.appendChild(live); meta.appendChild(updated); meta.appendChild(min);

    main.appendChild(body); main.appendChild(meta);

    var chip = document.createElement("span"); chip.className = "cum-restore"; chip.title = "Show usage";
    var chipDot = document.createElement("span"); chipDot.className = "cum-live";
    var chipText = document.createElement("span"); chipText.className = "cum-chip-text"; chipText.textContent = "Usage";
    var chipIcon = document.createElement("span"); chipIcon.className = "cum-chev"; chipIcon.innerHTML = svg('<path d="M6 9l6 6 6-6"/>');
    chip.appendChild(chipDot); chip.appendChild(chipText); chip.appendChild(chipIcon);
    chip.addEventListener("click", function () { setCollapsed(false); });

    bar.appendChild(main); bar.appendChild(chip);
    els = { main: main, five: five, divider: divider, weekly: weekly, status: statusEl, live: live, updated: updated, chip: chip };
  }

  function setMeter(m, data) {
    if (!data) { m.row.style.display = "none"; return; }
    m.row.style.display = "";
    m.fill.className = "cum-fill " + colorClass(data.pct);
    m.fill.style.width = Math.round(data.pct) + "%";
    m.pct.textContent = (Math.round(data.pct * 10) / 10) + "%";
    if (data.resetMs) {
      var d = new Date(data.resetMs);
      m.reset.style.display = ""; m.reset.textContent = "· " + relFuture(d);
      try { m.reset.title = "Resets " + d.toLocaleString(); } catch (_) {}
    } else { m.reset.style.display = "none"; m.reset.textContent = ""; }
  }

  function render() {
    if (cfg.hidden) { if (barEl) { barEl.remove(); barEl = null; els = null; } return; }
    var anchor = findAnchor();
    if (!anchor || !anchor.parentElement) return;

    if (!barEl) { barEl = document.createElement("div"); barEl.id = BAR_ID; }
    if (!els) { buildStructure(barEl); setTimeout(function () { if (barEl) barEl.style.animation = "none"; }, 360); }
    if (barEl.parentElement !== anchor.parentElement || barEl.nextSibling !== anchor) {
      anchor.parentElement.insertBefore(barEl, anchor);
    }

    barEl.classList.toggle("cum-collapsed", !!cfg.collapsed);
    if (cfg.collapsed) { els.main.style.display = "none"; els.chip.style.display = ""; return; }
    els.main.style.display = ""; els.chip.style.display = "none";

    if (usage && (usage.five || usage.weekly)) {
      els.status.style.display = "none";
      setMeter(els.five, usage.five);
      setMeter(els.weekly, usage.weekly);
      els.divider.style.display = (usage.five && usage.weekly) ? "" : "none";
      els.live.style.display = ""; els.updated.style.display = "";
      var ageMin = (Date.now() - usage.at) / 60000;
      els.updated.textContent = (ageMin > cfg.staleMinutes ? "stale · " : "") + relPast(usage.at);
    } else {
      els.five.row.style.display = "none";
      els.weekly.row.style.display = "none";
      els.divider.style.display = "none";
      els.status.style.display = "";
      els.status.textContent = status === "error" ? "Can't reach usage — sign in to claude.ai"
        : status === "empty" ? "Couldn't read usage (enable Debug)" : "Loading usage…";
      els.live.style.display = "none"; els.updated.style.display = "none";
    }
  }

  // Sit just above the composer.
  function findAnchor() {
    var editable = document.querySelector('div[contenteditable="true"]') || document.querySelector("textarea");
    if (!editable) return null;
    var form = editable.closest("form") || editable.closest("fieldset");
    return form || editable;
  }

  /* ------------------------- live triggers --------------------------- */
  // Force a refresh shortly after a response finishes streaming.
  function watchGeneration() {
    var active = false;
    var mo = new MutationObserver(function () {
      var stop = document.querySelector('[data-testid="stop-button"], button[aria-label="Stop"]');
      var send = document.querySelector('[data-testid="send-button"], button[aria-label="Send message"]');
      if (stop) { active = true; return; }
      if (active && send) { active = false; setTimeout(function () { loadUsage(true); }, 1200); }
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  var scheduled = false;
  function schedule() { if (scheduled) return; scheduled = true; setTimeout(function () { scheduled = false; render(); }, 200); }
  function observeDom() { new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true }); }

  function restartPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (document.visibilityState !== "visible") return;
    var ms = Math.max(10, cfg.pollSeconds | 0) * 1000;
    loadUsage(true);
    pollTimer = setInterval(function () { loadUsage(true); }, ms);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") restartPolling();
    else if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  });

  /* ----------------------------- init -------------------------------- */
  function init() {
    loadAll().then(function () {
      observeDom();
      render();                 // instant paint from cache (if any)
      restartPolling();         // immediate fetch + interval
      if (document.body) watchGeneration();
      else document.addEventListener("DOMContentLoaded", watchGeneration);
      // light UI tick so "updated Ns ago" and reset countdowns stay fresh
      if (uiTimer) clearInterval(uiTimer);
      uiTimer = setInterval(render, 1000);
    });
  }
  init();
})();
