/**
 * Metas (OKR) — contratos client-safe + parse tipado (padrão da casa, sem Zod).
 * Nenhum I/O aqui; o service é quem toca o banco.
 */

export const GOAL_STATUSES = ["DRAFT", "ACTIVE", "DONE", "ARCHIVED"] as const;
export type GoalStatusValue = (typeof GOAL_STATUSES)[number];

export const GOAL_TRACKING_TYPES = ["INCREASE", "DECREASE"] as const;
export type GoalTrackingTypeValue = (typeof GOAL_TRACKING_TYPES)[number];

export const GOAL_DOMAINS = [
  "COMERCIAL",
  "PRODUCAO",
  "FINANCEIRO",
  "SUPRIMENTOS",
  "PESSOAS",
  "OUTROS",
] as const;
export type GoalDomainValue = (typeof GOAL_DOMAINS)[number];

export const GOAL_STATUS_LABELS: Record<GoalStatusValue, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativo",
  DONE: "Concluído",
  ARCHIVED: "Arquivado",
};

export const GOAL_DOMAIN_LABELS: Record<GoalDomainValue, string> = {
  COMERCIAL: "Comercial",
  PRODUCAO: "Produção",
  FINANCEIRO: "Financeiro",
  SUPRIMENTOS: "Suprimentos",
  PESSOAS: "Pessoas",
  OUTROS: "Outros",
};

export const GOAL_TRACKING_TYPE_LABELS: Record<GoalTrackingTypeValue, string> = {
  INCREASE: "Aumento (maior é melhor)",
  DECREASE: "Redução (menor é melhor)",
};

export class GoalContractError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly field: string | null;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "GoalContractError";
    this.field = field ?? null;
  }
}

// ─── Coerência direção × base/alvo ──────────────────────────────────────────

/**
 * Problema de configuração de um alvo:
 *  - NO_INTERVAL: alvo == base (meta sem intervalo de progresso);
 *  - DIRECTION_MISMATCH: INCREASE com alvo abaixo da base, ou DECREASE com
 *    alvo acima — a fórmula "funcionaria" pelo sinal do span, mas o progresso
 *    exibido premiaria o movimento CONTRÁRIO ao que a direção promete.
 */
export type GoalTargetConfigurationIssue = "NO_INTERVAL" | "DIRECTION_MISMATCH";

export function classifyGoalTargetConfiguration(
  trackingType: GoalTrackingTypeValue,
  baseline: string | number,
  target: string | number
): GoalTargetConfigurationIssue | null {
  const base = Number(baseline);
  const goal = Number(target);
  if (!Number.isFinite(base) || !Number.isFinite(goal)) return null;
  if (goal === base) return "NO_INTERVAL";
  if (trackingType === "INCREASE" && goal < base) return "DIRECTION_MISMATCH";
  if (trackingType === "DECREASE" && goal > base) return "DIRECTION_MISMATCH";
  return null;
}

/**
 * Invariante obrigatória de cadastro/edição: INCREASE exige alvo > base;
 * DECREASE exige alvo < base; alvo == base continua inválido. Vale para alvo
 * digitado E para alvo apurado por comparação (valide DEPOIS de calcular).
 */
