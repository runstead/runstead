export { DASHBOARD_RENDER_STYLES } from "./dashboard-render-styles.js";

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
