export function getDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent Bus Dashboard</title>
    <style>
      :root {
        --bg: #1a1a2e;
        --card: #1e293b;
        --border: #2d3748;
        --text: #e0e0e0;
        --muted: #94a3b8;
        --green: #4ade80;
        --blue: #60a5fa;
        --amber: #fbbf24;
        --red: #f87171;
        --gray: #9ca3af;
        --dim: #6b7280;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        background: radial-gradient(circle at 20% -20%, #2f3c5f 0%, var(--bg) 55%);
        color: var(--text);
      }
      .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
      .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
      h1 { margin: 0; font-size: 22px; }
      .connection { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
      .dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--border); background: var(--gray); }
      .dot.live { background: var(--green); }
      .dot.reconnecting { background: var(--amber); animation: pulse 1s infinite ease-in-out; }
      .dot.disconnected { background: var(--dim); }
      @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
      @keyframes flash {
        from { box-shadow: inset 0 0 0 999px rgba(251, 191, 36, 0.22); }
        to { box-shadow: inset 0 0 0 999px rgba(251, 191, 36, 0); }
      }
      .controls { margin: 10px 0 18px; color: var(--muted); font-size: 13px; }
      .controls label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
      .section { background: var(--card); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
      .section[hidden] { display: none; }
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        border-bottom: 1px solid var(--border);
        background: rgba(0, 0, 0, 0.12);
      }
      .badge {
        background: #111827;
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1;
        padding: 4px 8px;
      }
      .row { padding: 12px 14px; border-bottom: 1px solid rgba(45, 55, 72, 0.5); }
      .row:last-child { border-bottom: 0; }
      .row.flash { animation: flash 1.5s ease-out; }
      .run-row { cursor: pointer; }
      .run-main, .failure-main, .approval-main {
        display: grid;
        grid-template-columns: minmax(80px, 140px) minmax(100px, 160px) 1fr auto;
        gap: 10px;
        align-items: center;
      }
      .muted { color: var(--muted); }
      .status { display: inline-flex; align-items: center; gap: 6px; }
      .status-pill {
        border-radius: 999px;
        border: 1px solid var(--border);
        padding: 3px 8px;
        font-size: 11px;
        text-transform: lowercase;
      }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; }
      .status-completed { color: var(--green); }
      .status-leased, .status-in_progress { color: var(--blue); }
      .status-retry_scheduled, .status-attention_required { color: var(--amber); }
      .status-dead_letter { color: var(--red); }
      .status-ready, .status-awaiting_approval { color: var(--gray); }
      .status-pending_approval { color: var(--gray); border-style: dashed; }
      .status-cancelled { color: var(--dim); }
      .dot-completed { background: var(--green); }
      .dot-leased, .dot-in_progress { background: var(--blue); }
      .dot-retry_scheduled, .dot-attention_required { background: var(--amber); }
      .dot-dead_letter { background: var(--red); }
      .dot-ready, .dot-awaiting_approval { background: var(--gray); }
      .dot-pending_approval { border: 1px solid var(--gray); background: transparent; }
      .dot-cancelled { background: var(--dim); }
      .run-detail {
        margin-top: 10px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.14);
        padding: 10px;
      }
      .detail-block { margin-bottom: 12px; }
      .detail-block:last-child { margin-bottom: 0; }
      .detail-title {
        margin: 0 0 8px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.7px;
        color: var(--muted);
      }
      .detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .detail-table th, .detail-table td {
        text-align: left;
        padding: 6px;
        border-bottom: 1px solid rgba(45, 55, 72, 0.45);
      }
      .detail-table tr:last-child th, .detail-table tr:last-child td { border-bottom: 0; }
      .highlight { outline: 1px solid var(--amber); background: rgba(251, 191, 36, 0.08); }
      .empty { color: var(--muted); padding: 12px 14px; }
      @media (max-width: 768px) {
        .container { padding: 14px; }
        .run-main, .failure-main, .approval-main { grid-template-columns: 1fr; gap: 6px; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Agent Bus</h1>
        <div class="connection">
          <span id="connection-dot" class="dot disconnected"></span>
          <span id="connection-label">disconnected</span>
        </div>
      </div>
      <div class="controls">
        <label><input id="show-all" type="checkbox" /> Show all sections</label>
        <div style="margin-top:8px">Security: localhost-only dashboard (no authentication in v1).</div>
      </div>
      <section id="approvals-section" class="section">
        <div class="section-header"><strong>Pending Approvals</strong><span id="approvals-count" class="badge">0</span></div>
        <div id="approvals-list"></div>
      </section>
      <section id="failures-section" class="section">
        <div class="section-header"><strong>Failures</strong><span id="failures-count" class="badge">0</span></div>
        <div id="failures-list"></div>
      </section>
      <section id="runs-section" class="section">
        <div class="section-header"><strong>Runs</strong><span id="runs-count" class="badge">0</span></div>
        <div id="runs-list"></div>
      </section>
    </div>
    <script>
      const state = { runs: [], approvals: [], failures: [], expandedRunId: null, runDetails: new Map(), retryMs: 3000 };
      const byId = (id) => document.getElementById(id);
      const statusClass = (status) => String(status || "unknown").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
      const shortId = (id) => String(id || "").slice(0, 8);
      const toText = (value) => String(value ?? "");
      const escapeHtml = (value) =>
        toText(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      const escapeAttr = (value) => escapeHtml(value).replace(/\u0060/g, "&#96;");
      const safeDomId = (value) => toText(value).replace(/[^a-zA-Z0-9_-]/g, "_");
      function relativeTime(iso) {
        const time = Date.parse(iso || "");
        if (Number.isNaN(time)) return "unknown";
        const diff = Math.max(0, Date.now() - time);
        const sec = Math.floor(diff / 1000);
        if (sec < 10) return "just now";
        if (sec < 60) return sec + "s ago";
        const min = Math.floor(sec / 60);
        if (min < 60) return min + "m ago";
        const hr = Math.floor(min / 60);
        if (hr < 24) return hr + "h ago";
        return Math.floor(hr / 24) + "d ago";
      }
      function setIndicator(next) {
        const dot = byId("connection-dot");
        const label = byId("connection-label");
        dot.className = "dot " + next;
        label.textContent = next;
      }
      function applySectionVisibility() {
        const showAll = byId("show-all").checked;
        byId("approvals-section").hidden = !(showAll || state.approvals.length > 0);
        byId("failures-section").hidden = !(showAll || state.failures.length > 0);
        byId("runs-section").hidden = !(showAll || state.runs.length > 0);
      }
      function statusPill(status) {
        return '<span class="status-pill status-' + statusClass(status) + '">' + escapeHtml(status || "unknown") + "</span>";
      }
      function statusDot(status) {
        return '<span class="status-dot dot-' + statusClass(status) + '"></span>';
      }
      function flashRow(id) {
        const el = byId(id);
        if (!el) return;
        el.classList.add("flash");
        setTimeout(() => el.classList.remove("flash"), 1500);
      }
      async function fetchJson(path) {
        const response = await fetch(path, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("Request failed: " + path + " status=" + response.status);
        return response.json();
      }
      function renderApprovals() {
        const root = byId("approvals-list");
        byId("approvals-count").textContent = String(state.approvals.length);
        if (state.approvals.length === 0) {
          root.innerHTML = '<div class="empty">No pending approvals.</div>';
          applySectionVisibility();
          return;
        }
        root.innerHTML = state.approvals
          .map((approval) => {
            const requestedAt = toText(approval.requestedAt);
            return (
            '<div class="row"><div class="approval-main">' +
              "<div>" + escapeHtml(shortId(approval.approvalId)) + "</div>" +
              '<div class="muted">' + escapeHtml(approval.topic) + "</div>" +
              '<div class="muted">run ' + escapeHtml(shortId(approval.runId)) + "</div>" +
              '<div class="muted" data-relative-time="' + escapeAttr(requestedAt) + '">' + escapeHtml(relativeTime(requestedAt)) + "</div>" +
            "</div></div>"
            );
          })
          .join("");
        applySectionVisibility();
      }
      function renderFailures() {
        const root = byId("failures-list");
        byId("failures-count").textContent = String(state.failures.length);
        if (state.failures.length === 0) {
          root.innerHTML = '<div class="empty">No failures.</div>';
          applySectionVisibility();
          return;
        }
        root.innerHTML = state.failures
          .map((failure) => {
            const deliveryId = toText(failure.deliveryId);
            const runId = toText(failure.runId);
            return (
            '<div class="row" id="failure-' + safeDomId(deliveryId) + '">' +
              '<button class="failure-main" type="button" data-failure-run-id="' + escapeAttr(runId) + '" data-failure-delivery-id="' + escapeAttr(deliveryId) + '" style="all:unset;display:grid;grid-template-columns:minmax(80px,140px) minmax(100px,160px) 1fr auto;gap:10px;cursor:pointer;width:100%;">' +
                "<div>" + escapeHtml(shortId(deliveryId)) + "</div>" +
                '<div class="muted">' + escapeHtml(failure.agentId) + "</div>" +
                '<div class="muted">' + escapeHtml(toText(failure.lastError || "unknown error").slice(0, 80)) + "</div>" +
                '<div class="muted">' + escapeHtml(toText(failure.attemptCount) + "/" + toText(failure.maxAttempts)) + "</div>" +
              "</button></div>"
            );
          })
          .join("");
        root.querySelectorAll("[data-failure-run-id]").forEach((button) => {
          button.addEventListener("click", async () => {
            const runId = button.getAttribute("data-failure-run-id");
            const deliveryId = button.getAttribute("data-failure-delivery-id");
            if (!runId || !deliveryId) return;
            await expandRun(runId, deliveryId);
          });
        });
        applySectionVisibility();
      }
      function renderRunDetail(runId) {
        const detail = state.runDetails.get(runId);
        if (!detail) return '<div class="run-detail"><div class="muted">Loading...</div></div>';
        const deliveriesRows = detail.deliveries.map((delivery) => {
          const deliveryId = toText(delivery.deliveryId);
          const updatedAt = toText(delivery.updatedAt);
          return (
          '<tr id="delivery-' + safeDomId(deliveryId) + '">' +
            "<td>" + escapeHtml(delivery.agentId) + "</td>" +
            "<td>" + statusDot(delivery.status) + " " + escapeHtml(delivery.status) + "</td>" +
            "<td>" + escapeHtml(toText(delivery.attemptCount) + "/" + toText(delivery.maxAttempts)) + "</td>" +
            '<td class="muted" data-relative-time="' + escapeAttr(updatedAt) + '">' + escapeHtml(relativeTime(updatedAt)) + "</td>" +
            '<td class="muted">' + escapeHtml(delivery.lastError ? toText(delivery.lastError) : "") + "</td>" +
          "</tr>"
          );
        }).join("");
        const eventsRows = detail.events.map((event) => {
          const occurredAt = toText(event.occurredAt);
          return (
          "<tr><td>" + escapeHtml(shortId(event.eventId)) + "</td><td>" + escapeHtml(event.topic) + '</td><td class="muted" data-relative-time="' + escapeAttr(occurredAt) + '">' + escapeHtml(relativeTime(occurredAt)) + "</td></tr>"
          );
        }).join("");
        const approvalsRows = detail.approvals.map((approval) => {
          const requestedAt = toText(approval.requestedAt);
          return (
          "<tr><td>" + escapeHtml(shortId(approval.approvalId)) + "</td><td>" + statusPill(approval.status) + '</td><td class="muted" data-relative-time="' + escapeAttr(requestedAt) + '">' + escapeHtml(relativeTime(requestedAt)) + "</td></tr>"
          );
        }).join("");
        return '<div class="run-detail">' +
          '<div class="detail-block"><h4 class="detail-title">Deliveries</h4><table class="detail-table"><thead><tr><th>Agent</th><th>Status</th><th>Attempts</th><th>Updated</th><th>Error</th></tr></thead><tbody>' + (deliveriesRows || '<tr><td colspan="5" class="muted">No deliveries</td></tr>') + "</tbody></table></div>" +
          '<div class="detail-block"><h4 class="detail-title">Events</h4><table class="detail-table"><thead><tr><th>Event</th><th>Topic</th><th>Occurred</th></tr></thead><tbody>' + (eventsRows || '<tr><td colspan="3" class="muted">No events</td></tr>') + "</tbody></table></div>" +
          '<div class="detail-block"><h4 class="detail-title">Approvals</h4><table class="detail-table"><thead><tr><th>Approval</th><th>Status</th><th>Requested</th></tr></thead><tbody>' + (approvalsRows || '<tr><td colspan="3" class="muted">No approvals</td></tr>') + "</tbody></table></div>" +
        "</div>";
      }
      function renderRuns() {
        const root = byId("runs-list");
        byId("runs-count").textContent = String(state.runs.length);
        if (state.runs.length === 0) {
          root.innerHTML = '<div class="empty">No runs.</div>';
          applySectionVisibility();
          return;
        }
        root.innerHTML = state.runs
          .map((run) => {
            const progressDone = (run.deliveryStatusCounts?.completed || 0) + (run.deliveryStatusCounts?.cancelled || 0);
            const progressTotal = run.deliveryStatusCounts?.total || 0;
            const when = run.latestEventAt || run.updatedAt;
            const runId = toText(run.runId);
            return '<div class="row run-row" id="run-' + safeDomId(runId) + '" data-run-id="' + escapeAttr(runId) + '">' +
              '<div class="run-main">' +
                "<div>" + escapeHtml(shortId(runId)) + "</div>" +
                '<div class="status">' + statusPill(run.status) + "</div>" +
                '<div class="muted">deliveries ' + escapeHtml(progressDone + "/" + progressTotal) + "</div>" +
                '<div class="muted" data-relative-time="' + escapeAttr(when) + '">' + escapeHtml(relativeTime(when)) + "</div>" +
              "</div>" +
              (state.expandedRunId === runId ? renderRunDetail(runId) : "") +
            "</div>";
          })
          .join("");
        root.querySelectorAll("[data-run-id]").forEach((row) => {
          row.addEventListener("click", async () => {
            const runId = row.getAttribute("data-run-id");
            if (!runId) return;
            if (state.expandedRunId === runId) {
              state.expandedRunId = null;
              renderRuns();
              return;
            }
            await expandRun(runId);
          });
        });
        applySectionVisibility();
      }
      async function expandRun(runId, highlightDeliveryId) {
        state.expandedRunId = runId;
        renderRuns();
        const detail = await fetchJson("/api/runs/" + encodeURIComponent(runId));
        state.runDetails.set(runId, detail);
        renderRuns();
        const runElement = byId("run-" + safeDomId(runId));
        if (runElement) runElement.scrollIntoView({ behavior: "smooth", block: "center" });
        if (highlightDeliveryId) {
          const deliveryRow = byId("delivery-" + safeDomId(highlightDeliveryId));
          if (deliveryRow) {
            deliveryRow.classList.add("highlight");
            deliveryRow.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }
      async function refreshRuns() { state.runs = await fetchJson("/api/runs"); renderRuns(); }
      async function refreshApprovals() { state.approvals = await fetchJson("/api/approvals"); renderApprovals(); }
      async function refreshFailures() { state.failures = await fetchJson("/api/failures"); renderFailures(); }
      function renderAll(snapshot) {
        state.runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
        state.approvals = Array.isArray(snapshot.approvals) ? snapshot.approvals : [];
        state.failures = Array.isArray(snapshot.failures) ? snapshot.failures : [];
        state.runs.sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0));
        renderApprovals();
        renderFailures();
        renderRuns();
      }
      function connect() {
        const source = new EventSource("/events");
        let retryMs = state.retryMs;
        let connectedAt = 0;
        source.addEventListener("snapshot", (event) => {
          renderAll(JSON.parse(event.data || "{}"));
          if (connectedAt === 0) {
            connectedAt = Date.now();
          }
          setIndicator("live");
        });
        source.addEventListener("delivery.state_changed", (event) => {
          const payload = JSON.parse(event.data || "{}");
          if (payload.deliveryId) {
            const safeDeliveryId = safeDomId(payload.deliveryId);
            flashRow("delivery-" + safeDeliveryId);
            flashRow("failure-" + safeDeliveryId);
          }
          void refreshRuns();
        });
        source.addEventListener("approval.created", () => { void refreshApprovals(); void refreshRuns(); });
        source.addEventListener("approval.decided", () => { void refreshApprovals(); void refreshRuns(); });
        source.addEventListener("event.published", () => { void refreshRuns(); void refreshFailures(); });
        source.onerror = () => {
          setIndicator("disconnected");
          source.close();
          const reconnectDelay = retryMs;
          setTimeout(() => {
            setIndicator("reconnecting");
            connect();
          }, reconnectDelay);
          if (connectedAt > 0 && Date.now() - connectedAt >= 15000) {
            retryMs = 3000;
          } else {
            retryMs = Math.min(retryMs * 2, 30000);
          }
          state.retryMs = retryMs;
          connectedAt = 0;
        };
      }
      byId("show-all").addEventListener("change", applySectionVisibility);
      setInterval(() => {
        document.querySelectorAll("[data-relative-time]").forEach((node) => {
          const value = node.getAttribute("data-relative-time");
          if (!value) return;
          node.textContent = relativeTime(value);
        });
      }, 30000);
      setIndicator("reconnecting");
      connect();
    </script>
  </body>
</html>`;
}