export function assertGoalTargetDirection(
  trackingType: GoalTrackingTypeValue,
  baseline: string | number,
  target: string | number
): void {
  const issue = classifyGoalTargetConfiguration(trackingType, baseline, target);
  if (issue === "NO_INTERVAL") {
    throw new GoalContractError(
      "Alvo não pode ser igual à linha de base (meta sem intervalo).",
      "target"
    );
  }
  if (issue === "DIRECTION_MISMATCH") {
    throw new GoalContractError(
      trackingType === "INCREASE"
        ? `Meta de AUMENTO exige alvo maior que a linha de base (base ${baseline}, alvo ${target}). Aumente o alvo ou troque a direção para redução.`
        : `Meta de REDUÇÃO exige alvo menor que a linha de base (base ${baseline}, alvo ${target}). Diminua o alvo ou troque a direção para aumento.`,
      "target"
    );
  }
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

/** Procedência de um alvo derivado de período anterior (somente leitura). */
export type GoalTargetComparisonDto = {
  mode: GoalTargetComparisonModeValue;
  modeLabel: string;
  startDate: string;
  endDate: string;
  /** Valor apurado na janela, congelado no cadastro. */
  value: string;
  percent: string;
  computedAt: string | null;
};

export type GoalKeyResultDto = {
  id: string;
  goalId: string;
  title: string;
  domain: GoalDomainValue;
  trackingType: GoalTrackingTypeValue;
  baseline: string;
  target: string;
  achievedValue: string;
  unit: string | null;
  weight: string;
  ownerAppUserId: string;
  ownerName: string | null;
  manualTracking: boolean;
  status: GoalStatusValue;
  /** 0..100 derivado — somente leitura. */
  progressPercent: number;
  /** Configuração inválida (sem intervalo OU direção incompatível). */
  invalidTargets: boolean;
  /**
   * Qual problema de configuração existe — null quando coerente. Registros
   * legados inconsistentes NÃO são corrigidos automaticamente: aparecem
   * sinalizados aqui e ficam fora do roll-up do Objetivo.
   */
  configurationIssue: GoalTargetConfigurationIssue | null;
  /**
   * true quando o indicador automático acabou de ser criado mas a PRIMEIRA
   * leitura do motor falhou — o valor exibido é a linha de base, não uma
   * medição confirmada. Transitório (só na resposta da criação).
   */
  firstMeasurementFailed?: boolean;
  /** true quando o valor é calculado pelo motor (regra dinâmica). */
  hasRule: boolean;
  /** Período PRÓPRIO do indicador (null = herda o período do Objetivo). */
  startDate: string | null;
  endDate: string | null;
  /** Janela realmente medida (interseção com o período do Objetivo). */
  effectiveStartDate: string;
  effectiveEndDate: string;
  /** true quando o indicador tem recorte próprio (≠ período do Objetivo). */
  hasOwnPeriod: boolean;
  /** Origem do alvo: número digitado (padrão) ou comparação com período. */
  targetBasis: GoalTargetBasisValue;
  /** Procedência do alvo comparado — só preenchido em COMPARISON. */
  comparison: GoalTargetComparisonDto | null;
  /** Frase leiga da regra ("Soma de Valor total vendido em Pedidos de Venda"). */
  ruleSummary: string | null;
  /** Desdobramento nominal por pessoa (US-04). */
  quotas: GoalQuotaDto[];
  updatedAt: string;
};

export type GoalDto = {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  status: GoalStatusValue;
  ownerAppUserId: string;
  ownerName: string | null;
  /** 0..100 derivado do roll-up ponderado — somente leitura (RN-001). */
  progressPercent: number;
  activeKeyResults: number;
  invalidKeyResults: number;
  keyResults: GoalKeyResultDto[];
  /** Planos de ação do Objetivo e dos seus KRs (kanban — US-05). */
  initiatives: GoalInitiativeDto[];
  /**
   * true quando a meta nasceu do wizard mas a PRIMEIRA leitura automática
   * falhou — o indicador existe e será medido pelo recálculo; o número atual
   * não é uma medição confirmada. Transitório (só na resposta da criação).
   */
  firstMeasurementFailed?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GoalSnapshotDto = {
  snapshotDate: string;
  achievedValue: string;
  progressRatio: string;
  source: string;
};

/** Um mês da curva acumulada do indicador. */
export type GoalSeriesPointDto = {
  /** Mês civil "YYYY-MM". */
  month: string;
  /** Último dia do mês dentro da janela — posiciona o ponto no eixo X. */
  civilDate: string;
  /** Acumulado do início da janela até o fim deste mês. */
  accumulated: string;
};

/**
 * Curvas do Detalhe da Meta, calculadas SOB DEMANDA a partir da mesma regra do
 * indicador (não dos snapshots): o acumulado mês a mês da janela medida e,
 * quando o alvo nasce de comparação com período anterior, a mesma curva na
 * janela comparada ("evolução do ano passado").
 *
 * Por que não usar snapshot aqui: snapshot é retrato diário a partir do
 * cadastro da meta — uma meta criada em agosto não teria curva de janeiro a
 * julho. A regra, sim, sabe responder o passado inteiro.
 */
export type GoalKeyResultSeriesDto = {
  keyResultId: string;
  /** Janela medida do indicador. */
  startDate: string;
  endDate: string;
  /** Acumulado mês a mês, do início da janela até o mês corrente. */
  current: GoalSeriesPointDto[];
  /** Mesma regra na janela de comparação; null quando o alvo não é comparado. */
  comparison: {
    startDate: string;
    endDate: string;
    /** Rótulo pt-BR do modo ("Mesmo período do ano passado", etc). */
    label: string;
    points: GoalSeriesPointDto[];
  } | null;
};

// ─── Duplicidade de indicador ───────────────────────────────────────────────

/**
 * Assinatura de um indicador dentro do objetivo — o que precisa coincidir para
 * ele ser considerado o MESMO indicador, e não um irmão legítimo.
 *
 * Título igual sozinho não basta: "Quantidade de pedidos" da Koppetel e da
 * Lazarios são dois indicadores válidos com o mesmo nome e regras diferentes.
 * Duplicata é quando título, tipo de acompanhamento, base, alvo, unidade E
 * medição são idênticos — aí não há como o usuário distinguir os dois na tela,
 * nem motivo para os dois existirem.
 */
export type GoalKeyResultSignature = {
  title: string;
  trackingType: string;
  baseline: string;
  target: string;
  unit: string | null;
  /** Regra normalizada do motor, ou null/undefined para lançamento manual. */
  ruleJson: unknown;
};

function normalizeSignatureTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

function normalizeSignatureNumber(value: string): string {
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? String(parsed) : String(value).trim();
}

/**
 * JSON estável: jsonb do Postgres não preserva a ordem das chaves, então a
 * regra lida do banco pode voltar com as chaves em outra ordem que a recém
 * normalizada. Sem ordenar, duas regras idênticas pareceriam diferentes.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function goalKeyResultSignatureKey(kr: GoalKeyResultSignature): string {
  return [
    normalizeSignatureTitle(kr.title),
    kr.trackingType,
    normalizeSignatureNumber(kr.baseline),
    normalizeSignatureNumber(kr.target),
    (kr.unit ?? "").trim().toLocaleLowerCase("pt-BR"),
    kr.ruleJson == null ? "MANUAL" : stableStringify(kr.ruleJson),
  ].join("|");
}

export function isDuplicateGoalKeyResult(
  a: GoalKeyResultSignature,
  b: GoalKeyResultSignature
): boolean {
  return goalKeyResultSignatureKey(a) === goalKeyResultSignatureKey(b);
}

// ─── Parse helpers ──────────────────────────────────────────────────────────

function parseRequiredString(value: unknown, field: string, maxLen = 300): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GoalContractError(`${field} é obrigatório.`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new GoalContractError(`${field} excede ${maxLen} caracteres.`, field);
  }
  return trimmed;
}

function parseOptionalString(value: unknown, field: string, maxLen = 2000): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new GoalContractError(`${field} inválido.`, field);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) {
    throw new GoalContractError(`${field} excede ${maxLen} caracteres.`, field);
  }
  return trimmed;
}

function parseEnum<T extends string>(
  value: unknown,
  options: readonly T[],
  field: string
): T {
  if (typeof value === "string" && (options as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new GoalContractError(
    `${field} inválido — use um de: ${options.join(", ")}.`,
    field
  );
}

const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCivilDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !CIVIL_DATE_RE.test(value.trim())) {
    throw new GoalContractError(`${field} é obrigatório (YYYY-MM-DD).`, field);
  }
  return value.trim();
}

function parseOptionalCivilDate(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  return parseCivilDate(value, field);
}

/**
 * Janela realmente medida por um indicador.
 *
 * O indicador pode ter período próprio (um trimestre dentro de um objetivo
 * anual, por exemplo). Ele NUNCA mede fora do período do Objetivo: o que vale
 * é a interseção. Se a interseção for vazia — só acontece quando o período do
 * Objetivo encolhe DEPOIS de o indicador ter sido criado — o Objetivo manda,
 * porque ele é a moldura do compromisso.
 */
export function resolveGoalMeasurementWindow(args: {
  goalStartDate: string;
  goalEndDate: string;
  keyResultStartDate?: string | null;
  keyResultEndDate?: string | null;
}): { startCivilDate: string; endCivilDate: string } {
  const start =
    args.keyResultStartDate && args.keyResultStartDate > args.goalStartDate
      ? args.keyResultStartDate
      : args.goalStartDate;
  const end =
    args.keyResultEndDate && args.keyResultEndDate < args.goalEndDate
      ? args.keyResultEndDate
      : args.goalEndDate;
  if (start > end) {
    return { startCivilDate: args.goalStartDate, endCivilDate: args.goalEndDate };
  }
  return { startCivilDate: start, endCivilDate: end };
}

// ─── Alvo por comparação com período anterior ───────────────────────────────

export const GOAL_TARGET_BASES = ["MANUAL", "COMPARISON"] as const;
export type GoalTargetBasisValue = (typeof GOAL_TARGET_BASES)[number];

export const GOAL_TARGET_COMPARISON_MODES = [
  "SAME_PERIOD_LAST_YEAR",
  "PREVIOUS_PERIOD",
  "CUSTOM",
] as const;
export type GoalTargetComparisonModeValue =
  (typeof GOAL_TARGET_COMPARISON_MODES)[number];

export const GOAL_TARGET_COMPARISON_MODE_LABELS: Record<
  GoalTargetComparisonModeValue,
  string
> = {
  SAME_PERIOD_LAST_YEAR: "mesmo período do ano passado",
  PREVIOUS_PERIOD: "período imediatamente anterior",
  CUSTOM: "um período que eu escolher",
};

function daysInCivilMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Soma meses a uma data civil, grudando no último dia quando o mês é curto. */
function addCivilMonths(civilDate: string, months: number): string {
  const [y, m, d] = civilDate.split("-").map(Number) as [number, number, number];
  const totalMonths = (y * 12 + (m - 1)) + months;
  const year = Math.floor(totalMonths / 12);
  const month1 = (totalMonths % 12) + 1;
  // 29/02 → 28/02 no ano não bissexto; 31/03 → 28 ou 29/02.
  const day = Math.min(d, daysInCivilMonth(year, month1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month1)}-${pad(day)}`;
}

function civilDaysBetween(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

function addCivilDays(civilDate: string, days: number): string {
  const ms = Date.parse(`${civilDate}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Janela de comparação a partir da janela medida pelo indicador.
 *
 *  - SAME_PERIOD_LAST_YEAR: mesmas datas, um ano antes (jul-set/2026 →
 *    jul-set/2025). É o "comparar com o ano passado" do dia a dia.
 *  - PREVIOUS_PERIOD: desloca pela PRÓPRIA duração da janela — um indicador
 *    trimestral compara com o trimestre anterior, um anual com o ano anterior,
 *    sem o usuário precisar saber disso.
 *  - CUSTOM: datas informadas à mão (devolvidas como vieram).
 */
export function resolveGoalTargetComparisonWindow(args: {
  measuredStartDate: string;
  measuredEndDate: string;
  mode: GoalTargetComparisonModeValue;
  customStartDate?: string | null;
  customEndDate?: string | null;
}): { startCivilDate: string; endCivilDate: string } | null {
  if (args.mode === "CUSTOM") {
    if (!args.customStartDate || !args.customEndDate) return null;
    if (args.customEndDate < args.customStartDate) return null;
    return {
      startCivilDate: args.customStartDate,
      endCivilDate: args.customEndDate,
    };
  }
  if (args.measuredEndDate < args.measuredStartDate) return null;

  if (args.mode === "SAME_PERIOD_LAST_YEAR") {
    return {
      startCivilDate: addCivilMonths(args.measuredStartDate, -12),
      endCivilDate: addCivilMonths(args.measuredEndDate, -12),
    };
  }
  // PREVIOUS_PERIOD: a janela imediatamente anterior.
  //
  // Quando a janela cobre MESES INTEIROS (dia 1 até o último dia do mês), o
  // deslocamento é por MESES — senão "trimestre passado" viraria 31/03–30/06
  // em vez de 01/04–30/06, porque os trimestres têm quantidades de dias
  // diferentes. Fora desse caso, desloca pela duração em dias.
  const [sy, sm, sd] = args.measuredStartDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [ey, em, ed] = args.measuredEndDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const coversWholeMonths = sd === 1 && ed === daysInCivilMonth(ey, em);
  if (coversWholeMonths) {
    const months = ey * 12 + em - (sy * 12 + sm) + 1;
    const shiftedEnd = addCivilMonths(args.measuredEndDate, -months);
    const [ny, nm] = shiftedEnd.split("-").map(Number) as [number, number];
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      startCivilDate: addCivilMonths(args.measuredStartDate, -months),
      endCivilDate: `${ny}-${pad(nm)}-${pad(daysInCivilMonth(ny, nm))}`,
    };
  }
  const durationDays = civilDaysBetween(args.measuredStartDate, args.measuredEndDate);
  const endCivilDate = addCivilDays(args.measuredStartDate, -1);
  return {
    startCivilDate: addCivilDays(endCivilDate, -durationDays),
    endCivilDate,
  };
}

/**
 * Alvo = valor do período de comparação + percentual.
 *
 * O percentual é sempre lido como "a mais" em INCREASE e "a menos" em
 * DECREASE — o usuário diz "quero reduzir 10%" e o alvo cai, sem ele precisar
 * digitar número negativo.
 */
export function computeGoalTargetFromComparison(args: {
  comparisonValue: string;
  percent: string;
  trackingType: GoalTrackingTypeValue;
}): string {
  const base = Number(args.comparisonValue);
  const percent = Number(args.percent);
  if (!Number.isFinite(base) || !Number.isFinite(percent)) {
    throw new GoalContractError(
      "Valor de comparação inválido para calcular o alvo.",
      "comparisonValue"
    );
  }
  const factor =
    args.trackingType === "DECREASE" ? 1 - percent / 100 : 1 + percent / 100;
  const target = base * factor;
  // 6 casas = precisão do Decimal do banco; evita notação científica.
  return target.toFixed(6);
}

/** Decimal como string (até 6 casas); aceita number finito por conveniência. */
function parseDecimalString(value: unknown, field: string): string {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(",", ".")
        : "";
  if (!/^-?\d+(\.\d{1,6})?$/.test(raw)) {
    throw new GoalContractError(`${field} deve ser numérico (até 6 casas).`, field);
  }
  return raw;
}

function parseUuid(value: unknown, field: string): string {
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
  ) {
    return value.trim();
  }
  throw new GoalContractError(`${field} deve ser um id válido.`, field);
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

export type GoalCreateInput = {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  status: GoalStatusValue;
  ownerAppUserId: string;
};

export function parseGoalCreateInput(body: Record<string, unknown>): GoalCreateInput {
  const startDate = parseCivilDate(body.startDate, "startDate");
  const endDate = parseCivilDate(body.endDate, "endDate");
  if (endDate < startDate) {
    throw new GoalContractError("Data fim não pode ser anterior à data início.", "endDate");
  }
  const status = body.status == null
    ? "DRAFT"
    : parseEnum(body.status, GOAL_STATUSES, "status");
  if (status === "ARCHIVED") {
    throw new GoalContractError("Objetivo não pode nascer arquivado.", "status");
  }
  return {
    title: parseRequiredString(body.title, "title"),
    description: parseOptionalString(body.description, "description"),
    startDate,
    endDate,
    status,
    ownerAppUserId: parseUuid(body.ownerAppUserId, "ownerAppUserId"),
  };
}

export type GoalUpdateInput = Partial<GoalCreateInput>;

export function parseGoalUpdateInput(body: Record<string, unknown>): GoalUpdateInput {
  const out: GoalUpdateInput = {};
  if (body.title !== undefined) out.title = parseRequiredString(body.title, "title");
  if (body.description !== undefined) {
    out.description = parseOptionalString(body.description, "description");
  }
  if (body.startDate !== undefined) out.startDate = parseCivilDate(body.startDate, "startDate");
  if (body.endDate !== undefined) out.endDate = parseCivilDate(body.endDate, "endDate");
  if (out.startDate && out.endDate && out.endDate < out.startDate) {
    throw new GoalContractError("Data fim não pode ser anterior à data início.", "endDate");
  }
  if (body.status !== undefined) out.status = parseEnum(body.status, GOAL_STATUSES, "status");
  if (body.ownerAppUserId !== undefined) {
    out.ownerAppUserId = parseUuid(body.ownerAppUserId, "ownerAppUserId");
  }
  if (Object.keys(out).length === 0) {
    throw new GoalContractError("Nenhum campo para atualizar.");
  }
  return out;
}

/** Configuração do alvo comparado (o valor em si é apurado no servidor). */
export type GoalKeyResultComparisonInput = {
  mode: GoalTargetComparisonModeValue;
  /** Percentual sobre o período de comparação (30 = 30%). */
  percent: string;
  /** Datas próprias — obrigatórias apenas em CUSTOM. */
  startDate: string | null;
  endDate: string | null;
};

export function parseGoalTargetComparisonInput(
  value: unknown
): GoalKeyResultComparisonInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  const mode = parseEnum(
    raw.mode,
    GOAL_TARGET_COMPARISON_MODES,
    "comparison.mode"
  );
  const percent = parseDecimalString(raw.percent, "comparison.percent");
  const startDate = parseOptionalCivilDate(raw.startDate, "comparison.startDate");
  const endDate = parseOptionalCivilDate(raw.endDate, "comparison.endDate");
  if (mode === "CUSTOM") {
    if (!startDate || !endDate) {
      throw new GoalContractError(
        "Informe as datas do período de comparação.",
        "comparison.startDate"
      );
    }
    if (endDate < startDate) {
      throw new GoalContractError(
        "A data final da comparação não pode ser anterior à inicial.",
        "comparison.endDate"
      );
    }
  }
  return { mode, percent, startDate, endDate };
}

export type GoalKeyResultCreateInput = {
  title: string;
  domain: GoalDomainValue;
  trackingType: GoalTrackingTypeValue;
  baseline: string;
  /** null quando targetBasis=COMPARISON — o servidor apura e congela. */
  target: string | null;
  unit: string | null;
  weight: string;
  ownerAppUserId: string;
  /** Regra dinâmica (chaves do dicionário) — null = indicador de valor manual. */
  rule: unknown | null;
  /** Período próprio (null = herda o do Objetivo). */
  startDate: string | null;
  endDate: string | null;
  /** MANUAL (padrão, número digitado) ou COMPARISON (derivado de período). */
  targetBasis: GoalTargetBasisValue;
  comparison: GoalKeyResultComparisonInput | null;
};

export function parseGoalKeyResultCreateInput(
  body: Record<string, unknown>
): GoalKeyResultCreateInput {
  const baseline = parseDecimalString(body.baseline, "baseline");
  const targetBasis =
    body.targetBasis == null
      ? "MANUAL"
      : parseEnum(body.targetBasis, GOAL_TARGET_BASES, "targetBasis");
  const comparison =
    targetBasis === "COMPARISON"
      ? parseGoalTargetComparisonInput(body.comparison)
      : null;
  // Em COMPARISON o alvo é apurado no servidor; digitar número não é exigido.
  const target =
    targetBasis === "COMPARISON" ? null : parseDecimalString(body.target, "target");
  const trackingType = parseEnum(body.trackingType, GOAL_TRACKING_TYPES, "trackingType");
  // Alvo digitado valida direção já aqui; alvo COMPARISON é validado no
  // servidor DEPOIS de apurado (mesma invariante, mesmo helper).
  if (target != null) {
    assertGoalTargetDirection(trackingType, baseline, target);
  }
  const weight =
    body.weight == null || body.weight === ""
      ? "1"
      : parseDecimalString(body.weight, "weight");
  if (Number(weight) <= 0) {
    throw new GoalContractError("Peso deve ser maior que zero.", "weight");
  }
  const startDate = parseOptionalCivilDate(body.startDate, "startDate");
  const endDate = parseOptionalCivilDate(body.endDate, "endDate");
  if (startDate && endDate && endDate < startDate) {
    throw new GoalContractError(
      "A data final do indicador não pode ser anterior à inicial.",
      "endDate"
    );
  }
  return {
    title: parseRequiredString(body.title, "title"),
    domain: parseEnum(body.domain, GOAL_DOMAINS, "domain"),
    trackingType,
    baseline,
    target,
    unit: parseOptionalString(body.unit, "unit", 30),
    weight,
    ownerAppUserId: parseUuid(body.ownerAppUserId, "ownerAppUserId"),
    rule: body.rule ?? null,
    startDate,
    endDate,
    targetBasis,
    comparison,
  };
}

export type GoalKeyResultUpdateInput = Partial<
  GoalKeyResultCreateInput & { status: GoalStatusValue }
>;

export function parseGoalKeyResultUpdateInput(
  body: Record<string, unknown>
): GoalKeyResultUpdateInput {
  const out: GoalKeyResultUpdateInput = {};
  if (body.title !== undefined) out.title = parseRequiredString(body.title, "title");
  if (body.domain !== undefined) out.domain = parseEnum(body.domain, GOAL_DOMAINS, "domain");
  if (body.trackingType !== undefined) {
    out.trackingType = parseEnum(body.trackingType, GOAL_TRACKING_TYPES, "trackingType");
  }
  if (body.baseline !== undefined) out.baseline = parseDecimalString(body.baseline, "baseline");
  if (body.target !== undefined) out.target = parseDecimalString(body.target, "target");
  // Com os três campos no payload a direção é validada já aqui; em updates
  // parciais o service revalida com os valores finais (atuais + novos).
  if (out.baseline !== undefined && out.target != null) {
    if (out.trackingType !== undefined) {
      assertGoalTargetDirection(out.trackingType, out.baseline, out.target);
    } else if (Number(out.baseline) === Number(out.target)) {
      throw new GoalContractError(
        "Alvo não pode ser igual à linha de base (meta sem intervalo).",
        "target"
      );
    }
  }
  if (body.unit !== undefined) out.unit = parseOptionalString(body.unit, "unit", 30);
  if (body.weight !== undefined) {
    const weight = parseDecimalString(body.weight, "weight");
    if (Number(weight) <= 0) {
      throw new GoalContractError("Peso deve ser maior que zero.", "weight");
    }
    out.weight = weight;
  }
  if (body.status !== undefined) out.status = parseEnum(body.status, GOAL_STATUSES, "status");
  if (body.ownerAppUserId !== undefined) {
    out.ownerAppUserId = parseUuid(body.ownerAppUserId, "ownerAppUserId");
  }
  // null limpa o período próprio (o indicador volta a herdar o do Objetivo).
  if (body.startDate !== undefined) {
    out.startDate = parseOptionalCivilDate(body.startDate, "startDate");
  }
  if (body.endDate !== undefined) {
    out.endDate = parseOptionalCivilDate(body.endDate, "endDate");
  }
  if (out.startDate && out.endDate && out.endDate < out.startDate) {
    throw new GoalContractError(
      "A data final do indicador não pode ser anterior à inicial.",
      "endDate"
    );
  }
  // Alvo comparado: trocar de modo é permitido nos dois sentidos. Voltar para
  // MANUAL exige o número digitado; ir para COMPARISON exige a configuração.
  if (body.targetBasis !== undefined) {
    out.targetBasis = parseEnum(body.targetBasis, GOAL_TARGET_BASES, "targetBasis");
    if (out.targetBasis === "COMPARISON") {
      out.comparison = parseGoalTargetComparisonInput(body.comparison);
      out.target = null;
    } else {
      out.comparison = null;
      if (body.target === undefined) {
        throw new GoalContractError(
          "Informe o alvo ao voltar para número digitado.",
          "target"
        );
      }
    }
  } else if (body.comparison !== undefined && body.comparison !== null) {
    // Recalcular/ajustar a comparação sem trocar o modo.
    out.comparison = parseGoalTargetComparisonInput(body.comparison);
    out.targetBasis = "COMPARISON";
    out.target = null;
  }
  if (Object.keys(out).length === 0) {
    throw new GoalContractError("Nenhum campo para atualizar.");
  }
  return out;
}

export type GoalAchievedValueInput = {
  achievedValue: string;
};

export function parseGoalAchievedValueInput(
  body: Record<string, unknown>
): GoalAchievedValueInput {
  return { achievedValue: parseDecimalString(body.achievedValue, "achievedValue") };
}

// ─── Quotas (desdobramento RN-006 / US-04) ──────────────────────────────────

export type GoalQuotaDto = {
  id: string;
  assignedAppUserId: string;
  assigneeName: string | null;
  quotaValue: string;
};

export type GoalQuotaInput = {
  assignedAppUserId: string;
  quotaValue: string;
};

export function parseGoalQuotasInput(body: Record<string, unknown>): GoalQuotaInput[] {
  const raw = body.quotas;
  if (!Array.isArray(raw)) {
    throw new GoalContractError("Informe a lista de cotas.", "quotas");
  }
  if (raw.length > 50) {
    throw new GoalContractError("Máximo de 50 cotas por indicador.", "quotas");
  }
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const assignedAppUserId = parseUuid(
      row.assignedAppUserId,
      `quotas[${index}].assignedAppUserId`
    );
    if (seen.has(assignedAppUserId)) {
      throw new GoalContractError(
        "A mesma pessoa não pode ter duas cotas no mesmo indicador.",
        `quotas[${index}].assignedAppUserId`
      );
    }
    seen.add(assignedAppUserId);
    const quotaValue = parseDecimalString(row.quotaValue, `quotas[${index}].quotaValue`);
    if (Number(quotaValue) <= 0) {
      throw new GoalContractError(
        "Cota precisa ser maior que zero.",
        `quotas[${index}].quotaValue`
      );
    }
    return { assignedAppUserId, quotaValue };
  });
}

