/**
 * Adaptador de teste. Não consulta CNPJ real e não abre rede.
 */

import type {
  ExternalProtestProvider,
  ExternalProtestProviderResult,
  ExternalProtestQueryRequest,
} from "./externalProtestProvider.js";

export type ScriptedExternalProtest = {
  results: readonly ExternalProtestProviderResult[];
  /** Quando verdadeiro, espera o cancelamento do sinal em vez de responder. */
  hang?: boolean;
};

export function createScriptedExternalProtestProvider(script: ScriptedExternalProtest): ExternalProtestProvider & {
  calls: string[];
} {
  const calls: string[] = [];
  let index = 0;
  return {
    id: "test",
    calls,
    async consult(request: ExternalProtestQueryRequest): Promise<ExternalProtestProviderResult> {
      calls.push(request.cnpj);
      if (script.hang) {
        await new Promise<never>((_, reject) => {
          const fail = () => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
          if (request.signal.aborted) fail();
          else request.signal.addEventListener("abort", fail, { once: true });
        });
      }
      const result = script.results[Math.min(index, script.results.length - 1)];
      index += 1;
      if (!result) {
        return {
          executionStatus: "FAILED",
          protestSituation: "UNREADABLE",
          occurrenceId: null,
          evidenceRef: null,
          source: "test",
          errorCode: "SCRIPT_EXHAUSTED",
        };
      }
      return result;
    },
  };
}
