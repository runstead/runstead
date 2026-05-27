import type { InitPolicyProfile } from "./init-policy.js";
import {
  externalWorkerStartPolicyRuleYaml,
  modelInferencePolicyRuleYaml,
  nativeWorkerStartPolicyRuleYaml,
  trustedLocalMvpPatchPolicyRuleYaml
} from "./init-policy-rule-yaml.js";

export function repoMaintenancePolicyYaml(profile: InitPolicyProfile): string {
  return `id: policy_repo_maintenance_v1
version: 1
default_decision: require_approval
default_risk: medium

rules:
  - id: allow_read_workspace
    when:
      action_type:
        in:
          - filesystem.read
          - filesystem.list
          - filesystem.search
          - filesystem.stat
          - git.status
          - git.diff
          - git.log
          - git.show
          - git.diff.summary
          - repo.metadata.read
          - evidence.read
          - workspace.facts.read
          - github.run.read
          - github.run.log.read
    decision: allow
    risk: low

  - id: allow_ci_repair_workspace_actions
    when:
      action_type:
        in:
          - git.branch.create
          - git.commit
          - checkpoint.create
          - checkpoint.restore
    decision: allow
    risk: medium
    obligations:
      - capture_output
      - attach_as_evidence
      - verify_diff_scope

${externalWorkerStartPolicyRuleYaml(profile)}

${nativeWorkerStartPolicyRuleYaml(profile)}

${modelInferencePolicyRuleYaml(profile)}

${trustedLocalMvpPatchPolicyRuleYaml(profile)}

  - id: allow_verifier_commands
    when:
      action_type:
        in:
          - shell.exec
          - verifier.run
      command:
        matches_any:
          - "^pnpm test( .*)?$"
          - "^pnpm run test( .*)?$"
          - "^pnpm lint( .*)?$"
          - "^pnpm run lint( .*)?$"
          - "^pnpm typecheck( .*)?$"
          - "^pnpm run typecheck( .*)?$"
          - "^pnpm build( .*)?$"
          - "^pnpm run build( .*)?$"
          - "^pnpm exec turbo run test( .*)?$"
          - "^pnpm exec turbo run lint( .*)?$"
          - "^pnpm exec turbo run typecheck( .*)?$"
          - "^pnpm exec turbo run build( .*)?$"
          - "^npm test( .*)?$"
          - "^npm run lint( .*)?$"
          - "^npm run typecheck( .*)?$"
          - "^npm run build( .*)?$"
          - "^npm exec -- turbo run test( .*)?$"
          - "^npm exec -- turbo run lint( .*)?$"
          - "^npm exec -- turbo run typecheck( .*)?$"
          - "^npm exec -- turbo run build( .*)?$"
          - "^yarn test( .*)?$"
          - "^yarn lint( .*)?$"
          - "^yarn typecheck( .*)?$"
          - "^yarn build( .*)?$"
          - "^yarn turbo run test( .*)?$"
          - "^yarn turbo run lint( .*)?$"
          - "^yarn turbo run typecheck( .*)?$"
          - "^yarn turbo run build( .*)?$"
          - "^bun test( .*)?$"
          - "^bun run test( .*)?$"
          - "^bun run typecheck( .*)?$"
          - "^bun run lint( .*)?$"
          - "^bun run build( .*)?$"
          - "^bunx turbo run test( .*)?$"
          - "^bunx turbo run lint( .*)?$"
          - "^bunx turbo run typecheck( .*)?$"
          - "^bunx turbo run build( .*)?$"
    decision: allow
    risk: low
    obligations:
      - capture_output
      - attach_as_evidence
      - redact_secrets

  - id: deny_secret_files
    when:
      path:
        matches_any:
          - ".env"
          - ".env.*"
          - "**/secrets/**"
          - "infra/prod/**"
    decision: deny
    risk: critical

  - id: require_approval_runstead_state_paths
    when:
      path:
        matches_any:
          - ".runstead/**"
    decision: require_approval
    risk: high

  - id: deny_destructive_shell
    when:
      action_type: shell.exec
      command:
        matches_any:
          - ".*rm -rf.*"
          - ".*sudo .*"
          - ".*mkfs.*"
          - ".*dd if=.*"
    decision: deny
    risk: critical

  - id: require_approval_dependency_change
    when:
      action_type:
        in:
          - package.install
          - package.update
      path:
        matches_any:
          - package.json
          - package-lock.json
          - pnpm-lock.yaml
          - yarn.lock
          - bun.lockb
          - requirements.txt
          - poetry.lock
          - uv.lock
          - go.mod
          - go.sum
          - Cargo.toml
          - Cargo.lock
    decision: require_approval
    risk: high

  - id: require_approval_dependency_file_commit
    when:
      action_type:
        in:
          - git.commit
          - filesystem.patch
      path:
        matches_any:
          - package.json
          - package-lock.json
          - pnpm-lock.yaml
          - yarn.lock
          - bun.lockb
          - requirements.txt
          - poetry.lock
          - uv.lock
          - go.mod
          - go.sum
          - Cargo.toml
          - Cargo.lock
    decision: require_approval
    risk: high

  - id: require_approval_external_write
    when:
      action_type:
        in:
          - shell.exec
          - git.push
          - github.pr.create
          - repo.publish_repair
          - package.install
          - package.update
      side_effects:
        contains_any:
          - network_write_external
          - send_message_external
          - git_push
          - github_pr_create
    decision: require_approval
    risk: high
`;
}
