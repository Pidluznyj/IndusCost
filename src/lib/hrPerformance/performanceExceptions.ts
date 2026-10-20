/**
 * Exceções de um ciclo, num lugar só: tudo que o RH decidiu fora da regra, com motivo e autor
 * (elegibilidade, troca de líder, calibração sem avaliação do líder, calibração de liderança sem
 * fonte, pendências aceitas ao avançar). Lê só a trilha de auditoria: nada de nota nem comentário.
 */
import type { PerformanceDatabase } from "./performanceState.js";

export type CycleException = {
  at: string;
  kind: "ELIGIBILITY" | "LEADER_CHANGE" | "CALIBRATION_WITHOUT_LEADER" | "LEADERSHIP_WITHOUT_SOURCE" | "PENDING_ACCEPTED";
  label: string;
  person: string | null;
  reason: string | null;
  actorUserId: string | null;
};

const LABELS: Record<CycleException["kind"], string> = {
  ELIGIBILITY: "Elegibilidade por exceção",
  LEADER_CHANGE: "Troca de líder",
  CALIBRATION_WITHOUT_LEADER: "Calibrada sem avaliação do líder",
  LEADERSHIP_WITHOUT_SOURCE: "Liderança calibrada sem uma das fontes",
  PENDING_ACCEPTED: "Avançou com pendências",
};

export function cycleExceptions(db: PerformanceDatabase, cycleId: string): CycleException[] {
  const participants = db.participants.filter((p) => p.cycleId === cycleId);
  const byId = new Map(participants.map((p) => [p.id, p]));
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const out: CycleException[] = [];
  for (const a of db.audits) {
    const participant = byId.get(a.entityId);
    const forCycle = participant || a.entityId === cycleId;
    if (!forCycle) continue;
    const d = a.detail;
    const push = (kind: CycleException["kind"], reason: string | null) => out.push({ at: a.at, kind, label: LABELS[kind], person: participant?.employeeName ?? null, reason, actorUserId: a.actorUserId });
    if (a.action === "ELIGIBILITY_EXCEPTION_SET") push("ELIGIBILITY", text(d.reason));
    else if (a.action === "LEADER_REASSIGNED") push("LEADER_CHANGE", text(d.reason));
    else if (a.action === "RESULT_CALIBRATED_WITHOUT_LEADER") push("CALIBRATION_WITHOUT_LEADER", text(d.note));
    else if (a.action === "LEADERSHIP_CALIBRATED_EXCEPTION") push("LEADERSHIP_WITHOUT_SOURCE", text(d.exceptionReason));
    else if (a.action === "PENDING_ACCEPTED") push("PENDING_ACCEPTED", typeof d.pending === "number" ? `${d.pending} pendência(s) ao ${d.stage === "CONSOLIDATION" ? "fechar a coleta" : "encerrar"}` : null);
  }
  // Exceções de elegibilidade dadas na inclusão não geram auditoria própria: vêm do participante.
  for (const p of participants) {
    if (p.eligibilityException && !out.some((e) => e.kind === "ELIGIBILITY" && e.person === p.employeeName)) {
      out.push({ at: p.addedAt, kind: "ELIGIBILITY", label: LABELS.ELIGIBILITY, person: p.employeeName, reason: p.eligibilityException, actorUserId: null });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
