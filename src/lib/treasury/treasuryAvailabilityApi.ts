/**
 * Cliente HTTP — availability / flags de rollout (browser-safe).
 */

import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache.js";
import {
  TREASURY_AVAILABILITY_PATH,
  type TreasuryAvailabilityResponse,
} from "@/src/lib/treasury/contracts/index.js";

/**
 * Flags de disponibilidade são estáticas por deployment (env vars, não
 * dado financeiro) — TTL bem mais longo que o padrão de 60s do cache de
 * sessão. Sem isso, cada ida-e-volta para a Central de Tesouraria na mesma
 * aba refaz a consulta e a tela inteira fica bloqueada em "Carregando
 * disponibilidade do módulo…" de novo, mesmo a resposta não podendo mudar.
 */
const TREASURY_AVAILABILITY_CACHE_TTL_MS = 10 * 60_000;

export async function fetchTreasuryAvailability(input?: {
  signal?: AbortSignal;
}): Promise<TreasuryAvailabilityResponse> {
  return fetchUiSessionCachedJson<TreasuryAvailabilityResponse>(
    TREASURY_AVAILABILITY_PATH,
    {
      signal: input?.signal,
      ttlMs: TREASURY_AVAILABILITY_CACHE_TTL_MS,
    }
  );
}
