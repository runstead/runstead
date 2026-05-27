import type { EvidenceQualityTier } from "@runstead/evidence";

import type {
  AddStartupEvidenceResult,
  StartupEvidenceType
} from "./startup-evidence.js";
import type {
  StartupSourceConnector,
  StartupSourceConnectorDefinition,
  StartupSourceProviderAdapter,
  StartupSourceTarget
} from "./startup-source-connector-definitions.js";
import type { StartupSourceProviderCollection } from "./startup-source-provider-payload.js";

export interface RecordStartupSourceEvidenceOptions {
  cwd?: string;
  connector: string;
  uri: string;
  summary: string;
  status?: string;
  target?: string;
  capturedAt?: string;
  freshnessDays?: number;
  sourceHash?: string;
  trustLevel?: string;
  payload?: string;
  goalId?: string;
  now?: Date;
}

export interface RecordStartupSourceEvidenceResult extends AddStartupEvidenceResult {
  connector: StartupSourceConnector;
  evidenceType: StartupEvidenceType;
  definition: StartupSourceConnectorDefinition;
  qualityTier: EvidenceQualityTier;
  target?: StartupSourceTarget;
  readinessTiers: string[];
  payloadWarnings: string[];
}

export interface VerifyStartupSourceEvidenceOptions {
  cwd?: string;
  connector: string;
  uri: string;
  summary?: string;
  method?: string;
  expectStatus?: number;
  expectText?: string[];
  target?: string;
  capturedAt?: string;
  freshnessDays?: number;
  sourceHash?: string;
  trustLevel?: string;
  goalId?: string;
  fetch?: StartupSourceVerificationFetch;
  now?: Date;
}

export interface StartupSourceVerificationResult {
  status: "passed" | "failed";
  ok: boolean;
  statusCode: number;
  expectedStatus: number;
  textChecks: StartupSourceVerificationTextCheck[];
  responseExcerpt?: string;
}

export interface StartupSourceVerificationTextCheck {
  text: string;
  matched: boolean;
}

export interface VerifyStartupSourceEvidenceResult extends RecordStartupSourceEvidenceResult {
  verification: StartupSourceVerificationResult;
}

export interface CollectStartupSourceEvidenceOptions {
  cwd?: string;
  connector: string;
  uri: string;
  target?: string;
  token?: string;
  capturedAt?: string;
  freshnessDays?: number;
  sourceHash?: string;
  trustLevel?: string;
  goalId?: string;
  fetch?: StartupSourceVerificationFetch;
  now?: Date;
}

export interface CollectStartupSourceEvidenceResult extends RecordStartupSourceEvidenceResult {
  adapter: StartupSourceProviderAdapter;
  collection: StartupSourceProviderCollection;
}

export type StartupSourceVerificationFetch = (
  input: string,
  init?: {
    method?: string;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  }
) => Promise<StartupSourceVerificationResponse>;

export interface StartupSourceVerificationResponse {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
}
