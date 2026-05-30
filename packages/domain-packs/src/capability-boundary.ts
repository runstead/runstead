import { z } from "zod";

export const RunsteadCapabilityLayerSchema = z.enum([
  "domain_pack",
  "extension",
  "skill",
  "connector",
  "tool"
]);

export const CapabilityBoundarySchema = z.object({
  layer: RunsteadCapabilityLayerSchema,
  owns: z.array(z.string().min(1)).min(1),
  useWhen: z.array(z.string().min(1)).min(1),
  doNotUseFor: z.array(z.string().min(1)).min(1),
  governedBy: z.array(z.string().min(1)).min(1),
  operatorSurface: z.array(z.string().min(1)).min(1)
});

export const CapabilityBoundaryCatalogSchema = z.array(CapabilityBoundarySchema);

export type RunsteadCapabilityLayer = z.infer<typeof RunsteadCapabilityLayerSchema>;
export type CapabilityBoundary = z.infer<typeof CapabilityBoundarySchema>;

const CAPABILITY_BOUNDARIES: CapabilityBoundary[] =
  CapabilityBoundaryCatalogSchema.parse([
    {
      layer: "domain_pack",
      owns: [
        "business workflow shape",
        "task and goal templates",
        "capability policy",
        "evidence contracts",
        "requirement evaluators",
        "fixtures and evals"
      ],
      useWhen: [
        "a workflow needs domain-specific proof semantics",
        "operators need a reusable work scenario such as launch readiness or research digesting"
      ],
      doNotUseFor: [
        "provider OAuth and HTTP details",
        "workspace-specific collector commands",
        "one-off troubleshooting recipes"
      ],
      governedBy: ["domain pack validation", "maturity gates", "evaluator coverage"],
      operatorSurface: ["runstead domain show", "runstead run <pack> <workflow>"]
    },
    {
      layer: "extension",
      owns: [
        "workspace or package-provided evidence collectors",
        "readiness facets",
        "verifiers",
        "gates"
      ],
      useWhen: [
        "a third-party or workspace integration proves readiness for an existing domain",
        "the collector can declare produced evidence, secrets, quality tier, and wrapped-worker safety"
      ],
      doNotUseFor: [
        "changing the domain's business workflow meaning",
        "teaching the worker how to solve a task",
        "global provider catalog ownership"
      ],
      governedBy: [
        "@runstead/sdk manifest validation",
        "collector policy",
        "extension readiness"
      ],
      operatorSurface: [".runstead/extensions", "startup ready", "runstead run --plan"]
    },
    {
      layer: "skill",
      owns: [
        "reusable worker guidance",
        "bounded troubleshooting procedures",
        "tool allow and deny hints",
        "rollback notes",
        "skill package verifiers"
      ],
      useWhen: [
        "the capability can be expressed as instructions plus existing tools",
        "operators want a canaried recipe for similar future tasks"
      ],
      doNotUseFor: [
        "authoritative evidence collection",
        "new provider auth or transport code",
        "business completion semantics"
      ],
      governedBy: [
        "skill validation",
        "skill tests",
        "activation canary",
        "rollback on regression"
      ],
      operatorSurface: ["runstead skill *", "runstead learning auto-improve"]
    },
    {
      layer: "connector",
      owns: [
        "canonical external or workspace source identity",
        "credential names",
        "read and write surface summary",
        "evidence types",
        "domain support and maturity"
      ],
      useWhen: [
        "multiple packs or extensions need to refer to the same external system",
        "operators need to know whether a source is executable or catalog-only before a run"
      ],
      doNotUseFor: [
        "domain task ordering",
        "provider-specific business evaluation",
        "worker prompt recipes"
      ],
      governedBy: ["connector catalog", "adapter maturity", "connector readiness"],
      operatorSurface: [
        "runstead connector list",
        "runstead connector show",
        "runstead run --plan"
      ]
    },
    {
      layer: "tool",
      owns: [
        "precise runtime actions",
        "side-effect execution",
        "provider HTTP calls",
        "filesystem and shell operations",
        "streaming or binary processing"
      ],
      useWhen: [
        "the operation must execute deterministically each time",
        "custom auth, payload parsing, streaming, or binary handling is required"
      ],
      doNotUseFor: [
        "declaring business evidence requirements",
        "operator-facing workflow packaging",
        "soft worker advice that can live in a skill"
      ],
      governedBy: [
        "policy engine",
        "approval grants",
        "audit events",
        "verifier evidence"
      ],
      operatorSurface: [
        "codex_direct proxy",
        "wrapped worker verifier execution",
        "source adapters"
      ]
    }
  ]);

export function listCapabilityBoundaries(): CapabilityBoundary[] {
  return CAPABILITY_BOUNDARIES.map(cloneCapabilityBoundary);
}

export function getCapabilityBoundary(
  layer: RunsteadCapabilityLayer
): CapabilityBoundary {
  const boundary = CAPABILITY_BOUNDARIES.find((candidate) => candidate.layer === layer);

  if (boundary === undefined) {
    throw new Error(`Capability boundary not found: ${layer}`);
  }

  return cloneCapabilityBoundary(boundary);
}

export function formatCapabilityBoundaryCatalog(
  boundaries = listCapabilityBoundaries()
): string {
  return [
    "Runstead capability boundaries",
    ...boundaries.map(
      (boundary) =>
        `${boundary.layer}: owns=${boundary.owns.join(", ")} | use_when=${boundary.useWhen.join("; ")}`
    )
  ].join("\n");
}

function cloneCapabilityBoundary(boundary: CapabilityBoundary): CapabilityBoundary {
  return {
    ...boundary,
    owns: [...boundary.owns],
    useWhen: [...boundary.useWhen],
    doNotUseFor: [...boundary.doNotUseFor],
    governedBy: [...boundary.governedBy],
    operatorSurface: [...boundary.operatorSurface]
  };
}
