/**
 * Desempenho, Cultura e Potencial — tipos e regras puras (sem Prisma, sem I/O).
 *
 * Não reutiliza HrEmployeeEvaluation (experiência 45/90, escala 1–5) nem
 * HrCompetency (nível de posto 0–4). Colaborador continua sendo Employee.
 *
 * Textos, cortes e mínimos abaixo são PROPOSTA. Nada aqui está homologado.
 */

export const PERFORMANCE_MODULE_ID = "performance-cycle" as const;
export const PERFORMANCE_MODULE_PATH = "/performance-cycle" as const;

export const PILLARS = ["TECHNICAL", "CULTURE", "POTENTIAL"] as const;
export type Pillar = (typeof PILLARS)[number];

export const PILLAR_LABELS: Record<Pillar, string> = {
  TECHNICAL: "Técnico",
  CULTURE: "Cultura",
  POTENTIAL: "Potencial",
};

/** Escala de frequência observada. 4 não significa desempenho excepcional. */
export const FREQUENCY_SCALE = [
  { score: 1 as const, label: "Nunca ou quase nunca" },
  { score: 2 as const, label: "Às vezes" },
  { score: 3 as const, label: "Na maioria das vezes" },
  { score: 4 as const, label: "Sempre ou quase sempre" },
];

export const NOT_OBSERVED_LABEL = "Não sei / Não tive oportunidade";
export type FrequencyScore = 1 | 2 | 3 | 4;

export const MODEL_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export const CYCLE_STATUSES = [
  "DRAFT",
  "PREPARED",
  "OPEN",
  "CONSOLIDATION",
  "CALIBRATION",
  "HOMOLOGATED",
  "CLOSED",
] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  DRAFT: "Rascunho",
  PREPARED: "Preparado",
  OPEN: "Aberto",
  CONSOLIDATION: "Consolidação",
  CALIBRATION: "Calibração",
  HOMOLOGATED: "Homologado",
  CLOSED: "Encerrado",
};

export const ELIGIBILITY_STATES = ["ELIGIBLE", "NOT_ELIGIBLE", "INSUFFICIENT_EVIDENCE"] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export const ASSIGNMENT_KINDS = ["SELF", "LEADER"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export const ASSIGNMENT_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "RETURNED"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** Proposta não aprovada: mínimo de dias observáveis. */
export const PROPOSED_MIN_OBSERVATION_DAYS = 90;
/** Proposta não aprovada: respostas válidas mínimas por pilar. */
export const PROPOSED_MIN_VALID_ANSWERS = 3;
/** Proposta não aprovada: divergência que pede revisão. */
export const PROPOSED_DIVERGENCE_THRESHOLD = 2;
export const PROPOSED_CULTURE_RULE_ID = "culture-proposal-unapproved-v0";
export const PROPOSED_NINE_BOX_RULE_ID = "nine-box-proposal-unapproved-v0";
export const ALGORITHM_ID = "performance-mean-v0";

export const QUESTIONS_PER_PILLAR = 4;
export const BASE_QUESTION_COUNT = 12;

export type ProposedQuestion = {
  code: string;
  pillar: Pillar;
  sortOrder: number;
  selfText: string;
  leaderText: string;
  proposal: true;
};

/**
 * Redação provisória para o editor nascer preenchido.
 * O catálogo RFC não traz o texto homologado. Status do modelo = DRAFT / EM VALIDAÇÃO.
 */
export const PROPOSED_BASE_QUESTIONS: readonly ProposedQuestion[] = [
  q("DT-01", "TECHNICAL", 1, "Eu entrego o trabalho com a qualidade que a minha função pede.", "Entrega o trabalho com a qualidade que a função pede."),
  q("DT-02", "TECHNICAL", 2, "Eu sigo o jeito seguro e combinado de fazer a tarefa.", "Segue o jeito seguro e combinado de fazer a tarefa."),
  q("DT-03", "TECHNICAL", 3, "Eu cumpro o que foi combinado dentro da rotina do setor.", "Cumpre o que foi combinado dentro da rotina do setor."),
  q("DT-04", "TECHNICAL", 4, "Eu aviso quando algo sai do padrão da função.", "Avisa quando algo sai do padrão da função."),
  q("CU-01", "CULTURE", 5, "Eu trato as pessoas com respeito, mesmo quando discordo.", "Trata as pessoas com respeito, mesmo quando discorda."),
  q("CU-02", "CULTURE", 6, "Eu falo com clareza o que a outra pessoa precisa saber para trabalhar.", "Fala com clareza o que a outra pessoa precisa saber para trabalhar."),
  q("CU-03", "CULTURE", 7, "Eu ajudo o colega quando isso faz o trabalho do setor andar.", "Ajuda o colega quando isso faz o trabalho do setor andar."),
  q("CU-04", "CULTURE", 8, "Eu assumo o que fiz e conto o que aconteceu.", "Assume o que fez e conta o que aconteceu."),
  q("PO-01", "POTENTIAL", 9, "Eu aprendo uma tarefa nova quando alguém me ensina.", "Aprende uma tarefa nova quando alguém ensina."),
  q("PO-02", "POTENTIAL", 10, "Eu passo a fazer sozinho o que antes precisava de acompanhamento.", "Passa a fazer sozinho o que antes precisava de acompanhamento."),
  q("PO-03", "POTENTIAL", 11, "Eu aponto um jeito melhor quando vejo o mesmo problema se repetir.", "Aponta um jeito melhor quando vê o mesmo problema se repetir."),
  q("PO-04", "POTENTIAL", 12, "Eu consigo ajudar em outra tarefa do setor quando pedem.", "Consegue ajudar em outra tarefa do setor quando pedem."),
];

function q(code: string, pillar: Pillar, sortOrder: number, selfText: string, leaderText: string): ProposedQuestion {
  return { code, pillar, sortOrder, selfText, leaderText, proposal: true };
}

export type AnswerInput =
  | { kind: "pending" }
  | { kind: "score"; score: FrequencyScore; evidence?: string | null }
  | { kind: "notObserved" };

export function isFrequencyScore(value: unknown): value is FrequencyScore {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function parseAnswer(raw: unknown): AnswerInput | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === "pending") return { kind: "pending" };
  if (kind === "notObserved") return { kind: "notObserved" };
  if (kind === "score") {
    const score = (raw as { score?: unknown }).score;
    if (!isFrequencyScore(score)) return null;
    const evidence = (raw as { evidence?: unknown }).evidence;
    return { kind: "score", score, evidence: typeof evidence === "string" ? evidence : null };
  }
  return null;
}

