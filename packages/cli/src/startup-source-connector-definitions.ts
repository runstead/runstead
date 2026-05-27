import {
  STARTUP_SOURCE_CONNECTORS,
  STARTUP_SOURCE_CONNECTOR_DEFINITIONS,
  STARTUP_SOURCE_PROVIDER_ADAPTERS,
  type StartupSourceConnector,
  type StartupSourceConnectorDefinition,
  type StartupSourceProviderAdapter,
  type StartupSourceTarget
} from "./startup-source-connector-catalog.js";

export {
  STARTUP_SOURCE_CONNECTORS,
  type StartupSourceConnector,
  type StartupSourceConnectorDefinition,
  type StartupSourceProviderAdapter,
  type StartupSourceTarget
} from "./startup-source-connector-catalog.js";

export function parseStartupSourceConnector(value: string): StartupSourceConnector {
  if (STARTUP_SOURCE_CONNECTORS.includes(value as StartupSourceConnector)) {
    return value as StartupSourceConnector;
  }

  throw new Error(
    `Unsupported startup source connector ${value}. Expected one of: ${STARTUP_SOURCE_CONNECTORS.join(", ")}`
  );
}

export function parseStartupSourceTarget(value: string): StartupSourceTarget {
  if (value === "local" || value === "staging" || value === "production") {
    return value;
  }

  throw new Error(
    `Unsupported startup source target ${value}. Expected local, staging, or production`
  );
}

export function listStartupSourceConnectorDefinitions(): StartupSourceConnectorDefinition[] {
  return STARTUP_SOURCE_CONNECTOR_DEFINITIONS.map((definition) => ({
    ...definition,
    recommendedPayloadFields: [...definition.recommendedPayloadFields]
  }));
}

export function getStartupSourceConnectorDefinition(
  connector: StartupSourceConnector
): StartupSourceConnectorDefinition | undefined {
  const definition = STARTUP_SOURCE_CONNECTOR_DEFINITIONS.find(
    (candidate) => candidate.connector === connector
  );

  if (definition === undefined) {
    return undefined;
  }

  return {
    ...definition,
    recommendedPayloadFields: [...definition.recommendedPayloadFields]
  };
}

export function getStartupSourceProviderAdapter(
  connector: StartupSourceConnector
): StartupSourceProviderAdapter | undefined {
  return STARTUP_SOURCE_PROVIDER_ADAPTERS.find(
    (candidate) => candidate.connector === connector
  );
}

export function requireStartupSourceConnectorDefinition(
  connector: StartupSourceConnector
): StartupSourceConnectorDefinition {
  const definition = getStartupSourceConnectorDefinition(connector);

  if (definition === undefined) {
    throw new Error(`Startup source connector definition not found: ${connector}`);
  }

  return definition;
}

export function requireStartupSourceProviderAdapter(
  connector: StartupSourceConnector
): StartupSourceProviderAdapter {
  const adapter = getStartupSourceProviderAdapter(connector);

  if (adapter === undefined) {
    throw new Error(
      `Startup source connector ${connector} does not have an executable adapter`
    );
  }

  return adapter;
}
