/**
 * Competências e Desenvolvimento — governança de níveis (regra PURA).
 *
 * Regras adotadas (2026-10-15; ajustáveis aqui, em um único lugar):
 * - Avaliação formal (ASSESSMENT) é o registro oficial: grava direto, sem aprovação.
 * - Ajuste na matriz (MANUAL) ou importação (IMPORT) que SOBE um nível exige aprovação quando:
 *     • o nível de destino é ≥ 3 (Proficiente/Referência) — GOVERNED_MIN_LEVEL; ou
 *     • a competência é CRÍTICA (ex.: NR-12), qualquer que seja o destino.
 * - Rebaixar nunca exige aprovação (direção conservadora).
 * - Quem tem a permissão de aprovar aplica direto (registrado como aprovado na origem);
 *   os demais geram uma solicitação PENDENTE, que não altera a matriz até a decisão.
 * - Rejeitar exige justificativa. Quem solicitou não decide a própria solicitação.
 */

export const GOVERNED_MIN_LEVEL = 3;

export type LevelChangeSource = "ASSESSMENT" | "MANUAL" | "IMPORT" | "TRAINING";

export const LEVEL_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
export type LevelRequestStatus = (typeof LEVEL_REQUEST_STATUSES)[number];
export const LEVEL_REQUEST_STATUS_LABELS: Record<LevelRequestStatus, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  SUPERSEDED: "Superada",
};

export type ApprovalReason = "GOVERNED_LEVEL" | "CRITICAL_COMPETENCY";
export const APPROVAL_REASON_LABELS: Record<ApprovalReason, string> = {
  GOVERNED_LEVEL: "Nível 3 ou 4 fora de avaliação formal",
  CRITICAL_COMPETENCY: "Competência crítica",
};

export const DECISION_NOTE_MAX_LEN = 1000;

/** Motivo pelo qual a alteração exige aprovação; null = grava direto. */
export function approvalReason(params: {
  source: LevelChangeSource;
  from: number;
  to: number;
  critical: boolean;
}): ApprovalReason | null {
  if (params.source === "ASSESSMENT" || params.source === "TRAINING") return null;
  if (params.to <= params.from) return null;
  if (params.critical) return "CRITICAL_COMPETENCY";
  if (params.to >= GOVERNED_MIN_LEVEL) return "GOVERNED_LEVEL";
  return null;
}

export type LevelWriteDecision =
  | { kind: "APPLY"; selfApproved: ApprovalReason | null }
  | { kind: "REQUEST"; reason: ApprovalReason };

/** Grava direto, grava como aprovado na origem (aprovador) ou vira solicitação pendente. */
export function decideLevelWrite(params: {
  source: LevelChangeSource;
  from: number;
  to: number;
  critical: boolean;
  actorCanApprove: boolean;
}): LevelWriteDecision {
  const reason = approvalReason(params);
  if (!reason) return { kind: "APPLY", selfApproved: null };
  if (params.actorCanApprove) return { kind: "APPLY", selfApproved: reason };
  return { kind: "REQUEST", reason };
}

/** Validação da decisão (rejeitar exige justificativa; ninguém decide a própria solicitação). */
export function validateDecision(params: {
  decision: "APPROVE" | "REJECT";
  note: string | null;
  requestedByUserId: string | null;
  deciderUserId: string | null;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (params.decision === "REJECT" && !(params.note ?? "").trim()) {
    return { ok: false, code: "NOTE_REQUIRED", message: "Informe a justificativa da rejeição." };
  }
  if ((params.note ?? "").length > DECISION_NOTE_MAX_LEN) {
    return { ok: false, code: "NOTE_TOO_LONG", message: "Justificativa muito longa." };
  }
  if (params.requestedByUserId && params.deciderUserId && params.requestedByUserId === params.deciderUserId) {
    return { ok: false, code: "SELF_DECISION", message: "Quem solicitou não pode decidir a própria solicitação." };
  }
  return { ok: true };
}
