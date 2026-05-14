export interface DomainPackCompatibilityInput {
  id: string;
  compatibility: {
    runsteadMinVersion: string;
    runsteadMaxVersion?: string | undefined;
  };
}

export interface DomainPackCompatibilityIssue {
  code: "runstead_version_too_old" | "runstead_version_too_new";
  message: string;
  expected: string;
  actual: string;
}

export interface DomainPackCompatibilityResult {
  compatible: boolean;
  issues: DomainPackCompatibilityIssue[];
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string[];
}

const SEMVER_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function checkDomainPackCompatibility(
  pack: DomainPackCompatibilityInput,
  runsteadVersion: string
): DomainPackCompatibilityResult {
  const issues: DomainPackCompatibilityIssue[] = [];

  if (compareSemver(runsteadVersion, pack.compatibility.runsteadMinVersion) < 0) {
    issues.push({
      code: "runstead_version_too_old",
      message: `Domain pack ${pack.id} requires Runstead >= ${pack.compatibility.runsteadMinVersion}`,
      expected: pack.compatibility.runsteadMinVersion,
      actual: runsteadVersion
    });
  }

  if (
    pack.compatibility.runsteadMaxVersion !== undefined &&
    compareSemver(runsteadVersion, pack.compatibility.runsteadMaxVersion) > 0
  ) {
    issues.push({
      code: "runstead_version_too_new",
      message: `Domain pack ${pack.id} requires Runstead <= ${pack.compatibility.runsteadMaxVersion}`,
      expected: pack.compatibility.runsteadMaxVersion,
      actual: runsteadVersion
    });
  }

  return {
    compatible: issues.length === 0,
    issues
  };
}

function compareSemver(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);

  for (const key of ["major", "minor", "patch"] as const) {
    const delta = parsedLeft[key] - parsedRight[key];

    if (delta !== 0) {
      return Math.sign(delta);
    }
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function parseSemver(version: string): ParsedSemver {
  const match = SEMVER_PATTERN.exec(version);

  if (match === null) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] === undefined ? {} : { prerelease: match[4].split(".") })
  };
}

function comparePrerelease(left: string[] | undefined, right: string[] | undefined) {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined) {
    return 1;
  }

  if (right === undefined) {
    return -1;
  }

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    const result = comparePrereleasePart(leftPart, rightPart);

    if (result !== 0) {
      return result;
    }
  }

  return 0;
}

function comparePrereleasePart(left: string, right: string): number {
  const leftNumber = numericIdentifier(left);
  const rightNumber = numericIdentifier(right);

  if (leftNumber !== undefined && rightNumber !== undefined) {
    return Math.sign(leftNumber - rightNumber);
  }

  if (leftNumber !== undefined) {
    return -1;
  }

  if (rightNumber !== undefined) {
    return 1;
  }

  return Math.sign(left.localeCompare(right));
}

function numericIdentifier(value: string): number | undefined {
  return /^(0|[1-9]\d*)$/.test(value) ? Number(value) : undefined;
}
