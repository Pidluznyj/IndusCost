/**
 * Competências e Desenvolvimento — ENGINE OFICIAL (pura, sem Prisma).
 *
 * Fonte única de: requisito atendido, lacuna, cobertura, aptidão no posto, média da
 * avaliação, expiração por reciclagem e os agregados da Visão geral / Matriz.
 * API e UI consomem só estas funções; nenhuma tela recalcula por conta própria.
 *
 * Regras:
 * - requisito atendido = nível efetivo ≥ mínimo do posto do colaborador;
 * - lacuna = requisito não atendido, diferença = mínimo − nível efetivo;
 * - cobertura = atendidos / total de requisitos (null quando não há requisitos);
 * - apto no posto = atende 100% dos requisitos do posto;
 * - média da avaliação = média dos níveis atribuídos, 1 casa decimal, vírgula;
 * - lacuna crítica = lacuna em competência marcada como crítica (contada à parte na Visão geral);
 * - reciclagem: competência com `requiresRecycling` cujo último treinamento concluído
 *   do colaborador venceu (conclusão + validade em meses) tem nível efetivo 1.
 *   Sem treinamento concluído registrado, ou validade 0, o nível gravado é mantido.
 */

import {
  RECYCLING_EXPIRED_LEVEL,
  isCompetencyLevel,
  type CompetencyLevel,
} from "./competencyDomain";

export type CompetencyRef = {
  id: string;
  name: string;
  category: string;
  requiresRecycling: boolean;
  /** Competência crítica (ex.: segurança). Ausente = não crítica. */
  critical?: boolean;
};

export type PositionRequirementRef = { competencyId: string; minLevel: number };

export type WorkPositionRef = {
  id: string;
  name: string;
  departmentName: string | null;
  shiftPattern: string;
  requirements: PositionRequirementRef[];
};

export type EmployeeRef = { id: string; name: string; positionId: string | null };

export type StoredLevelRef = { employeeId: string; competencyId: string; level: number };

/** Conclusão de treinamento por participante (base da reciclagem). Datas ISO "AAAA-MM-DD". */
export type TrainingCompletionRef = {
  employeeId: string;
  competencyId: string;
  completedOn: string;
  validityMonths: number;
};

export type CompetencyEngineInput = {
  competencies: CompetencyRef[];
  positions: WorkPositionRef[];
  employees: EmployeeRef[];
  levels: StoredLevelRef[];
  trainingCompletions: TrainingCompletionRef[];
  /** Data de referência "AAAA-MM-DD" (hoje, no fuso de negócio). */
  asOf: string;
};

export type RecyclingState = "NOT_REQUIRED" | "NO_TRAINING" | "VALID" | "NO_EXPIRY" | "EXPIRED";

export type EffectiveLevel = {
  storedLevel: CompetencyLevel;
  level: CompetencyLevel;
  recycling: RecyclingState;
  /** Vencimento da reciclagem ("AAAA-MM-DD"), quando há validade. */
  recyclingExpiresOn: string | null;
};

export type RequirementEvaluation = {
  employeeId: string;
  employeeName: string;
  positionId: string;
  positionName: string;
  competencyId: string;
  competencyName: string;
  critical: boolean;
  requiredLevel: number;
  currentLevel: CompetencyLevel;
  met: boolean;
  /** mínimo − atual quando não atendido; 0 quando atendido. */
  gap: number;
  recycling: RecyclingState;
};

export type CoverageSummary = { met: number; total: number; ratio: number | null; percentLabel: string };

export type ReadinessTone = "success" | "warning" | "danger" | "neutral";

export type PositionReadiness = {
  positionId: string;
  positionName: string;
  departmentName: string | null;
  shiftPattern: string;
  ready: number;
  total: number;
  ratio: number | null;
  percentLabel: string;
  tone: ReadinessTone;
  requirements: { competencyId: string; competencyName: string; minLevel: number }[];
};

export const OVERVIEW_TOP_GAPS = 6;

