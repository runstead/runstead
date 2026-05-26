export const DASHBOARD_RENDER_STYLES = `
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #64748b;
      --line: #d8dee8;
      --accent: #0f766e;
      --risk: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      padding: 20px 28px;
    }
    main {
      display: grid;
      gap: 20px;
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px;
    }
    h1, h2 {
      margin: 0;
      font-weight: 650;
      letter-spacing: 0;
    }
    h1 { font-size: 24px; }
    h2 { font-size: 16px; }
    .muted { color: var(--muted); }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .metric, section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metric { padding: 14px 16px; }
    .metric strong {
      display: block;
      font-size: 26px;
      line-height: 1.2;
      margin-bottom: 4px;
    }
    section { overflow: hidden; }
    section header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding: 14px 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    tr:last-child td { border-bottom: 0; }
    code {
      color: var(--accent);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .status-failed, .risk-critical, .risk-high { color: var(--risk); font-weight: 650; }
    .status-blocked { color: var(--risk); font-weight: 650; }
    .status-passed { color: var(--accent); font-weight: 650; }
    .empty { padding: 16px; color: var(--muted); }
    .operator-actions {
      display: grid;
      gap: 0;
    }
    .operator-action {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(240px, 2fr) auto auto;
      gap: 12px;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
    }
    .operator-action:last-child { border-bottom: 0; }
    .operator-action button, .operator-api button {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      font: inherit;
      min-height: 32px;
      padding: 5px 10px;
      white-space: nowrap;
    }
    .operator-action button.primary, .operator-api button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #ffffff;
    }
    .operator-action button:focus-visible, .operator-api button:focus-visible,
    .operator-api input:focus-visible, .operator-api select:focus-visible,
    .operator-api textarea:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .operator-api {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--line);
      background: #f9fafb;
    }
    .operator-api input, .operator-api select, .operator-api textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
      min-height: 32px;
      padding: 5px 8px;
    }
    .operator-api textarea {
      min-height: 64px;
      resize: vertical;
    }
    .operator-result {
      grid-column: 1 / -1;
      min-height: 20px;
      color: var(--muted);
    }
    @media (max-width: 720px) {
      .operator-action {
        grid-template-columns: 1fr;
      }
      .operator-action button {
        justify-self: start;
      }
    }
`;

export const DASHBOARD_OPERATOR_SCRIPT = `
    async function copyOperatorCommand(button) {
      const command = button.getAttribute("data-command") || "";
      try {
        await navigator.clipboard.writeText(command);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => { button.textContent = "Copy"; }, 1400);
    }
    function operatorApiHeaders() {
      const session = document.querySelector("[data-operator-session]")?.value || "";
      const csrf = document.querySelector("[data-operator-csrf]")?.value || "";
      return {
        "content-type": "application/json",
        "authorization": "Bearer " + session,
        "x-runstead-csrf-token": csrf
      };
    }
    function setOperatorResult(message) {
      const target = document.querySelector("[data-operator-result]");
      if (target) target.textContent = message;
    }
    function operatorField(selector) {
      return document.querySelector(selector)?.value || "";
    }
    function splitOperatorList(value) {
      return value.split(/[\\n,]/).map((item) => item.trim()).filter(Boolean);
    }
    async function postOperatorApi(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: operatorApiHeaders(),
        body: JSON.stringify(body || {})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "operator action failed");
      }
      return payload;
    }
    async function runOperatorAction(button) {
      const id = button.getAttribute("data-operator-action-id");
      if (!id) return;
      button.disabled = true;
      try {
        const payload = await postOperatorApi("/operator-actions/" + encodeURIComponent(id) + "/run", {});
        setOperatorResult("Completed " + id + ": " + JSON.stringify(payload.result || payload));
      } catch (error) {
        setOperatorResult(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    }
    async function decideOperatorApproval(button) {
      const id = button.getAttribute("data-approval-id");
      const decision = button.getAttribute("data-approval-decision");
      if (!id || !decision) return;
      button.disabled = true;
      try {
        const payload = await postOperatorApi("/approvals/" + encodeURIComponent(id) + "/" + decision, {});
        setOperatorResult("Approval " + id + " " + decision + ": " + JSON.stringify(payload.result || payload));
      } catch (error) {
        setOperatorResult(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    }
    async function runVerifiersForm(button) {
      const taskId = operatorField("[data-verifier-task-id]").trim();
      if (!taskId) {
        setOperatorResult("taskId is required");
        return;
      }
      button.disabled = true;
      try {
        const payload = await postOperatorApi("/verifiers/run", {
          taskId,
          mode: operatorField("[data-verifier-mode]") || "evidence_only"
        });
        setOperatorResult("Verifiers completed: " + JSON.stringify(payload.result || payload));
      } catch (error) {
        setOperatorResult(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    }
    async function recordManualEvidenceForm(button) {
      const summary = operatorField("[data-manual-evidence-summary]").trim();
      if (!summary) {
        setOperatorResult("summary is required");
        return;
      }
      const body = {
        type: operatorField("[data-manual-evidence-type]") || "manual_change",
        summary,
        gate: operatorField("[data-manual-evidence-gate]"),
        sourceRefs: splitOperatorList(operatorField("[data-manual-evidence-source-refs]")),
        content: operatorField("[data-manual-evidence-content]")
      };
      button.disabled = true;
      try {
        const payload = await postOperatorApi("/evidence/manual", body);
        setOperatorResult("Evidence recorded: " + JSON.stringify(payload.result || payload));
      } catch (error) {
        setOperatorResult(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    }
`;
