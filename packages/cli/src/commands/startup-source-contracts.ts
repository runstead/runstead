export async function listStartupSourceConnectorContracts(): Promise<void> {
  const { getStartupSourceProviderAdapter, listStartupSourceConnectorDefinitions } =
    await import("../startup-source-connectors.js");

  for (const definition of listStartupSourceConnectorDefinitions()) {
    const adapter = getStartupSourceProviderAdapter(definition.connector);

    console.log(
      formatStartupSourceConnectorContract({
        connector: definition.connector,
        evidenceType: definition.evidenceType,
        sourceKind: definition.sourceKind,
        qualityTier: definition.qualityTier,
        defaultTrustLevel: definition.defaultTrustLevel,
        defaultFreshnessDays: definition.defaultFreshnessDays,
        recommendedPayloadFields: definition.recommendedPayloadFields,
        ...(adapter === undefined ? {} : { adapterProvider: adapter.provider })
      })
    );
  }
}

function formatStartupSourceConnectorContract(definition: {
  connector: string;
  evidenceType: string;
  sourceKind: string;
  qualityTier: string;
  defaultTrustLevel: string;
  defaultFreshnessDays: number;
  recommendedPayloadFields: string[];
  adapterProvider?: string;
}): string {
  return [
    definition.connector,
    `evidence=${definition.evidenceType}`,
    `source=${definition.sourceKind}`,
    `quality=${definition.qualityTier}`,
    `trust=${definition.defaultTrustLevel}`,
    `freshness=${definition.defaultFreshnessDays}d`,
    `adapter=${definition.adapterProvider ?? "none"}`,
    `payload=${definition.recommendedPayloadFields.join(",") || "none"}`
  ].join(" ");
}