/** Evidência breve exigida na nota extrema do líder. Proposta de tamanho mínimo. */
export const PROPOSED_EVIDENCE_MIN_CHARS = 8;

export function evidenceRequired(kind: AssignmentKind, answer: AnswerInput): boolean {
  return kind === "LEADER" && answer.kind === "score" && (answer.score === 1 || answer.score === 4);
}

export function evidenceSatisfied(kind: AssignmentKind, answer: AnswerInput): boolean {
  if (!evidenceRequired(kind, answer)) return true;
  if (answer.kind !== "score") return true;
  return (answer.evidence ?? "").trim().length >= PROPOSED_EVIDENCE_MIN_CHARS;
}

export type EmployeeSnapshotSource = {
  id: string;
  name: string;
  status: string | null;
  roleId: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string;
  managerId: string | null;
  managerName: string | null;
  admissionDate: Date | null;
  terminationDate: Date | null;
  registration: string | null;
};

export type EligibilityInput = {
  employee: EmployeeSnapshotSource;
  asOf: Date;
  minObservationDays: number;
  absenceOverlapsReference: boolean;
  roleChangedInsideWindow: boolean;
  exceptionReason: string | null;
};

export type EligibilityDecision = {
  state: EligibilityState;
  reason: string;
};

const MS_PER_DAY = 86_400_000;

