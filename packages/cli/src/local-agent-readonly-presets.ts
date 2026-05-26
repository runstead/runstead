import { structuredPresetPrompt, verifierFocus } from "./local-agent-preset-prompt.js";
import type { LocalAgentPreset } from "./local-agent-preset-types.js";

export const READ_ONLY_LOCAL_AGENT_PRESETS: readonly LocalAgentPreset[] = [
  {
    id: "inspect:smoke",
    mode: "read-only",
    maxTurns: 8,
    maxToolCalls: 8,
    maxFailedToolCalls: 3,
    checkpoint: false,
    verifierPolicy: "none",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "inspect:smoke",
        purpose: "Quickly inspect this repository and summarize its shape.",
        focus: input.prompt,
        requiredPlan: [
          "Check git status.",
          "Read package metadata if present.",
          "Read the obvious public entrypoint or README if present."
        ],
        stopRules: [
          "Missing files are evidence; do not chase every possible layout.",
          "Stop after enough evidence for a smoke-level repository summary."
        ],
        outputContract: [
          "Inspected files",
          "Repository type",
          "Public API or main entrypoint",
          "Validation commands",
          "Main risks",
          "Next step"
        ]
      })
  },
  {
    id: "inspect:standard",
    mode: "read-only",
    maxTurns: 12,
    maxToolCalls: 16,
    maxFailedToolCalls: 4,
    checkpoint: false,
    verifierPolicy: "none",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "inspect:standard",
        purpose: "Inspect this repository deeply enough to support follow-up work.",
        focus: input.prompt,
        requiredPlan: [
          "Check git status.",
          "Read package metadata and workspace configuration.",
          "Read README or primary docs.",
          "Read public entrypoints and test configuration when obvious."
        ],
        stopRules: [
          "Prefer top-level contracts and entrypoints over exhaustive source scanning.",
          "Call out uncertainty instead of expanding the search indefinitely."
        ],
        outputContract: [
          "Inspected files",
          "Repository architecture",
          "Public API surface",
          "Scripts and validation commands",
          "Risks and unknowns",
          "Recommended next step"
        ]
      })
  },
  {
    id: "inspect:api",
    mode: "read-only",
    maxTurns: 14,
    maxToolCalls: 20,
    maxFailedToolCalls: 4,
    checkpoint: false,
    verifierPolicy: "none",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "inspect:api",
        purpose: "Map the repository public API and integration contracts.",
        focus: input.prompt,
        requiredPlan: [
          "Check git status.",
          "Read package exports, public entrypoints, and generated types when present.",
          "Read docs or examples that define supported usage.",
          "Identify compatibility or versioning boundaries."
        ],
        stopRules: [
          "Prefer exported contracts over private implementation details.",
          "Call out unverified API assumptions explicitly."
        ],
        outputContract: [
          "Public entrypoints",
          "Key exported contracts",
          "Integration examples",
          "Validation commands",
          "Compatibility risks"
        ]
      })
  },
  {
    id: "inspect:architecture",
    mode: "read-only",
    maxTurns: 18,
    maxToolCalls: 28,
    maxFailedToolCalls: 5,
    checkpoint: false,
    verifierPolicy: "none",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "inspect:architecture",
        purpose: "Build a repo-grounded architecture map for follow-up work.",
        focus: input.prompt,
        requiredPlan: [
          "Check git status.",
          "Read top-level docs, workspace metadata, and package boundaries.",
          "Trace the main runtime flow through entrypoints and shared modules.",
          "Identify storage, policy, worker, or integration boundaries."
        ],
        stopRules: [
          "Stay at architecture level unless a specific risk needs source evidence.",
          "Do not exhaustively read leaf tests."
        ],
        outputContract: [
          "Architecture map",
          "Core modules and ownership",
          "Runtime flow",
          "External integrations",
          "Risks and open questions"
        ]
      })
  },
  {
    id: "review:diff",
    mode: "read-only",
    maxTurns: 10,
    maxToolCalls: 12,
    maxFailedToolCalls: 3,
    checkpoint: false,
    verifierPolicy: "none",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "review:diff",
        purpose: "Review the current git diff for concrete bugs and regressions.",
        focus: input.prompt,
        requiredPlan: [
          "Check git status.",
          "Read the relevant git diff.",
          "Open only the surrounding source needed to validate each finding."
        ],
        stopRules: [
          "Findings must be grounded in the current diff or directly affected code.",
          "If there are no findings, say that and list remaining test gaps."
        ],
        outputContract: [
          "Findings first, ordered by severity",
          "File and line references for each finding",
          "Open questions",
          "Residual test risk"
        ]
      })
  },
  {
    id: "review:staged",
    mode: "read-only",
    maxTurns: 10,
    maxToolCalls: 12,
    maxFailedToolCalls: 3,
    checkpoint: false,
    verifierPolicy: "none",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "review:staged",
        purpose: "Review only the staged git diff for concrete bugs.",
        focus: input.prompt,
        requiredPlan: [
          "Check git status.",
          "Read the staged diff only.",
          "Open surrounding source only when needed to validate a finding."
        ],
        stopRules: [
          "Do not review unstaged changes.",
          "Findings must be tied to staged changes or directly affected contracts."
        ],
        outputContract: [
          "Findings first, ordered by severity",
          "File and line references",
          "Open questions",
          "Residual test risk"
        ]
      })
  },
  {
    id: "review:unpushed",
    mode: "read-only",
    maxTurns: 14,
    maxToolCalls: 20,
    maxFailedToolCalls: 4,
    checkpoint: false,
    verifierPolicy: "none",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "review:unpushed",
        purpose: "Review unpushed commits against their upstream base.",
        focus: input.prompt,
        requiredPlan: [
          "Check git status and branch tracking information.",
          "Identify commits that are ahead of upstream.",
          "Review the aggregate unpushed diff and inspect affected contracts."
        ],
        stopRules: [
          "Do not include unrelated unstaged-only changes in findings.",
          "If no upstream exists, report the exact missing baseline."
        ],
        outputContract: [
          "Reviewed commit range",
          "Findings first, ordered by severity",
          "File and line references",
          "Missing validation or baseline"
        ]
      })
  },
  {
    id: "test:triage",
    mode: "read-only",
    maxTurns: 12,
    maxToolCalls: 14,
    maxFailedToolCalls: 4,
    checkpoint: false,
    verifierPolicy: "required",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "test:triage",
        purpose: "Triage verifier output and identify the likely root cause.",
        focus: verifierFocus(input),
        requiredPlan: [
          "Read the verifier evidence supplied by Runstead.",
          "Read the smallest relevant source or test files.",
          "Separate root cause from workaround-only explanations."
        ],
        stopRules: [
          "Do not run tests yourself unless Runstead explicitly asks for more evidence.",
          "If evidence is insufficient, name the missing command or artifact."
        ],
        outputContract: [
          "Failing command or evidence id",
          "Root cause",
          "Affected code",
          "Recommended fix",
          "Verification command"
        ]
      })
  },
  {
    id: "triage:failure",
    mode: "read-only",
    maxTurns: 14,
    maxToolCalls: 18,
    maxFailedToolCalls: 4,
    checkpoint: false,
    verifierPolicy: "required",
    promptTemplate: (input) =>
      structuredPresetPrompt({
        id: "triage:failure",
        purpose: "Triage a failing verifier, CI log, or command transcript.",
        focus: verifierFocus(input),
        requiredPlan: [
          "Read the supplied failure evidence first.",
          "Identify the failing command, assertion, or runtime boundary.",
          "Inspect only the smallest relevant source and configuration files."
        ],
        stopRules: [
          "Separate root cause from workaround-only explanations.",
          "If evidence is insufficient, name the exact missing artifact."
        ],
        outputContract: [
          "Failing evidence",
          "Root cause",
          "Affected files",
          "Recommended fix",
          "Verification command"
        ]
      })
  }
];
