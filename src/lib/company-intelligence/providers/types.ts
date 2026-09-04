import type { NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";
import type { CnpjCadastreSourceId, CnpjProviderStatus } from "./registryTypes.js";

export type ProviderSuccess = {
  status: "SUCCESS";
  source: CnpjCadastreSourceId;
  fetchedAt: string;
  latencyMs: number;
  fromCache: boolean;
  summary: NormalizedCnpjSummary;
  rawJson: unknown;
};

export type ProviderFailure = {
  status: Exclude<CnpjProviderStatus, "SUCCESS" | "SKIPPED_CACHE">;
  source: CnpjCadastreSourceId;
  fetchedAt: string;
  latencyMs: number;
  fromCache: boolean;
  message: string;
  httpStatus: number | null;
};

export type ProviderOutcome = ProviderSuccess | ProviderFailure;

export type CompanyRegistryProvider = {
  source: CnpjCadastreSourceId;
  lookup: (
    cnpj: string,
    fetchImpl?: typeof fetch
  ) => Promise<ProviderOutcome>;
};

export function isProviderSuccess(outcome: ProviderOutcome): outcome is ProviderSuccess {
  return outcome.status === "SUCCESS";
}
