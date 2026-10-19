/**
 * Desempenho, Cultura e Potencial — tipos e regras puras (sem Prisma, sem I/O).
 *
 * Não reutiliza HrEmployeeEvaluation (experiência 45/90, escala 1–5) nem
 * HrCompetency (nível de posto 0–4). Colaborador continua sendo Employee.
 *
 * Textos, cortes e mínimos abaixo são PROPOSTA. Nada aqui está homologado.
 * Cada modelo publicado guarda a própria cópia das regras (`PerformanceRules`):
 * o cálculo de um ciclo usa sempre as regras da versão do modelo do ciclo.
 */

export const PERFORMANCE_MODULE_ID = "performance-cycle" as const;
export const PERFORMANCE_MODULE_PATH = "/performance-cycle" as const;

export const PILLARS = ["TECHNICAL", "CULTURE", "POTENTIAL"] as const;
export type Pillar = (typeof PILLARS)[number];

export const PILLAR_LABELS: Record<Pillar, string> = {
  TECHNICAL: "Desempenho técnico",
  CULTURE: "Cultura e comportamento",
  POTENTIAL: "Potencial",
};

export const PILLAR_SHORT_LABELS: Record<Pillar, string> = {
  TECHNICAL: "Técnico",
  CULTURE: "Cultura",
  POTENTIAL: "Potencial",
};

export const PILLAR_CODE_PREFIX: Record<Pillar, string> = {
  TECHNICAL: "DT",
  CULTURE: "CU",
  POTENTIAL: "PO",
};

export function isPillar(value: unknown): value is Pillar {
  return value === "TECHNICAL" || value === "CULTURE" || value === "POTENTIAL";
}

/** Escala de frequência observada. 4 não significa desempenho excepcional. */
export const FREQUENCY_SCALE = [
  { score: 1 as const, label: "Nunca ou quase nunca" },
  { score: 2 as const, label: "Às vezes" },
  { score: 3 as const, label: "Na maioria das vezes" },
  { score: 4 as const, label: "Sempre ou quase sempre" },
];

export const NOT_OBSERVED_LABEL = "Não sei responder / Não tive oportunidade";
export type FrequencyScore = 1 | 2 | 3 | 4;

export function scoreLabel(score: number | null | undefined): string {
  return FREQUENCY_SCALE.find((item) => item.score === score)?.label ?? "—";
}

export const MODEL_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export const MODEL_STATUS_LABELS: Record<ModelStatus, string> = {
  DRAFT: "Rascunho",
  PUBLISHED: "Publicado",
  ARCHIVED: "Inativo",
};

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

export function isCycleStatus(value: unknown): value is CycleStatus {
  return typeof value === "string" && (CYCLE_STATUSES as readonly string[]).includes(value);
}

export const ELIGIBILITY_STATES = ["ELIGIBLE", "NOT_ELIGIBLE", "INSUFFICIENT_EVIDENCE"] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export const ELIGIBILITY_LABELS: Record<EligibilityState, string> = {
  ELIGIBLE: "Elegível",
  NOT_ELIGIBLE: "Não elegível",
  INSUFFICIENT_EVIDENCE: "Evidência insuficiente",
};

export const ASSIGNMENT_KINDS = ["SELF", "LEADER"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export const ASSIGNMENT_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "RETURNED"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  NOT_STARTED: "Não iniciada",
  IN_PROGRESS: "Em andamento",
  SUBMITTED: "Enviada",
  RETURNED: "Devolvida para revisão",
};

export const PDI_STATUSES = ["PLANNED", "IN_PROGRESS", "DONE", "SUSPENDED", "CANCELLED"] as const;
export type PdiStatus = (typeof PDI_STATUSES)[number];

export const PDI_STATUS_LABELS: Record<PdiStatus, string> = {
  PLANNED: "Planejada",
  IN_PROGRESS: "Em andamento",
  DONE: "Concluída",
  SUSPENDED: "Suspensa",
  CANCELLED: "Cancelada",
};

export function isPdiStatus(value: unknown): value is PdiStatus {
  return typeof value === "string" && (PDI_STATUSES as readonly string[]).includes(value);
}

/**
 * Regras de cálculo de uma versão de modelo. Cortes em centésimos (250 = 2,50) para
 * comparar sem ponto flutuante. Tudo é proposta até decisão do RH/direção.
 */
