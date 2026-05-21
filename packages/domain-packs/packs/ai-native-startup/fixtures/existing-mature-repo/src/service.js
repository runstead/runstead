export function readinessScore(input) {
  const checks = [
    input.ciPassing,
    input.rollbackReady,
    input.observabilityReady,
    input.supportReady
  ];

  return checks.filter(Boolean).length / checks.length;
}
