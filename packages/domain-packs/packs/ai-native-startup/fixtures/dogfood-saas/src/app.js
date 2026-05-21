export function activationRate(snapshot) {
  if (snapshot.signups === 0) {
    return 0;
  }

  return snapshot.activated / snapshot.signups;
}

export function readinessSummary(input) {
  return {
    accountId: input.accountId,
    ready: input.verifiersPassed && input.metricAboveThreshold,
    generatedAt: new Date(0).toISOString()
  };
}
