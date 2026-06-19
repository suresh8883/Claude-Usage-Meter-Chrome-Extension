/* Usage Meter for Claude — popup */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var DEF = { pollSeconds: 15, debug: false, hidden: false };
  var CLAUDE_RE = /^https:\/\/([a-z0-9-]+\.)?claude\.ai\//i;

  function getCfg() {
    return new Promise(function (r) {
      chrome.storage.local.get(["cfg"], function (d) { r(Object.assign({}, DEF, d.cfg || {})); });
    });
  }
  function setCfg(c) { return new Promise(function (r) { chrome.storage.local.set({ cfg: c }, r); }); }
  function activeTab() {
    return new Promise(function (r) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (t) { r(t && t[0]); });
    });
  }

  function refreshStatus() {
    activeTab().then(function (t) {
      if (!t || !CLAUDE_RE.test(t.url || "")) { $("#status").textContent = "Open a claude.ai tab to use this."; return; }
      chrome.tabs.sendMessage(t.id, { type: "cum-status" }, function (resp) {
        if (chrome.runtime.lastError || !resp) {
          $("#status").textContent = "Loading on this tab… reload claude.ai if this persists.";
          return;
        }
        if (resp.hasData) {
          var ago = Math.round((Date.now() - resp.at) / 1000);
          var t2 = ago < 60 ? (ago <= 1 ? "just now" : ago + "s ago") : Math.round(ago / 60) + "m ago";
          $("#status").textContent = "Live · updated " + t2;
        } else if (resp.status === "error") {
          $("#status").textContent = "Can't reach usage — make sure you're signed in.";
        } else {
          $("#status").textContent = "Loading usage…";
        }
      });
    });
  }

  function load() {
    getCfg().then(function (c) {
      $("#poll").value = c.pollSeconds;
      $("#debug").checked = c.debug;
      $("#hidden").checked = c.hidden;
      refreshStatus();
    });
  }
  function save() {
    var c = {
      pollSeconds: Math.max(10, parseInt($("#poll").value || "15", 10)),
      debug: $("#debug").checked,
      hidden: $("#hidden").checked
    };
    return setCfg(c);
  }

  $("#refresh").addEventListener("click", function () {
    activeTab().then(function (t) {
      if (!t || !CLAUDE_RE.test(t.url || "")) { $("#status").textContent = "Open a claude.ai tab first."; return; }
      chrome.tabs.sendMessage(t.id, { type: "cum-poll" }, function () { setTimeout(refreshStatus, 700); });
    });
  });
  $("#sync").addEventListener("click", function () {
    chrome.tabs.create({ url: "https://claude.ai/settings/usage" });
  });

  ["#poll", "#debug", "#hidden"].forEach(function (s) { $(s).addEventListener("change", save); });

  load();
})();