export type PerformanceRules = {
  ruleSetId: string;
  minValidAnswers: number;
  nineBoxLowCut: number;
  nineBoxHighCut: number;
  cultureConsistentCut: number;
  divergenceThreshold: number;
  requireExtremeEvidence: boolean;
  evidenceMinChars: number;
  minObservationDays: number;
};

export const PROPOSED_RULE_SET_ID = "proposal-unapproved-v0";
/** Proposta não aprovada: mínimo de dias observáveis. */
export const PROPOSED_MIN_OBSERVATION_DAYS = 90;
/** Proposta não aprovada: respostas válidas mínimas por pilar. */
export const PROPOSED_MIN_VALID_ANSWERS = 3;
/** Proposta não aprovada: divergência que pede revisão. */
export const PROPOSED_DIVERGENCE_THRESHOLD = 2;
/** Evidência breve exigida na nota extrema do líder. Proposta de tamanho mínimo. */
export const PROPOSED_EVIDENCE_MIN_CHARS = 8;
export const PROPOSED_CULTURE_RULE_ID = "culture-proposal-unapproved-v0";
export const PROPOSED_NINE_BOX_RULE_ID = "nine-box-proposal-unapproved-v0";
export const ALGORITHM_ID = "performance-mean-v0";

export const PROPOSED_RULES: PerformanceRules = Object.freeze({
  ruleSetId: PROPOSED_RULE_SET_ID,
  minValidAnswers: PROPOSED_MIN_VALID_ANSWERS,
  nineBoxLowCut: 250,
  nineBoxHighCut: 350,
  cultureConsistentCut: 350,
  divergenceThreshold: PROPOSED_DIVERGENCE_THRESHOLD,
  requireExtremeEvidence: true,
  evidenceMinChars: PROPOSED_EVIDENCE_MIN_CHARS,
  minObservationDays: PROPOSED_MIN_OBSERVATION_DAYS,
});

export function proposedRules(): PerformanceRules {
  return { ...PROPOSED_RULES };
}

function intIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Valida regras vindas da tela. Devolve a primeira mensagem de erro, em pt-BR. */
export function validateRules(rules: PerformanceRules): string | null {
  if (!rules.ruleSetId?.trim() || rules.ruleSetId.trim().length > 60) return "Informe um identificador para o conjunto de regras.";
  if (!intIn(rules.minValidAnswers, 1, 4)) return "O mínimo de respostas válidas por pilar vai de 1 a 4.";
  if (!intIn(rules.nineBoxLowCut, 100, 400) || !intIn(rules.nineBoxHighCut, 100, 400)) return "Os cortes da Nine-Box ficam entre 1,00 e 4,00.";
  if (rules.nineBoxLowCut >= rules.nineBoxHighCut) return "O corte baixo precisa ser menor que o corte alto.";
  if (!intIn(rules.cultureConsistentCut, 100, 400)) return "O corte de cultura fica entre 1,00 e 4,00.";
  if (!intIn(rules.divergenceThreshold, 1, 3)) return "A divergência vai de 1 a 3 pontos.";
  if (typeof rules.requireExtremeEvidence !== "boolean") return "Diga se as notas 1 e 4 pedem exemplo.";
  if (!intIn(rules.evidenceMinChars, 0, 200)) return "O tamanho mínimo do exemplo vai de 0 a 200 caracteres.";
  if (!intIn(rules.minObservationDays, 0, 365)) return "O período mínimo de observação vai de 0 a 365 dias.";
  return null;
}

/** Lê regras de um JSON vindo da API. Campos ausentes herdam da proposta. */
export function parseRules(raw: unknown, base: PerformanceRules = PROPOSED_RULES): PerformanceRules {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pickInt = (key: keyof PerformanceRules) => {
    const value = source[key];
    return typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : (base[key] as number);
  };
  return {
    ruleSetId: typeof source.ruleSetId === "string" ? source.ruleSetId.trim() : base.ruleSetId,
    minValidAnswers: pickInt("minValidAnswers"),
    nineBoxLowCut: pickInt("nineBoxLowCut"),
    nineBoxHighCut: pickInt("nineBoxHighCut"),
    cultureConsistentCut: pickInt("cultureConsistentCut"),
    divergenceThreshold: pickInt("divergenceThreshold"),
    requireExtremeEvidence: typeof source.requireExtremeEvidence === "boolean" ? source.requireExtremeEvidence : base.requireExtremeEvidence,
    evidenceMinChars: pickInt("evidenceMinChars"),
    minObservationDays: pickInt("minObservationDays"),
  };
}

