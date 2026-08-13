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

// ─── DTOs ───────────────────────────────────────────────────────────────────

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
  /** target == baseline — meta sem intervalo, sinalizada na UI. */
  invalidTargets: boolean;
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
  createdAt: string;
  updatedAt: string;
};

export type GoalSnapshotDto = {
  snapshotDate: string;
  achievedValue: string;
  progressRatio: string;
  source: string;
};

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

export type GoalKeyResultCreateInput = {
  title: string;
  domain: GoalDomainValue;
  trackingType: GoalTrackingTypeValue;
  baseline: string;
  target: string;
  unit: string | null;
  weight: string;
  ownerAppUserId: string;
  /** Regra dinâmica (chaves do dicionário) — null = indicador de valor manual. */
  rule: unknown | null;
  /** Período próprio (null = herda o do Objetivo). */
  startDate: string | null;
  endDate: string | null;
};

export function parseGoalKeyResultCreateInput(
  body: Record<string, unknown>
): GoalKeyResultCreateInput {
  const baseline = parseDecimalString(body.baseline, "baseline");
  const target = parseDecimalString(body.target, "target");
  if (Number(baseline) === Number(target)) {
    throw new GoalContractError(
      "Alvo não pode ser igual à linha de base (meta sem intervalo).",
      "target"
    );
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
    trackingType: parseEnum(body.trackingType, GOAL_TRACKING_TYPES, "trackingType"),
    baseline,
    target,
    unit: parseOptionalString(body.unit, "unit", 30),
    weight,
    ownerAppUserId: parseUuid(body.ownerAppUserId, "ownerAppUserId"),
    rule: body.rule ?? null,
    startDate,
    endDate,
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
  if (
    out.baseline !== undefined &&
    out.target !== undefined &&
    Number(out.baseline) === Number(out.target)
  ) {
    throw new GoalContractError(
      "Alvo não pode ser igual à linha de base (meta sem intervalo).",
      "target"
    );
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