// ---------------------------------------------------------------------------
// Datas (somente data, UTC, sem fuso)
// ---------------------------------------------------------------------------

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Soma meses a uma data ISO; dia ajustado ao fim do mês (31/01 + 1 → 28/02 ou 29/02). */
export function addMonthsIso(iso: string, months: number): string | null {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const totalMonths = p.y * 12 + (p.m - 1) + Math.trunc(months);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths - y * 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = Math.min(p.d, lastDay);
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isoKey(iso: string): string {
  return (iso ?? "").slice(0, 10);
}

// ---------------------------------------------------------------------------
// Nível efetivo (reciclagem)
// ---------------------------------------------------------------------------

function clampLevel(level: number): CompetencyLevel {
  return isCompetencyLevel(level) ? level : 0;
}

/** Último treinamento concluído do colaborador na competência (maior data de conclusão). */
export function latestTrainingCompletion(
  completions: readonly TrainingCompletionRef[],
  employeeId: string,
  competencyId: string,
): TrainingCompletionRef | null {
  let latest: TrainingCompletionRef | null = null;
  for (const c of completions) {
    if (c.employeeId !== employeeId || c.competencyId !== competencyId) continue;
    if (!parseIsoDate(c.completedOn)) continue;
    if (!latest || isoKey(c.completedOn) > isoKey(latest.completedOn)) latest = c;
  }
  return latest;
}

/**
 * Nível efetivo de uma competência: o nível gravado, ou 1 ("Em formação") quando a
 * competência exige reciclagem e o último treinamento concluído venceu. O vencimento é
 * inclusivo: no próprio dia de vencimento ainda vale; vence a partir do dia seguinte.
 */
export function resolveEffectiveLevel(params: {
  storedLevel: number;
  competency: Pick<CompetencyRef, "id" | "requiresRecycling">;
  employeeId: string;
  completions: readonly TrainingCompletionRef[];
  asOf: string;
}): EffectiveLevel {
  const storedLevel = clampLevel(params.storedLevel);
  if (!params.competency.requiresRecycling) {
    return { storedLevel, level: storedLevel, recycling: "NOT_REQUIRED", recyclingExpiresOn: null };
  }
  const latest = latestTrainingCompletion(params.completions, params.employeeId, params.competency.id);
  if (!latest) return { storedLevel, level: storedLevel, recycling: "NO_TRAINING", recyclingExpiresOn: null };
  if (!(latest.validityMonths > 0)) {
    return { storedLevel, level: storedLevel, recycling: "NO_EXPIRY", recyclingExpiresOn: null };
  }
  const expiresOn = addMonthsIso(latest.completedOn, latest.validityMonths);
  if (expiresOn && isoKey(params.asOf) > expiresOn) {
    const level = storedLevel > RECYCLING_EXPIRED_LEVEL ? RECYCLING_EXPIRED_LEVEL : storedLevel;
    return { storedLevel, level: level as CompetencyLevel, recycling: "EXPIRED", recyclingExpiresOn: expiresOn };
  }
  return { storedLevel, level: storedLevel, recycling: "VALID", recyclingExpiresOn: expiresOn };
}

// ---------------------------------------------------------------------------
// Requisitos, lacunas, cobertura, aptidão
// ---------------------------------------------------------------------------

/** Requisito atendido = nível atual ≥ mínimo. */
export function isRequirementMet(currentLevel: number, requiredLevel: number): boolean {
  return currentLevel >= requiredLevel;
}

/** Diferença da lacuna (mínimo − atual); 0 quando atendido. */
export function requirementGap(currentLevel: number, requiredLevel: number): number {
  return isRequirementMet(currentLevel, requiredLevel) ? 0 : requiredLevel - currentLevel;
}

type Indexes = {
  competencyById: Map<string, CompetencyRef>;
  competencyOrder: Map<string, number>;
  positionById: Map<string, WorkPositionRef>;
  storedLevel: Map<string, number>;
};

function levelKey(employeeId: string, competencyId: string): string {
  return `${employeeId}::${competencyId}`;
}

function buildIndexes(input: CompetencyEngineInput): Indexes {
  const competencyById = new Map(input.competencies.map((c) => [c.id, c]));
  const competencyOrder = new Map(input.competencies.map((c, i) => [c.id, i]));
  const positionById = new Map(input.positions.map((p) => [p.id, p]));
  const storedLevel = new Map<string, number>();
  for (const l of input.levels) storedLevel.set(levelKey(l.employeeId, l.competencyId), l.level);
  return { competencyById, competencyOrder, positionById, storedLevel };
}

function effectiveFor(input: CompetencyEngineInput, idx: Indexes, employeeId: string, competency: CompetencyRef) {
  return resolveEffectiveLevel({
    storedLevel: idx.storedLevel.get(levelKey(employeeId, competency.id)) ?? 0,
    competency,
    employeeId,
    completions: input.trainingCompletions,
    asOf: input.asOf,
  });
}

/** Requisitos válidos do posto (competência ativa e mínimo 1..4), na ordem das competências. */
function activeRequirements(position: WorkPositionRef, idx: Indexes): PositionRequirementRef[] {
  return position.requirements
    .filter((r) => idx.competencyById.has(r.competencyId) && r.minLevel >= 1)
    .sort((a, b) => (idx.competencyOrder.get(a.competencyId) ?? 0) - (idx.competencyOrder.get(b.competencyId) ?? 0));
}

/** Avalia todos os requisitos de todos os colaboradores alocados. */
export function evaluateRequirements(input: CompetencyEngineInput): RequirementEvaluation[] {
  const idx = buildIndexes(input);
  const out: RequirementEvaluation[] = [];
  for (const employee of input.employees) {
    const position = employee.positionId ? idx.positionById.get(employee.positionId) : undefined;
    if (!position) continue;
    for (const req of activeRequirements(position, idx)) {
      const competency = idx.competencyById.get(req.competencyId)!;
      const eff = effectiveFor(input, idx, employee.id, competency);
      out.push({
        employeeId: employee.id,
        employeeName: employee.name,
        positionId: position.id,
        positionName: position.name,
        competencyId: competency.id,
        competencyName: competency.name,
        critical: competency.critical === true,
        requiredLevel: req.minLevel,
        currentLevel: eff.level,
        met: isRequirementMet(eff.level, req.minLevel),
        gap: requirementGap(eff.level, req.minLevel),
        recycling: eff.recycling,
      });
    }
  }
  return out;
}

export function formatPercentLabel(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

/** Cobertura = atendidos / total de requisitos. */
export function computeCoverage(evaluations: readonly RequirementEvaluation[]): CoverageSummary {
  const total = evaluations.length;
  const met = evaluations.filter((e) => e.met).length;
  const ratio = total > 0 ? met / total : null;
  return { met, total, ratio, percentLabel: formatPercentLabel(ratio) };
}

/** Lacunas ordenadas pela maior diferença (empate: colaborador, depois ordem da competência). */
export function listGaps(evaluations: readonly RequirementEvaluation[]): RequirementEvaluation[] {
  return evaluations
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.met)
    .sort((a, b) => b.e.gap - a.e.gap || a.e.employeeName.localeCompare(b.e.employeeName, "pt-BR") || a.i - b.i)
    .map(({ e }) => e);
}

/** Apto no posto = atende 100% dos requisitos do posto. */
export function isEmployeeReady(evaluations: readonly RequirementEvaluation[], employeeId: string): boolean {
  return evaluations.filter((e) => e.employeeId === employeeId).every((e) => e.met);
}

/** Faixa da barra de aptidão: verde ≥ 75%, âmbar ≥ 50%, vermelho abaixo; neutro sem equipe. */
export function readinessTone(ratio: number | null): ReadinessTone {
  if (ratio === null) return "neutral";
  if (ratio >= 0.75) return "success";
  if (ratio >= 0.5) return "warning";
  return "danger";
}

export function computePositionReadiness(input: CompetencyEngineInput): PositionReadiness[] {
  const idx = buildIndexes(input);
  const evaluations = evaluateRequirements(input);
  return input.positions.map((position) => {
    const team = input.employees.filter((e) => e.positionId === position.id);
    const ready = team.filter((e) => isEmployeeReady(evaluations, e.id)).length;
    const ratio = team.length > 0 ? ready / team.length : null;
    return {
      positionId: position.id,
      positionName: position.name,
      departmentName: position.departmentName,
      shiftPattern: position.shiftPattern,
      ready,
      total: team.length,
      ratio,
      percentLabel: formatPercentLabel(ratio),
      tone: readinessTone(ratio),
      requirements: activeRequirements(position, idx).map((r) => ({
        competencyId: r.competencyId,
        competencyName: idx.competencyById.get(r.competencyId)!.name,
        minLevel: r.minLevel,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

/** Média dos níveis atribuídos (1 casa decimal). null sem níveis. */
export function assessmentAverage(levels: readonly number[]): number | null {
  const valid = levels.filter((l) => Number.isFinite(l));
  if (valid.length === 0) return null;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  return Math.round((mean + Number.EPSILON) * 10) / 10;
}

/** 2.75 → "2,8"; null → "—". */
export function formatAssessmentAverage(average: number | null): string {
  return average === null ? "—" : average.toFixed(1).replace(".", ",");
}

export function countPendingAssessments(statuses: readonly string[]): number {
  return statuses.filter((s) => s !== "COMPLETED").length;
}

export function countOpenTrainings(statuses: readonly string[]): number {
  return statuses.filter((s) => s !== "COMPLETED").length;
}

// ---------------------------------------------------------------------------
// Agregados de tela
// ---------------------------------------------------------------------------

export type CompetencyOverview = {
  coverage: CoverageSummary;
  openGaps: number;
  /** Lacunas em competências críticas (subconjunto de openGaps). */
  criticalGaps: number;
  pendingAssessments: number;
  openTrainings: number;
  readyEmployees: number;
  allocatedEmployees: number;
  topGaps: RequirementEvaluation[];
  positions: PositionReadiness[];
};

export function buildCompetencyOverview(
  input: CompetencyEngineInput,
  counters: { assessmentStatuses: readonly string[]; trainingStatuses: readonly string[] },
): CompetencyOverview {
  const evaluations = evaluateRequirements(input);
  const gaps = listGaps(evaluations);
  const positions = computePositionReadiness(input);
  return {
    coverage: computeCoverage(evaluations),
    openGaps: gaps.length,
    criticalGaps: gaps.filter((g) => g.critical).length,
    pendingAssessments: countPendingAssessments(counters.assessmentStatuses),
    openTrainings: countOpenTrainings(counters.trainingStatuses),
    readyEmployees: positions.reduce((acc, p) => acc + p.ready, 0),
    allocatedEmployees: input.employees.filter((e) => e.positionId && positions.some((p) => p.positionId === e.positionId)).length,
    topGaps: gaps.slice(0, OVERVIEW_TOP_GAPS),
    positions,
  };
}

export type CompetencyMatrixCell = {
  competencyId: string;
  level: CompetencyLevel;
  storedLevel: CompetencyLevel;
  requiredLevel: number | null;
  belowMinimum: boolean;
  recycling: RecyclingState;
  recyclingExpiresOn: string | null;
};

export type CompetencyMatrixRow = {
  employeeId: string;
  employeeName: string;
  positionId: string | null;
  positionName: string | null;
  cells: CompetencyMatrixCell[];
};

export type CompetencyMatrix = {
  competencies: CompetencyRef[];
  rows: CompetencyMatrixRow[];
};

/** Linhas = colaboradores, colunas = competências (ordem do catálogo). */
export function buildCompetencyMatrix(input: CompetencyEngineInput): CompetencyMatrix {
  const idx = buildIndexes(input);
  const rows = input.employees.map((employee) => {
    const position = employee.positionId ? idx.positionById.get(employee.positionId) : undefined;
    const required = new Map((position ? activeRequirements(position, idx) : []).map((r) => [r.competencyId, r.minLevel]));
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      positionId: position?.id ?? null,
      positionName: position?.name ?? null,
      cells: input.competencies.map((competency) => {
        const eff = effectiveFor(input, idx, employee.id, competency);
        const requiredLevel = required.get(competency.id) ?? null;
        return {
          competencyId: competency.id,
          level: eff.level,
          storedLevel: eff.storedLevel,
          requiredLevel,
          belowMinimum: requiredLevel !== null && !isRequirementMet(eff.level, requiredLevel),
          recycling: eff.recycling,
          recyclingExpiresOn: eff.recyclingExpiresOn,
        };
      }),
    };
  });
  return { competencies: input.competencies, rows };
}

/** Competências exigidas pelo posto, com mínimo e nível atual (modal de avaliação). */
export function assessmentScope(
  input: CompetencyEngineInput,
  employeeId: string,
): { competencyId: string; competencyName: string; requiredLevel: number; currentLevel: CompetencyLevel }[] {
  return evaluateRequirements(input)
    .filter((e) => e.employeeId === employeeId)
    .map((e) => ({
      competencyId: e.competencyId,
      competencyName: e.competencyName,
      requiredLevel: e.requiredLevel,
      currentLevel: e.currentLevel,
    }));
}

/** Colaboradores abaixo do mínimo numa competência (ponto vermelho nos chips do treinamento). */
export function employeesBelowMinimum(input: CompetencyEngineInput, competencyId: string): Set<string> {
  return new Set(
    evaluateRequirements(input)
      .filter((e) => e.competencyId === competencyId && !e.met)
      .map((e) => e.employeeId),
  );
}