export function formatCut(cents: number): string {
  const whole = Math.floor(cents / 100);
  return `${whole},${String(cents % 100).padStart(2, "0")}`;
}

export const QUESTIONS_PER_PILLAR = 4;
export const BASE_QUESTION_COUNT = 12;

export type ProposedQuestion = {
  code: string;
  pillar: Pillar;
  competency: string;
  sortOrder: number;
  selfText: string;
  leaderText: string;
  /** Comportamento observável e exemplos (proposta). Valores culturais ficam aqui, versionados. */
  description: string;
  positiveExample: string;
  negativeExample: string;
  proposal: true;
};

/** Comportamento observável e exemplos propostos, um por competência. Não são critérios de punição. */
const PROPOSED_BEHAVIOR: Record<string, [string, string, string]> = {
  "DT-01": ["Entrega no padrão de qualidade do posto, sem retrabalho evitável.", "Confere a peça antes de passar adiante.", "Libera peça com defeito visível."],
  "DT-02": ["Cumpre o que foi combinado para o turno, no ritmo do posto.", "Fecha o lote no horário combinado.", "Deixa a tarefa parada sem avisar."],
  "DT-03": ["Usa máquinas, ferramentas e instruções da função corretamente.", "Ajusta a máquina seguindo a instrução de trabalho.", "Precisa de ajuda sempre na mesma tarefa já treinada."],
  "DT-04": ["Segue as regras de segurança e cuida do posto e do material.", "Usa o EPI e deixa o posto organizado.", "Retira proteção da máquina para ganhar tempo."],
  "CU-01": ["Trata colegas, líderes e clientes com respeito, inclusive ao discordar.", "Discorda sem levantar a voz.", "Faz piada que expõe um colega."],
  "CU-02": ["Passa a informação que o outro precisa para trabalhar.", "Avisa o próximo turno sobre a máquina com problema.", "Esconde um problema até ele aparecer."],
  "CU-03": ["Ajuda quando o trabalho do setor precisa, sem largar a própria tarefa.", "Ajuda a recuperar o atraso de outro posto.", "Recusa ajuda quando a linha está parada."],
  "CU-04": ["Conta o que aconteceu, inclusive quando o erro é seu.", "Avisa que trocou o material por engano.", "Culpa outra pessoa pelo próprio erro."],
  "PO-01": ["Aprende tarefas novas e passa a fazê-las sozinho.", "Depois do treino, opera a nova máquina sem ajuda.", "Continua dependente de ajuda na tarefa já ensinada."],
  "PO-02": ["Propõe melhorias para problemas que se repetem.", "Sugere um gabarito para evitar o mesmo erro.", "Vê o mesmo problema toda semana e não comenta."],
  "PO-03": ["Mantém o desempenho quando a rotina, o posto ou a tarefa mudam.", "Muda de posto e mantém a qualidade.", "Para de produzir quando o plano muda."],
  "PO-04": ["Busca aprender e crescer, além do que é pedido.", "Pede para aprender outra função do setor.", "Recusa treinamento oferecido sem motivo."],
};

/**
 * Modelo inicial (proposta): quatro competências por pilar, uma ideia por pergunta,
 * frase curta em segunda pessoa para a pessoa e em terceira pessoa para o líder.
 * O RH edita no rascunho antes de qualquer ciclo real.
 */
