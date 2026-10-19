(function () {
  "use strict";

  var MAX_CHARS = 4000;
  var MAX_HISTORY = 20; // messages sent to the server as context
  var CLIENT_TIMEOUT_MS = 45000;

  var messagesEl = document.getElementById("messages");
  var emptyEl = document.getElementById("empty-state");
  var form = document.getElementById("composer");
  var input = document.getElementById("composer-input");
  var sendBtn = document.getElementById("send");
  var charCount = document.getElementById("char-count");
  var newChatBtn = document.getElementById("new-chat");
  var themeBtn = document.getElementById("theme-toggle");
  var suggestions = document.getElementById("suggestions");

  var history = []; // { role: "user" | "assistant", content: string }
  var busy = false;
  var controller = null;

  // ---------- Theme ----------
  function currentTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }
  function syncThemeButton() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    themeBtn.setAttribute("aria-label", "Switch to " + next + " theme");
    themeBtn.title = "Switch to " + next + " theme";
  }
  themeBtn.addEventListener("click", function () {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("orbit-theme", next); } catch (e) {}
    syncThemeButton();
  });
  syncThemeButton();

  // ---------- Minimal, safe Markdown ----------
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function renderMarkdown(text) {
    var parts = escapeHtml(text).split(/```/);
    var html = "";
    parts.forEach(function (part, i) {
      if (i % 2 === 1) {
        var code = part.replace(/^[\w+-]*\n/, "");
        html += "<pre><code>" + code.replace(/\n$/, "") + "</code></pre>";
        return;
      }
      var lines = part.split("\n");
      var list = null; // "ul" | "ol"
      var para = [];
      function flushPara() {
        if (para.length) { html += "<p>" + inline(para.join("<br>")) + "</p>"; para = []; }
      }
      function closeList() { if (list) { html += "</" + list + ">"; list = null; } }
      lines.forEach(function (line) {
        var ul = line.match(/^\s*[-*•]\s+(.*)$/);
        var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
        var h = line.match(/^#{1,6}\s+(.*)$/);
        if (ul || ol) {
          flushPara();
          var type = ul ? "ul" : "ol";
          if (list !== type) { closeList(); html += "<" + type + ">"; list = type; }
          html += "<li>" + inline((ul || ol)[1]) + "</li>";
        } else if (h) {
          flushPara(); closeList();
          html += "<h3>" + inline(h[1]) + "</h3>";
        } else if (!line.trim()) {
          flushPara(); closeList();
        } else {
          closeList();
          para.push(line);
        }
      });
      flushPara(); closeList();
    });
    return html;
  }

  // ---------- Rendering ----------
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text, opts) {
    opts = opts || {};
    if (emptyEl) emptyEl.hidden = true;
    var wrap = document.createElement("div");
    wrap.className = "msg " + (role === "user" ? "msg-user" : "msg-bot") + (opts.error ? " msg-error" : "");
    var label = document.createElement("p");
    label.className = "label";
    label.textContent = role === "user" ? "YOU" : opts.error ? "ORBIT · ERROR" : "ORBIT";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "user" || opts.error) bubble.textContent = text;
    else bubble.innerHTML = renderMarkdown(text);
    wrap.appendChild(label);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function addTyping() {
    var wrap = document.createElement("div");
    wrap.className = "msg msg-bot";
    wrap.id = "typing";
    wrap.innerHTML =
      '<p class="label">ORBIT · THINKING</p>' +
      '<div class="bubble typing" role="status" aria-label="Orbit is thinking"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }
  function removeTyping() {
    var t = document.getElementById("typing");
    if (t) t.remove();
  }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b || !input.value.trim() || input.value.length > MAX_CHARS;
    form.setAttribute("aria-busy", b ? "true" : "false");
  }

  function updateComposer() {
    var len = input.value.length;
    charCount.textContent = len + "/" + MAX_CHARS;
    charCount.classList.toggle("over", len > MAX_CHARS * 0.9);
    sendBtn.disabled = busy || !input.value.trim() || len > MAX_CHARS;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight + 2, 180) + "px";
  }

  // ---------- Networking ----------
  function requestReply() {
    setBusy(true);
    addTyping();
    controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, CLIENT_TIMEOUT_MS);
    var thisController = controller;

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) }),
      signal: controller.signal
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.reply) {
            throw new Error(data.error || "Something went wrong (HTTP " + res.status + ").");
          }
          return data.reply;
        });
      })
      .then(function (reply) {
        if (thisController !== controller) return; // chat was reset
        removeTyping();
        history.push({ role: "assistant", content: reply });
        addMessage("assistant", reply);
      })
      .catch(function (err) {
        if (thisController !== controller) return;
        removeTyping();
        var msg = err.name === "AbortError"
          ? (timedOut ? "The request timed out. Please try again." : "Request cancelled.")
          : err.message === "Failed to fetch"
            ? "Couldn’t reach the server. Check your connection and try again."
            : err.message;
        var el = addMessage("assistant", msg, { error: true });
        var retry = document.createElement("button");
        retry.type = "button";
        retry.className = "retry";
        retry.textContent = "RETRY";
        retry.addEventListener("click", function () {
          el.remove();
          requestReply();
        });
        el.appendChild(retry);
        retry.focus();
      })
      .finally(function () {
        clearTimeout(timer);
        if (thisController !== controller) return;
        controller = null;
        setBusy(false);
        updateComposer();
      });
  }

  function send(text) {
    text = text.trim();
    if (!text || busy) return;
    if (text.length > MAX_CHARS) return;
    history.push({ role: "user", content: text });
    if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY * 2);
    addMessage("user", text);
    input.value = "";
    updateComposer();
    requestReply();
  }

  // ---------- Events ----------
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    send(input.value);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    }
  });
  input.addEventListener("input", updateComposer);

  suggestions.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (chip) send(chip.textContent);
  });

  newChatBtn.addEventListener("click", function () {
    if (controller) controller.abort();
    controller = null;
    history = [];
    Array.prototype.slice.call(messagesEl.querySelectorAll(".msg")).forEach(function (n) { n.remove(); });
    if (emptyEl) emptyEl.hidden = false;
    input.value = "";
    setBusy(false);
    updateComposer();
    input.focus();
  });

  updateComposer();
})();
