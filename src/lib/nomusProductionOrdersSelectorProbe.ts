/**
 * Homologação / probe de seletores RSQL de OP (OP-14.2).
 * Campo no payload ≠ campo aceito na query — validar explicitamente.
 */

export type ProductionOrdersRsqlSelectorProbeStatus =
  | "ACCEPTED"
  | "REJECTED"
  | "INCONCLUSIVE";

export type ProductionOrdersRsqlHomologation = "accepted" | "rejected" | "unverified";

export const NOMUS_PRODUCTION_ORDERS_SELECTOR_HOMOLOGATION_ENV =
  "NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION";

/** Preferencial OP-14.2 — última edição real no payload. */
export const NOMUS_PRODUCTION_ORDERS_INCREMENTAL_PREFERRED_SELECTOR = "dataHoraEdicao" as const;

export type ProductionOrdersIncrementalDateSelector =
  | "dataHoraEdicao"
  | "dataHoraCriacao"
  | "dataAlteracao"
  | "dataAbertura";

export function parseSelectorHomologation(
  raw: string | null | undefined
): ProductionOrdersRsqlHomologation {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "accepted" || value === "accept" || value === "ok") return "accepted";
  if (value === "rejected" || value === "reject" || value === "fail") return "rejected";
  return "unverified";
}

export function resolveSelectorHomologationFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  selector: string = NOMUS_PRODUCTION_ORDERS_INCREMENTAL_PREFERRED_SELECTOR
): ProductionOrdersRsqlHomologation {
  const raw = (env[NOMUS_PRODUCTION_ORDERS_SELECTOR_HOMOLOGATION_ENV] ?? "").trim();
  if (!raw) return "unverified";
  // Formatos: "accepted" | "dataHoraEdicao:accepted,dataHoraCriacao:unverified"
  if (!raw.includes(":")) return parseSelectorHomologation(raw);
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const [name, status] = part.split(":").map((s) => s.trim());
    if (name === selector) return parseSelectorHomologation(status);
  }
  return "unverified";
}

/**
 * Classifica erro HTTP/mensagem do Nomus para probe de seletor RSQL.
 * Conservador: na dúvida → INCONCLUSIVE (não declara ACCEPTED).
 */
export function classifyProductionOrdersSelectorProbeOutcome(args: {
  httpStatus: number | null;
  bodyText: string | null;
  recordsReceived: number | null;
  threw: boolean;
  errorMessage?: string | null;
}): ProductionOrdersRsqlSelectorProbeStatus {
  const text = `${args.bodyText ?? ""} ${args.errorMessage ?? ""}`.toLowerCase();

  if (args.httpStatus === 401 || args.httpStatus === 403) return "INCONCLUSIVE";
  if (args.httpStatus === 429) return "INCONCLUSIVE";
  if (args.httpStatus != null && args.httpStatus >= 500) return "INCONCLUSIVE";

  const rejectionHints = [
    "campo inválido",
    "campo invalido",
    "invalid field",
    "unknown field",
    "campo desconhecido",
    "rsql",
    "query inválida",
    "query invalida",
    "filtro inválido",
    "filtro invalido",
    "não encontrado",
    "nao encontrado",
    "bad request",
  ];

  if (args.httpStatus === 400 || args.httpStatus === 422) {
    if (rejectionHints.some((h) => text.includes(h)) || text.length > 0) {
      return "REJECTED";
    }
    return "INCONCLUSIVE";
  }

  if (args.threw) {
    if (rejectionHints.some((h) => text.includes(h))) return "REJECTED";
    return "INCONCLUSIVE";
  }

  if (args.httpStatus === 200 || args.httpStatus === 204) {
    // Resposta OK com lista (mesmo vazia) → seletor aceito pela API.
    if (args.recordsReceived != null && args.recordsReceived >= 0) return "ACCEPTED";
    return "ACCEPTED";
  }

  return "INCONCLUSIVE";
}

export function homologationFromProbeStatus(
  status: ProductionOrdersRsqlSelectorProbeStatus
): ProductionOrdersRsqlHomologation {
  if (status === "ACCEPTED") return "accepted";
  if (status === "REJECTED") return "rejected";
  return "unverified";
}

export function isNomusRsqlSelectorRejectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusMatch = message.match(/\b(400|422)\b/);
  const classified = classifyProductionOrdersSelectorProbeOutcome({
    httpStatus: statusMatch ? Number(statusMatch[1]) : null,
    bodyText: message,
    recordsReceived: null,
    threw: true,
    errorMessage: message,
  });
  return classified === "REJECTED";
}