// ─── Iniciativas (RN-007 / US-05) ───────────────────────────────────────────

export const GOAL_INITIATIVE_STATUSES = ["TODO", "DOING", "DONE"] as const;
export type GoalInitiativeStatusValue = (typeof GOAL_INITIATIVE_STATUSES)[number];

export const GOAL_INITIATIVE_STATUS_LABELS: Record<GoalInitiativeStatusValue, string> = {
  TODO: "A fazer",
  DOING: "Fazendo",
  DONE: "Concluído",
};

export type GoalInitiativeDto = {
  id: string;
  goalId: string | null;
  keyResultId: string | null;
  title: string;
  status: GoalInitiativeStatusValue;
  assigneeAppUserId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  createdAt: string;
};

export type GoalInitiativeCreateInput = {
  goalId: string | null;
  keyResultId: string | null;
  title: string;
  assigneeAppUserId: string | null;
  dueDate: string | null;
};

export function parseGoalInitiativeCreateInput(
  body: Record<string, unknown>
): GoalInitiativeCreateInput {
  const goalId = body.goalId != null ? parseUuid(body.goalId, "goalId") : null;
  const keyResultId =
    body.keyResultId != null ? parseUuid(body.keyResultId, "keyResultId") : null;
  if (!goalId && !keyResultId) {
    throw new GoalContractError(
      "A iniciativa precisa estar ligada a um Objetivo ou a um indicador.",
      "goalId"
    );
  }
  if (goalId && keyResultId) {
    throw new GoalContractError(
      "Ligue a iniciativa ao Objetivo OU ao indicador — não aos dois.",
      "keyResultId"
    );
  }
  return {
    goalId,
    keyResultId,
    title: parseRequiredString(body.title, "title", 200),
    assigneeAppUserId:
      body.assigneeAppUserId != null && body.assigneeAppUserId !== ""
        ? parseUuid(body.assigneeAppUserId, "assigneeAppUserId")
        : null,
    dueDate:
      body.dueDate != null && body.dueDate !== ""
        ? parseCivilDate(body.dueDate, "dueDate")
        : null,
  };
}

