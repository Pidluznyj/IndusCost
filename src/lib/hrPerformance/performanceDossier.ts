/**
 * Calibração com todos os ângulos (docs/avaliacao-desempenho/DOSSIE_AVALIACOES_POR_PERFIL.md §6–7):
 * - dossiê da pessoa: tudo que existe sobre ela no ciclo, numa ficha só;
 * - painel por avaliador: como cada líder distribui as notas que dá, para o comitê enxergar
 *   leniência, severidade, tendência central e efeito halo antes de calibrar.
 * Respostas individuais da equipe sobre o líder continuam fora: só a média divulgável.
 */
import { canSeeEmployee, type PerformanceScope } from "./performanceAccess.js";
import { calibrationQueue, employeeHistory } from "./performanceInsights.js";
import { leadershipComparison } from "./performanceLeadershipService.js";
import { activeAssignment, eligibleParticipants, toStored } from "./performanceService.js";
import type { PerformanceDatabase } from "./performanceState.js";

export type BiasFlag = "LENIENT" | "SEVERE" | "CENTRAL" | "HALO";
export const BIAS_LABELS: Record<BiasFlag, string> = {
  LENIENT: "Tende a notas altas",
  SEVERE: "Tende a notas baixas",
  CENTRAL: "Quase tudo no meio da escala",
  HALO: "Mesma nota em todas as competências",
};

