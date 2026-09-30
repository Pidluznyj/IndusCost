/** Consulta DataJud por processo conhecido. Descoberta por CNPJ permanece bloqueada. */

export const DATAJUD_CNPJ_DISCOVERY_BLOCK_REASON = "DATAJUD_CNPJ_DISCOVERY_PENDING_PROBE";

/** Timeout só do DataJud. DJEN, Domicílio e o restante do Exposure continuam em 15s. */
export const DATAJUD_HTTP_TIMEOUT_MS = 90_000;

export function assertDatajudCnpjDiscoveryBlocked(): never {
  throw new Error(DATAJUD_CNPJ_DISCOVERY_BLOCK_REASON);
}

export function datajudProbeConfirmation(
  argv: readonly string[]
): { ok: true } | { ok: false; reason: string } {
  if (!argv.includes("--confirm-probe=DATAJUD_PROBE")) {
    return { ok: false, reason: "COMANDO DO PROBE DATAJUD NAO EXECUTADO" };
  }
  return { ok: true };
}

export function buildDatajudProcessQuery(processNumberNormalized: string): {
  size: number;
  track_total_hits: false;
  query: { match: { numeroProcesso: string } };
} {
  return {
    size: 20,
    track_total_hits: false,
    query: { match: { numeroProcesso: processNumberNormalized } },
  };
}