export function classifyEligibility(input: EligibilityInput): EligibilityDecision {
  const status = (input.employee.status ?? "ACTIVE").toUpperCase();
  const terminated = input.employee.terminationDate != null || status !== "ACTIVE";
  if (terminated) {
    return { state: "NOT_ELIGIBLE", reason: "Vínculo inativo ou desligado. Exceção não reabre convite." };
  }
  const exception = input.exceptionReason?.trim() ?? "";
  if (exception.length > 0) {
    return { state: "ELIGIBLE", reason: `Exceção de RH: ${exception}` };
  }
  if (!input.employee.admissionDate) {
    return { state: "INSUFFICIENT_EVIDENCE", reason: "Sem data de admissão para medir o período observável." };
  }
  const days = Math.floor((input.asOf.getTime() - input.employee.admissionDate.getTime()) / MS_PER_DAY);
  if (days < input.minObservationDays) {
    return {
      state: "NOT_ELIGIBLE",
      reason: `Admissão há ${days} dia(s). Mínimo proposto: ${input.minObservationDays}. Não é pendência de resposta.`,
    };
  }
  if (input.absenceOverlapsReference) {
    return { state: "INSUFFICIENT_EVIDENCE", reason: "Afastamento no período de referência. Não é falta de resposta." };
  }
  if (input.roleChangedInsideWindow) {
    return { state: "INSUFFICIENT_EVIDENCE", reason: "Mudança de função no período. Exige leitura do RH." };
  }
  return { state: "ELIGIBLE", reason: "Período observável suficiente na proposta vigente." };
}

const FORWARD: Record<CycleStatus, CycleStatus | null> = {
  DRAFT: "PREPARED",
  PREPARED: "OPEN",
  OPEN: "CONSOLIDATION",
  CONSOLIDATION: "CALIBRATION",
  CALIBRATION: "HOMOLOGATED",
  HOMOLOGATED: "CLOSED",
  CLOSED: null,
};

const REVERSAL: Record<CycleStatus, CycleStatus | null> = {
  DRAFT: null,
  PREPARED: "DRAFT",
  OPEN: null,
  CONSOLIDATION: "OPEN",
  CALIBRATION: "CONSOLIDATION",
  HOMOLOGATED: "CALIBRATION",
  CLOSED: null,
};

export function nextCycleStatus(
  from: CycleStatus,
  to: CycleStatus,
  authorizedReversal: boolean
): { ok: true } | { ok: false; code: string } {
  if (from === to) return { ok: false, code: "SAME_STATUS" };
  if (FORWARD[from] === to) return { ok: true };
  if (REVERSAL[from] === to) {
    return authorizedReversal ? { ok: true } : { ok: false, code: "REVERSAL_FORBIDDEN" };
  }
  return { ok: false, code: "TRANSITION_FORBIDDEN" };
}

export type StoredAnswer = {
  questionCode: string;
  pillar: Pillar;
  kind: "pending" | "score" | "notObserved";
  score: FrequencyScore | null;
  evidence: string | null;
};