export const PROPOSED_BASE_QUESTIONS: readonly ProposedQuestion[] = [
  q("DT-01", "TECHNICAL", "Qualidade", 1, "Eu faço o meu trabalho com a qualidade pedida, sem precisar refazer.", "Faz o trabalho com a qualidade pedida, sem precisar refazer."),
  q("DT-02", "TECHNICAL", "Produtividade", 2, "Eu termino as minhas tarefas no tempo combinado.", "Termina as tarefas no tempo combinado."),
  q("DT-03", "TECHNICAL", "Conhecimento técnico", 3, "Eu sei usar as máquinas, ferramentas e instruções da minha função.", "Sabe usar as máquinas, ferramentas e instruções da função."),
  q("DT-04", "TECHNICAL", "Responsabilidade operacional", 4, "Eu sigo as regras de segurança e cuido do meu posto de trabalho.", "Segue as regras de segurança e cuida do posto de trabalho."),
  q("CU-01", "CULTURE", "Respeito", 5, "Eu trato as pessoas com respeito, mesmo quando discordo.", "Trata as pessoas com respeito, mesmo quando discorda."),
  q("CU-02", "CULTURE", "Comunicação", 6, "Eu aviso o líder ou o colega quando algo dá errado.", "Avisa o líder ou o colega quando algo dá errado."),
  q("CU-03", "CULTURE", "Cooperação", 7, "Eu ajudo os colegas quando o trabalho do setor precisa.", "Ajuda os colegas quando o trabalho do setor precisa."),
  q("CU-04", "CULTURE", "Honestidade e responsabilidade", 8, "Eu conto a verdade sobre o que aconteceu, mesmo quando o erro é meu.", "Conta a verdade sobre o que aconteceu, mesmo quando o erro é dele ou dela."),
  q("PO-01", "POTENTIAL", "Aprendizado", 9, "Eu consigo fazer sozinho uma tarefa nova depois que me ensinam.", "Consegue fazer sozinho uma tarefa nova depois que ensinam."),
  q("PO-02", "POTENTIAL", "Iniciativa", 10, "Eu dou ideias para melhorar o trabalho do setor.", "Dá ideias para melhorar o trabalho do setor."),
  q("PO-03", "POTENTIAL", "Adaptação", 11, "Eu continuo trabalhando bem quando a rotina ou a tarefa muda.", "Continua trabalhando bem quando a rotina ou a tarefa muda."),
  q("PO-04", "POTENTIAL", "Desenvolvimento", 12, "Eu procuro aprender coisas novas para crescer no trabalho.", "Procura aprender coisas novas para crescer no trabalho."),
];

export const PROPOSED_MODEL_INSTRUCTIONS =
  "Pense nos últimos seis meses de trabalho. Marque com que frequência isso acontece. Se você não viu ou não teve oportunidade, escolha “Não sei responder”.";

function q(code: string, pillar: Pillar, competency: string, sortOrder: number, selfText: string, leaderText: string): ProposedQuestion {
  const [description, positiveExample, negativeExample] = PROPOSED_BEHAVIOR[code] ?? ["", "", ""];
  return { code, pillar, competency, sortOrder, selfText, leaderText, description, positiveExample, negativeExample, proposal: true };
}

/** Limites dos exemplos por cargo (RFC-008). */
export const ROLE_EXAMPLES_MAX = 12;

export type AnswerInput =
  | { kind: "pending" }
  | { kind: "score"; score: FrequencyScore; evidence?: string | null }
  | { kind: "notObserved"; evidence?: string | null };

export function isFrequencyScore(value: unknown): value is FrequencyScore {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** Limite de texto livre gravado por resposta. Evita armazenar mais do que o necessário. */
export const EVIDENCE_MAX_CHARS = 600;

export function parseAnswer(raw: unknown): AnswerInput | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { kind?: unknown }).kind;
  const evidenceRaw = (raw as { evidence?: unknown }).evidence;
  const evidence = typeof evidenceRaw === "string" ? evidenceRaw.slice(0, EVIDENCE_MAX_CHARS) : null;
  if (kind === "pending") return { kind: "pending" };
  if (kind === "notObserved") return { kind: "notObserved", evidence };
  if (kind === "score") {
    const score = (raw as { score?: unknown }).score;
    if (!isFrequencyScore(score)) return null;
    return { kind: "score", score, evidence };
  }
  return null;
}

export function evidenceRequired(kind: AssignmentKind, answer: AnswerInput, rules: PerformanceRules = PROPOSED_RULES): boolean {
  return rules.requireExtremeEvidence && kind === "LEADER" && answer.kind === "score" && (answer.score === 1 || answer.score === 4);
}