export type GoalInitiativeUpdateInput = Partial<{
  title: string;
  status: GoalInitiativeStatusValue;
  assigneeAppUserId: string | null;
  dueDate: string | null;
}>;

export function parseGoalInitiativeUpdateInput(
  body: Record<string, unknown>
): GoalInitiativeUpdateInput {
  const out: GoalInitiativeUpdateInput = {};
  if (body.title !== undefined) out.title = parseRequiredString(body.title, "title", 200);
  if (body.status !== undefined) {
    out.status = parseEnum(body.status, GOAL_INITIATIVE_STATUSES, "status");
  }
  if (body.assigneeAppUserId !== undefined) {
    out.assigneeAppUserId =
      body.assigneeAppUserId == null || body.assigneeAppUserId === ""
        ? null
        : parseUuid(body.assigneeAppUserId, "assigneeAppUserId");
  }
  if (body.dueDate !== undefined) {
    out.dueDate =
      body.dueDate == null || body.dueDate === ""
        ? null
        : parseCivilDate(body.dueDate, "dueDate");
  }
  if (Object.keys(out).length === 0) {
    throw new GoalContractError("Nenhum campo para atualizar.");
  }
  return out;
}

// ─── Wizard (criação completa em uma transação) ─────────────────────────────

export type GoalWizardInput = {
  goal: GoalCreateInput;
  keyResult: GoalKeyResultCreateInput;
  quotas: GoalQuotaInput[];
};

export function parseGoalWizardInput(body: Record<string, unknown>): GoalWizardInput {
  const goalRaw = (body.goal ?? {}) as Record<string, unknown>;
  const krRaw = (body.keyResult ?? {}) as Record<string, unknown>;
  const goal = parseGoalCreateInput(goalRaw);
  const keyResult = parseGoalKeyResultCreateInput(krRaw);
  const quotas =
    body.quotas === undefined || body.quotas === null
      ? []
      : parseGoalQuotasInput(body);
  return { goal, keyResult, quotas };
}
