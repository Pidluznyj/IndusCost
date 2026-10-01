import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import { TRIBUNAL_PUBLIC_MANUAL_ACCESS, tribunalPublicLookup } from "../../legalTribunalPublicRegistry.js";

export async function runTribunalPublicLookup(input: {
  processNumber: string;
  tribunal?: string | null;
  system?: string | null;
}): Promise<NormalizedSourceBatch & { publicUrl: string | null; capabilities: string[] }> {
  const lookup = tribunalPublicLookup(input);
  return {
    source: "TRIBUNAL_PUBLIC",
    outcome: lookup.adapter ? "CONFIGURATION_ERROR" : "NO_RESULTS",
    errorCode: lookup.errorCode,
    errorMessageSanitized: lookup.adapter
      ? `Consulta pública de ${lookup.adapter.label} exige acesso manual (CAPTCHA/anti-bot). URL oficial registrada.`
      : "Tribunal sem adapter público mapeado.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
    publicUrl: lookup.publicUrl,
    capabilities: lookup.capabilities,
  };
}

export { TRIBUNAL_PUBLIC_MANUAL_ACCESS };