export function evidenceSatisfied(kind: AssignmentKind, answer: AnswerInput, rules: PerformanceRules = PROPOSED_RULES): boolean {
  if (!evidenceRequired(kind, answer, rules)) return true;
  if (answer.kind !== "score") return true;
  return (answer.evidence ?? "").trim().length >= Math.max(1, rules.evidenceMinChars);
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
  /** Origem do líder (hierarquia efetiva). Sem valor = gestor do cadastro. */
  managerSource?: ParticipantManagerSource;
  /** Por que não há líder (ou alerta), em texto para o RH. */
  managerNote?: string | null;
  admissionDate: Date | null;
  terminationDate: Date | null;
  registration: string | null;
};

/** CADASTRO = gestor da ficha; ORGANOGRAMA = líder da unidade pela hierarquia; RH = exceção justificada. */
export type ParticipantManagerSource = "CADASTRO" | "ORGANOGRAMA" | "RH";

export const MANAGER_SOURCE_TEXT: Record<ParticipantManagerSource, string> = {
  CADASTRO: "Gestor do cadastro",
  ORGANOGRAMA: "Organograma",
  RH: "Exceção do RH",
};

export type EligibilityInput = {
  employee: Pick<EmployeeSnapshotSource, "status" | "admissionDate" | "terminationDate">;
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
  const terminated = input.employee.terminationDate != null || status === "INACTIVE" || status === "TERMINATED" || status === "DESLIGADO";
  if (terminated) {
    return { state: "NOT_ELIGIBLE", reason: "Vínculo inativo ou desligado. Exceção não reabre convite." };
  }
  const exception = input.exceptionReason?.trim() ?? "";
  if (exception.length > 0) {
    return { state: "ELIGIBLE", reason: `Exceção de RH: ${exception}` };
  }
  if (status !== "ACTIVE") {
    return { state: "INSUFFICIENT_EVIDENCE", reason: "Situação do cadastro diferente de ativo. Exige leitura do RH." };
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
    return { state: "INSUFFICIENT_EVIDENCE", reason: "Mudança de função ou setor no período. Exige leitura do RH." };
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

export function forwardStatus(from: CycleStatus): CycleStatus | null {
  return FORWARD[from];
}

export function reversalStatus(from: CycleStatus): CycleStatus | null {
  return REVERSAL[from];
}

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
  notObserved: number;
  insufficient: boolean;
  display: string | null;
};

export function aggregatePillar(answers: readonly StoredAnswer[], pillar: Pillar, minValid: number): PillarMath {
  let sum = 0;
  let count = 0;
  let notObserved = 0;
  for (const answer of answers) {
    if (answer.pillar !== pillar) continue;
    if (answer.kind === "score" && answer.score != null) {
      sum += answer.score;
      count += 1;
    } else if (answer.kind === "notObserved") {
      notObserved += 1;
    }
  }
  return {
    sum,
    count,
    notObserved,
    insufficient: count < minValid,
    display: formatPillarMean(sum, count),
  };
}

export type CultureBand = "CONSISTENT" | "DEVELOPING" | "NEEDS_REVIEW" | "INSUFFICIENT";

export const CULTURE_BAND_LABELS: Record<CultureBand, string> = {
  CONSISTENT: "Comportamento consistente",
  DEVELOPING: "Em desenvolvimento",
  NEEDS_REVIEW: "Pede conversa",
  INSUFFICIENT: "Evidência insuficiente",
};

export function cultureBand(answers: readonly StoredAnswer[], rules: PerformanceRules | number = PROPOSED_RULES): {
  band: CultureBand;
  ruleId: string;
  homologated: false;
  basis: string;
} {
  const effective = typeof rules === "number" ? { ...PROPOSED_RULES, minValidAnswers: rules } : rules;
  const math = aggregatePillar(answers, "CULTURE", effective.minValidAnswers);
  if (math.insufficient) {
    return {
      band: "INSUFFICIENT",
      ruleId: PROPOSED_CULTURE_RULE_ID,
      homologated: false,
      basis: "Menos respostas válidas que o mínimo proposto. Sem classificação cultural. Ausência de ocorrência não prova aderência.",
    };
  }
  const hasNever = answers.some((a) => a.pillar === "CULTURE" && a.kind === "score" && a.score === 1);
  if (hasNever) {
    return {
      band: "NEEDS_REVIEW",
      ruleId: PROPOSED_CULTURE_RULE_ID,
      homologated: false,
      basis: "Há frequência 1 em cultura. Sinal para conversa com fatos, sem punição automática.",
    };
  }
  if (meanAtLeast(math.sum, math.count, effective.cultureConsistentCut, 100)) {
    return {
      band: "CONSISTENT",
      ruleId: PROPOSED_CULTURE_RULE_ID,
      homologated: false,
      basis: `Média proposta ≥ ${formatCut(effective.cultureConsistentCut)}, sem arredondar o corte.`,
    };
  }
  return {
    band: "DEVELOPING",
    ruleId: PROPOSED_CULTURE_RULE_ID,
    homologated: false,
    basis: `Média abaixo de ${formatCut(effective.cultureConsistentCut)} na proposta. Não altera a Nine-Box.`,
  };
}

export type NineBoxBand = "LOW" | "MID" | "HIGH";
export const NINE_BOX_BANDS: readonly NineBoxBand[] = ["LOW", "MID", "HIGH"];
export const NINE_BOX_BAND_LABELS: Record<NineBoxBand, string> = { LOW: "baixo", MID: "médio", HIGH: "alto" };

export function isNineBoxBand(value: unknown): value is NineBoxBand {
  return value === "LOW" || value === "MID" || value === "HIGH";
}

export function nineBoxBand(sum: number, count: number, rules: PerformanceRules = PROPOSED_RULES): NineBoxBand {
  if (meanBelow(sum, count, rules.nineBoxLowCut, 100)) return "LOW";
  if (meanAtLeast(sum, count, rules.nineBoxHighCut, 100)) return "HIGH";
  return "MID";
}

export type TechnicalValidation = "INSUFFICIENT" | "PENDING_VALIDATION" | "VALIDATED";

export const TECHNICAL_VALIDATION_LABELS: Record<TechnicalValidation, string> = {
  INSUFFICIENT: "Evidência insuficiente",
  PENDING_VALIDATION: "Aguardando validação",
  VALIDATED: "Validado",
};

export type NineBoxPlacement = {
  quadrant: string;
  x: NineBoxBand | null;
  y: NineBoxBand | null;
  official: false;
  ruleId: string;
  reason: string;
};

export const UNCLASSIFIED_QUADRANT = "SEM_CLASSIFICACAO";

export function quadrantLabel(x: NineBoxBand, y: NineBoxBand): string {
  return `Desempenho ${NINE_BOX_BAND_LABELS[x]} · Potencial ${NINE_BOX_BAND_LABELS[y]}`;
}

export function placeNineBox(input: {
  technical: PillarMath;
  potential: PillarMath;
  technicalValidation: TechnicalValidation;
  rules?: PerformanceRules;
}): NineBoxPlacement {
  const rules = input.rules ?? PROPOSED_RULES;
  if (input.technical.insufficient || input.technicalValidation === "INSUFFICIENT") {
    return unclassified("Evidência técnica insuficiente. Ninguém é empurrado para um quadrante.");
  }
  if (input.technicalValidation !== "VALIDATED") {
    return unclassified("Desempenho técnico ainda não validado com a função. Resultado preliminar sem quadrante.");
  }
  if (input.potential.insufficient) {
    return unclassified("Evidência de potencial insuficiente. Sem classificação.");
  }
  const x = nineBoxBand(input.technical.sum, input.technical.count, rules);
  const y = nineBoxBand(input.potential.sum, input.potential.count, rules);
  return {
    quadrant: quadrantLabel(x, y),
    x,
    y,
    official: false,
    ruleId: PROPOSED_NINE_BOX_RULE_ID,
    reason: `Posição preliminar. Cortes ${formatCut(rules.nineBoxLowCut)} e ${formatCut(rules.nineBoxHighCut)} são proposta e não estão homologados.`,
  };
}

function unclassified(reason: string): NineBoxPlacement {
  return { quadrant: UNCLASSIFIED_QUADRANT, x: null, y: null, official: false, ruleId: PROPOSED_NINE_BOX_RULE_ID, reason };
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

/** Data de calendário AAAA-MM-DD válida. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatDateBr(value: string | null | undefined): string {
  if (!value) return "—";
  const day = value.slice(0, 10);
  if (!isIsoDate(day)) return value;
  const [year, month, dd] = day.split("-");
  return `${dd}/${month}/${year}`;
}

/** Menos pessoas que isso num recorte da Nine-Box: alerta de baixa amostra. */
export const LOW_SAMPLE_THRESHOLD = 5;
