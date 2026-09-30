import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import { escavadorConfigured, isEscavadorEnabled, type LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { fetchEscavadorProcess } from "./escavadorClient.server.js";
import { notConfiguredEscavadorBatch } from "./escavadorMapper.js";
import type { EscavadorThrottle } from "./escavadorThrottle.js";

export async function runEscavadorSync(input: {
  env?: LegalExposureEnv;
  fetchImpl?: typeof fetch;
  processNumber?: string;
  throttle?: EscavadorThrottle;
}): Promise<NormalizedSourceBatch> {
  const env = input.env ?? process.env;
  if (!isEscavadorEnabled(env) || !escavadorConfigured(env)) return notConfiguredEscavadorBatch();
  return fetchEscavadorProcess({
    env,
    fetchImpl: input.fetchImpl,
    processNumber: input.processNumber ?? "",
    throttle: input.throttle,
  });
}
