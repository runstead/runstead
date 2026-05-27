import type { InitPolicyProfile } from "./init-policy.js";

export function externalWorkerStartPolicyRuleYaml(profile: InitPolicyProfile): string {
  if (profile === "trusted-local") {
    return `  - id: allow_trusted_local_external_worker_start
    when:
      action_type: worker.external.start
      resource_id:
        in:
          - codex_cli
          - claude_code
    decision: allow
    risk: medium`;
  }

  return `  - id: require_approval_external_worker_start
    when:
      action_type: worker.external.start
    decision: require_approval
    risk: high`;
}

export function nativeWorkerStartPolicyRuleYaml(profile: InitPolicyProfile): string {
  if (profile === "trusted-local") {
    return `  - id: allow_trusted_local_native_worker_start
    when:
      action_type: worker.native.start
      resource_id:
        in:
          - codex_direct
    decision: allow
    risk: medium`;
  }

  return `  - id: require_approval_native_worker_start
    when:
      action_type: worker.native.start
    decision: require_approval
    risk: high`;
}

export function modelInferencePolicyRuleYaml(profile: InitPolicyProfile): string {
  if (profile === "trusted-local") {
    return `  - id: allow_trusted_local_model_inference_request
    when:
      action_type: model.inference.request
      resource_id:
        in:
          - chatgpt_codex
          - openai
          - openrouter
          - anthropic
          - gemini
          - nous-api
          - deepseek
          - zai
          - kimi-coding
          - minimax
          - minimax-cn
          - huggingface
          - nvidia
          - xiaomi
          - arcee
          - ollama-cloud
          - kilocode
          - ai-gateway
          - lmstudio
          - custom
    decision: allow
    risk: medium`;
  }

  return `  - id: require_approval_model_inference_request
    when:
      action_type: model.inference.request
    decision: require_approval
    risk: high`;
}

export function trustedLocalMvpPatchPolicyRuleYaml(profile: InitPolicyProfile): string {
  if (profile !== "trusted-local") {
    return "";
  }

  return `  - id: allow_trusted_local_mvp_workspace_patch
    when:
      action_type: filesystem.patch
      risk_class: scaffold_app_patch
      path:
        matches_any:
          - index.html
          - styles.css
          - app.js
          - server.js
          - scripts/*.js
          - src/**
          - app/**
          - components/**
          - public/**
          - tests/**
          - README.md
    decision: allow
    risk: medium
    obligations:
      - verify_diff_scope
      - run_local_verifiers`;
}