export function formatPillarMean(sum: number, count: number): string | null {
  if (count <= 0) return null;
  const cents = Math.round((sum * 100) / count);
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${whole},${frac}`;
}

/** Compara soma/contagem com um racional sem arredondar o quociente. */
export function meanBelow(sum: number, count: number, numerator: number, denominator: number): boolean {
  if (count <= 0) return false;
  return sum * denominator < numerator * count;
}

export function meanAtLeast(sum: number, count: number, numerator: number, denominator: number): boolean {
  if (count <= 0) return false;
  return sum * denominator >= numerator * count;
}

export type PillarMath = {
  sum: number;
  count: number;
  insufficient: boolean;
  display: string | null;
};

export function aggregatePillar(answers: readonly StoredAnswer[], pillar: Pillar, minValid: number): PillarMath {
  let sum = 0;
  let count = 0;
  for (const answer of answers) {
    if (answer.pillar !== pillar) continue;
    if (answer.kind === "score" && answer.score != null) {
      sum += answer.score;
      count += 1;
    }
  }
  return {
    sum,
    count,
    insufficient: count < minValid,
    display: formatPillarMean(sum, count),
  };
}

export type CultureBand = "CONSISTENT" | "DEVELOPING" | "NEEDS_REVIEW" | "INSUFFICIENT";

export function cultureBand(answers: readonly StoredAnswer[], minValid: number): {
  band: CultureBand;
  ruleId: string;
  homologated: false;
  basis: string;
} {
  const math = aggregatePillar(answers, "CULTURE", minValid);
  if (math.insufficient) {
    return {
      band: "INSUFFICIENT",
      ruleId: PROPOSED_CULTURE_RULE_ID,
      homologated: false,
      basis: "Menos respostas válidas que o mínimo proposto. Sem classificação cultural.",
    };
  }
  const hasNever = answers.some((a) => a.pillar === "CULTURE" && a.kind === "score" && a.score === 1);
  if (hasNever) {
    return {
      band: "NEEDS_REVIEW",
      ruleId: PROPOSED_CULTURE_RULE_ID,
      homologated: false,
      basis: "Há frequência 1 em cultura. Sinal para leitura humana, sem punição automática.",
    };
  }
  if (meanAtLeast(math.sum, math.count, 7, 2)) {
    return {
      band: "CONSISTENT",
      ruleId: PROPOSED_CULTURE_RULE_ID,
      homologated: false,
      basis: "Média proposta ≥ 3,50, sem arredondar o corte.",
    };
  }
  return {
    band: "DEVELOPING",
    ruleId: PROPOSED_CULTURE_RULE_ID,
    homologated: false,
    basis: "Média abaixo de 3,50 na proposta. Não altera a Nine-Box.",
  };
}

export type NineBoxBand = "LOW" | "MID" | "HIGH";

export function nineBoxBand(sum: number, count: number): NineBoxBand {
  if (meanBelow(sum, count, 5, 2)) return "LOW";
  if (meanAtLeast(sum, count, 7, 2)) return "HIGH";
  return "MID";
}

export type TechnicalValidation = "INSUFFICIENT" | "PENDING_VALIDATION" | "VALIDATED";

export type NineBoxPlacement = {
  quadrant: string;
  x: NineBoxBand | null;
  y: NineBoxBand | null;
  official: false;
  ruleId: string;
  reason: string;
};

const QUADRANT_LABEL: Record<NineBoxBand, Record<NineBoxBand, string>> = {
  LOW: { LOW: "Desempenho baixo · Potencial baixo", MID: "Desempenho baixo · Potencial médio", HIGH: "Desempenho baixo · Potencial alto" },
  MID: { LOW: "Desempenho médio · Potencial baixo", MID: "Desempenho médio · Potencial médio", HIGH: "Desempenho médio · Potencial alto" },
  HIGH: { LOW: "Desempenho alto · Potencial baixo", MID: "Desempenho alto · Potencial médio", HIGH: "Desempenho alto · Potencial alto" },
};

export function placeNineBox(input: {
  technical: PillarMath;
  potential: PillarMath;
  technicalValidation: TechnicalValidation;
}): NineBoxPlacement {
  if (input.technical.insufficient || input.technicalValidation === "INSUFFICIENT") {
    return unclassified("Evidência técnica insuficiente. Sem empurrar para o quadrante 1.");
  }
  if (input.technicalValidation !== "VALIDATED") {
    return unclassified("Desempenho técnico ainda não validado com a função. Resultado preliminar sem quadrante.");
  }
  if (input.potential.insufficient) {
    return unclassified("Evidência de potencial insuficiente. Sem classificação.");
  }
  const x = nineBoxBand(input.technical.sum, input.technical.count);
  const y = nineBoxBand(input.potential.sum, input.potential.count);
  return {
    quadrant: QUADRANT_LABEL[x][y],
    x,
    y,
    official: false,
    ruleId: PROPOSED_NINE_BOX_RULE_ID,
    reason: "Posição preliminar. Cortes 2,50 e 3,50 são proposta e não estão homologados.",
  };
}

function unclassified(reason: string): NineBoxPlacement {
  return { quadrant: "SEM_CLASSIFICACAO", x: null, y: null, official: false, ruleId: PROPOSED_NINE_BOX_RULE_ID, reason };
}

export type Divergence = { questionCode: string; selfScore: FrequencyScore; leaderScore: FrequencyScore; gap: number };

export function findDivergences(
  selfAnswers: readonly StoredAnswer[],
  leaderAnswers: readonly StoredAnswer[],
  threshold: number
): Divergence[] {
  const selfByCode = new Map(selfAnswers.filter((a) => a.kind === "score" && a.score != null).map((a) => [a.questionCode, a.score!]));
  const out: Divergence[] = [];
  for (const leader of leaderAnswers) {
    if (leader.kind !== "score" || leader.score == null) continue;
    const selfScore = selfByCode.get(leader.questionCode);
    if (selfScore == null) continue;
    const gap = Math.abs(selfScore - leader.score);
    if (gap >= threshold) out.push({ questionCode: leader.questionCode, selfScore, leaderScore: leader.score, gap });
  }
  return out;
}

/** Neutraliza fórmula de planilha. Só na exportação. */
export function neutralizeSpreadsheetCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}