export type EvaluatorStat = {
  evaluatorEmployeeId: string;
  evaluatorName: string | null;
  evaluated: number;
  submitted: number;
  /** Média das notas dadas (1–4), só respostas com nota. */
  mean: number | null;
  /** Média do ciclo inteiro, para comparar. */
  cycleMean: number | null;
  distribution: { 1: number; 2: number; 3: number; 4: number; notObserved: number };
  extremeShare: number | null;
  /** Fração das avaliações em que todas as notas foram iguais. */
  flatShare: number | null;
  flags: BiasFlag[];
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Estatística das notas que cada líder deu no ciclo (avaliações individuais enviadas). */
export function evaluatorStats(db: PerformanceDatabase, cycleId: string, minSubmitted = 3): EvaluatorStat[] {
  const eligible = eligibleParticipants(db, cycleId);
  const names = new Map(db.participants.filter((p) => p.cycleId === cycleId).map((p) => [p.employeeId, p.employeeName]));
  const byEvaluator = new Map<string, { evaluated: number; submitted: number; scores: number[]; notObserved: number; flat: number }>();
  const all: number[] = [];
  for (const p of eligible) {
    const leader = activeAssignment(db, p.id, "LEADER");
    if (!leader) continue;
    const entry = byEvaluator.get(leader.evaluatorEmployeeId) ?? { evaluated: 0, submitted: 0, scores: [], notObserved: 0, flat: 0 };
    entry.evaluated += 1;
    if (leader.status === "SUBMITTED") {
      entry.submitted += 1;
      const answers = toStored(db, leader.id);
      const scores = answers.filter((a) => a.kind === "score" && a.score != null).map((a) => a.score as number);
      entry.scores.push(...scores);
      all.push(...scores);
      entry.notObserved += answers.filter((a) => a.kind === "notObserved").length;
      if (scores.length >= 4 && scores.every((s) => s === scores[0])) entry.flat += 1;
    }
    byEvaluator.set(leader.evaluatorEmployeeId, entry);
  }
  const cycleMean = all.length ? round2(all.reduce((s, v) => s + v, 0) / all.length) : null;
  return [...byEvaluator.entries()]
    .map(([evaluatorEmployeeId, e]) => {
      const n = e.scores.length;
      const mean = n ? round2(e.scores.reduce((s, v) => s + v, 0) / n) : null;
      const count = (v: number) => e.scores.filter((s) => s === v).length;
      const distribution = { 1: count(1), 2: count(2), 3: count(3), 4: count(4), notObserved: e.notObserved };
      const extremeShare = n ? round2((count(1) + count(4)) / n) : null;
      const flatShare = e.submitted ? round2(e.flat / e.submitted) : null;
      const flags: BiasFlag[] = [];
      // Só com amostra mínima de avaliações enviadas; limites simples e explícitos.
      if (e.submitted >= minSubmitted && mean != null && cycleMean != null) {
        if (mean - cycleMean >= 0.5) flags.push("LENIENT");
        if (cycleMean - mean >= 0.5) flags.push("SEVERE");
        if (n && (count(2) + count(3)) / n >= 0.9 && extremeShare !== null && extremeShare <= 0.05) flags.push("CENTRAL");
        if (flatShare !== null && flatShare >= 0.5) flags.push("HALO");
      }
      return { evaluatorEmployeeId, evaluatorName: names.get(evaluatorEmployeeId) ?? null, evaluated: e.evaluated, submitted: e.submitted, mean, cycleMean, distribution, extremeShare, flatShare, flags };
    })
    .sort((a, b) => (a.evaluatorName ?? "").localeCompare(b.evaluatorName ?? "", "pt-BR"));
}

/** Ficha única da pessoa para a calibração. `scope` já é o escopo de RESULTADO de quem pede. */
export function personDossier(db: PerformanceDatabase, participantId: string, scope: PerformanceScope, actorEmployeeId: string | null) {
  const participant = db.participants.find((p) => p.id === participantId && !p.removedAt);
  if (!participant) return { ok: false as const, code: "NOT_FOUND", message: "Participante não encontrado." };
  if (!canSeeEmployee(scope, participant.employeeId)) return { ok: false as const, code: "FORBIDDEN", message: "Acesso negado." };
  const cycle = db.cycles.find((c) => c.id === participant.cycleId)!;
  const queue = calibrationQueue(db, cycle.id, { kind: "ALL" });
  const individual = queue?.rows.find((r) => r.participantId === participant.id) ?? null;
  const leadership = participant.isLeader && cycle.leadershipModelId ? leadershipComparison(db, participant.id, scope, actorEmployeeId) : null;
  const asEvaluator = evaluatorStats(db, cycle.id).find((e) => e.evaluatorEmployeeId === participant.employeeId) ?? null;
  const history = employeeHistory(db, participant.employeeId, scope, false);
  // Só ciclos anteriores com resultado homologado: rascunho ou coleta em andamento não são histórico.
  const previous = history.ok ? history.cycles.filter((c) => c.cycleId !== cycle.id && c.quadrant !== null) : [];
  const pdis = db.pdis
    .filter((p) => p.participantId === participant.id)
    .map((p) => ({
      id: p.id,
      title: p.title,
      competencyCode: p.competencyCode,
      status: p.status,
      dueAt: p.dueAt,
      checkins: db.checkins.filter((c) => c.pdiId === p.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c) => ({ note: c.note, obstacle: c.obstacle, nextStep: c.nextStep, createdAt: c.createdAt })),
    }));
  const versions = db.results.filter((r) => r.participantId === participant.id).sort((a, b) => a.version - b.version).map((r) => ({ version: r.version, reviewStatus: r.reviewStatus, quadrant: r.quadrant, adjusted: r.adjusted, calibrationNote: r.calibrationNote, calibratedAt: r.calibratedAt, official: r.official }));
  return {
    ok: true as const,
    participant: {
      id: participant.id,
      employeeId: participant.employeeId,
      employeeName: participant.employeeName,
      roleName: participant.roleName,
      departmentName: participant.departmentName,
      managerName: participant.managerName,
      managerSource: participant.managerSource,
      admissionDate: participant.admissionDate,
      isLeader: participant.isLeader,
      directReportCount: participant.directReportCount,
      eligibility: participant.eligibility,
    },
    cycle: { id: cycle.id, name: cycle.name, status: cycle.status, periodLabel: cycle.periodLabel },
    rules: queue?.rules ?? null,
    individual,
    leadership: leadership && leadership.ok ? leadership : null,
    asEvaluator,
    previousCycles: previous,
    pdis,
    versions,
  };
}
