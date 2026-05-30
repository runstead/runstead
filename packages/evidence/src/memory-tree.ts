export type EvidenceMemoryNodeKind =
  | "root"
  | "domain"
  | "connector"
  | "evidence_type"
  | "profile"
  | "evidence";

export interface EvidenceMemoryTreeItem {
  id: string;
  type: string;
  subjectType: string;
  subjectId: string;
  uri: string;
  summary?: string;
  domain?: string;
  connector?: string;
  profile?: string;
}

export interface EvidenceMemoryTreeNode {
  kind: EvidenceMemoryNodeKind;
  id: string;
  label: string;
  path: string;
  evidenceIds: string[];
  children: EvidenceMemoryTreeNode[];
}

export function buildEvidenceMemoryTree(
  items: EvidenceMemoryTreeItem[]
): EvidenceMemoryTreeNode {
  const root = createNode({
    kind: "root",
    id: "root",
    label: "Evidence Memory",
    path: "evidence"
  });

  for (const item of [...items].sort(compareItems)) {
    assertEvidenceMemoryItem(item);

    const domain = ensureChild(root, {
      kind: "domain",
      id: normalizedSegment(item.domain ?? item.subjectType),
      label: item.domain ?? item.subjectType
    });
    const connector = ensureChild(domain, {
      kind: "connector",
      id: normalizedSegment(item.connector ?? "manual"),
      label: item.connector ?? "manual"
    });
    const evidenceType = ensureChild(connector, {
      kind: "evidence_type",
      id: normalizedSegment(item.type),
      label: item.type
    });
    const profile = ensureChild(evidenceType, {
      kind: "profile",
      id: normalizedSegment(item.profile ?? item.subjectId),
      label: item.profile ?? item.subjectId
    });
    const evidence = ensureChild(profile, {
      kind: "evidence",
      id: normalizedSegment(item.id),
      label: item.summary ?? item.id
    });

    evidence.evidenceIds.push(item.id);
    addEvidenceId(profile, item.id);
    addEvidenceId(evidenceType, item.id);
    addEvidenceId(connector, item.id);
    addEvidenceId(domain, item.id);
    addEvidenceId(root, item.id);
  }

  sortTree(root);

  return root;
}

export function formatEvidenceMemoryTree(tree: EvidenceMemoryTreeNode): string {
  return formatNode(tree, 0).join("\n");
}

function ensureChild(
  parent: EvidenceMemoryTreeNode,
  input: {
    kind: EvidenceMemoryNodeKind;
    id: string;
    label: string;
  }
): EvidenceMemoryTreeNode {
  const existing = parent.children.find(
    (child) => child.kind === input.kind && child.id === input.id
  );

  if (existing !== undefined) {
    return existing;
  }

  const child = createNode({
    ...input,
    path: `${parent.path}/${input.kind}/${input.id}`
  });

  parent.children.push(child);

  return child;
}

function createNode(input: {
  kind: EvidenceMemoryNodeKind;
  id: string;
  label: string;
  path: string;
}): EvidenceMemoryTreeNode {
  return {
    ...input,
    evidenceIds: [],
    children: []
  };
}

function addEvidenceId(node: EvidenceMemoryTreeNode, evidenceId: string): void {
  if (!node.evidenceIds.includes(evidenceId)) {
    node.evidenceIds.push(evidenceId);
  }
}

function sortTree(node: EvidenceMemoryTreeNode): void {
  node.evidenceIds.sort();
  node.children.sort((left, right) => left.path.localeCompare(right.path));

  for (const child of node.children) {
    sortTree(child);
  }
}

function formatNode(node: EvidenceMemoryTreeNode, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const count = node.evidenceIds.length;
  const lines = [`${indent}- ${node.kind}:${node.label} (${count})`];

  for (const child of node.children) {
    lines.push(...formatNode(child, depth + 1));
  }

  return lines;
}

function compareItems(
  left: EvidenceMemoryTreeItem,
  right: EvidenceMemoryTreeItem
): number {
  return [
    left.domain ?? left.subjectType,
    left.connector ?? "manual",
    left.type,
    left.profile ?? left.subjectId,
    left.id
  ]
    .join("\0")
    .localeCompare(
      [
        right.domain ?? right.subjectType,
        right.connector ?? "manual",
        right.type,
        right.profile ?? right.subjectId,
        right.id
      ].join("\0")
    );
}

function assertEvidenceMemoryItem(item: EvidenceMemoryTreeItem): void {
  for (const [field, value] of Object.entries({
    id: item.id,
    type: item.type,
    subjectType: item.subjectType,
    subjectId: item.subjectId,
    uri: item.uri
  })) {
    if (value.trim().length === 0) {
      throw new Error(`Evidence memory item ${field} cannot be empty`);
    }
  }
}

function normalizedSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-");

  return normalized.length === 0 ? "unknown" : normalized;
}
