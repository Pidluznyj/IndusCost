/**
 * OP-26 — Avaliação de Pedido de Compra e Desempenho de Fornecedores.
 *
 * Motor PURO (sem Prisma / Node): fórmula, elegibilidade, validação de notas,
 * cobertura, período e DTOs. Consumido por rotas, serviço, relatório, CSV e UI —
 * ninguém recalcula a regra "do seu jeito".
 *
 * Unidade oficial de avaliação = PurchaseOrder. O fornecedor
 * (FinancialSupplier) NUNCA recebe coluna de nota: a nota do fornecedor é
 * sempre derivada das avaliações dos pedidos dele.
 *
 * A metodologia de pontuação é uma REGRA INTERNA da empresa — não é fórmula
 * prescrita pelo Inmetro nem por edição específica da ISO 9001.
 */

import type { PurchaseOrderStatusName } from "./purchaseOrderWorkflow.js";

/** Versão da metodologia persistida em cada avaliação. */
export const SUPPLIER_EVALUATION_METHODOLOGY_VERSION = 1;

/** Identificador documental da metodologia V1 (pesos iguais de 25%). */
export const SUPPLIER_EVALUATION_METHODOLOGY_ID = "SUPPLIER_ORDER_EVALUATION_V1";

export type SupplierEvaluationCriterionKey =
  | "quality"
  | "delivery"
  | "conformity"
  | "service";

export type SupplierEvaluationCriterionDef = {
  key: SupplierEvaluationCriterionKey;
  /** Campo persistido / payload da API. */
  field: "qualityScore" | "deliveryScore" | "conformityScore" | "serviceScore";
  label: string;
  shortLabel: string;
  weightPercent: 25;
};

/** MVP: quatro critérios, mesmo peso. Sem tela de configuração de pesos. */
export const SUPPLIER_EVALUATION_CRITERIA: readonly SupplierEvaluationCriterionDef[] = [
  {
    key: "quality",
    field: "qualityScore",
    label: "Qualidade do produto/material",
    shortLabel: "Qualidade",
    weightPercent: 25,
  },
  {
    key: "delivery",
    field: "deliveryScore",
    label: "Prazo de entrega",
    shortLabel: "Prazo",
    weightPercent: 25,
  },
  {
    key: "conformity",
    field: "conformityScore",
    label: "Quantidade / conformidade",
    shortLabel: "Conformidade",
    weightPercent: 25,
  },
  {
    key: "service",
    field: "serviceScore",
    label: "Atendimento / solução de problemas",
    shortLabel: "Atendimento",
    weightPercent: 25,
  },
];

export const SUPPLIER_EVALUATION_CRITERION_KEYS: readonly SupplierEvaluationCriterionKey[] =
  SUPPLIER_EVALUATION_CRITERIA.map((c) => c.key);

export type SupplierEvaluationScores = Record<SupplierEvaluationCriterionKey, number>;

/** Ações reutilizadas no PurchaseOrderHistoryEvent (sem tabela de histórico nova). */
export const SUPPLIER_EVALUATION_HISTORY_ACTIONS = {
  created: "SUPPLIER_EVALUATION_CREATED",
  revised: "SUPPLIER_EVALUATION_REVISED",
} as const;

/** Só pedido efetivamente finalizado é avaliável. CANCELADO nunca. */
export const SUPPLIER_EVALUATION_ELIGIBLE_STATUSES: readonly PurchaseOrderStatusName[] = [
  "RECEBIDO",
  "ENCERRADO",
];

export const SUPPLIER_EVALUATION_NOTES_MAX_LENGTH = 2000;
export const SUPPLIER_EVALUATION_REVISION_REASON_MAX_LENGTH = 500;
export const SUPPLIER_EVALUATION_SCORE_MIN = 0;
export const SUPPLIER_EVALUATION_SCORE_MAX = 10;

/* ------------------------------------------------------------------ *
 * Erros de domínio
 * ------------------------------------------------------------------ */

export type SupplierEvaluationErrorCode =
  | "INVALID_SUPPLIER_EVALUATION_SCORE"
  | "INVALID_SUPPLIER_EVALUATION_PAYLOAD"
  | "INVALID_SUPPLIER_PERFORMANCE_FILTER"
  | "PURCHASE_ORDER_NOT_FOUND"
  | "PURCHASE_ORDER_NOT_ELIGIBLE_FOR_SUPPLIER_EVALUATION"
  | "SUPPLIER_EVALUATION_REVISION_CONFLICT"
  | "SUPPLIER_NOT_FOUND";

const ERROR_HTTP_STATUS: Record<SupplierEvaluationErrorCode, number> = {
  INVALID_SUPPLIER_EVALUATION_SCORE: 400,
  INVALID_SUPPLIER_EVALUATION_PAYLOAD: 400,
  INVALID_SUPPLIER_PERFORMANCE_FILTER: 400,
  PURCHASE_ORDER_NOT_FOUND: 404,
  PURCHASE_ORDER_NOT_ELIGIBLE_FOR_SUPPLIER_EVALUATION: 409,
  SUPPLIER_EVALUATION_REVISION_CONFLICT: 409,
  SUPPLIER_NOT_FOUND: 404,
};

export class SupplierEvaluationError extends Error {
  readonly code: SupplierEvaluationErrorCode;
  readonly httpStatus: number;
  readonly field?: string;

  constructor(code: SupplierEvaluationErrorCode, message: string, field?: string) {
    super(message);
    this.name = "SupplierEvaluationError";
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.field = field;
  }
}

/* ------------------------------------------------------------------ *
 * Aritmética determinística (HALF-UP, sem erro binário acumulado)
 * ------------------------------------------------------------------ */

/** Arredonda HALF-UP para 2 casas. A tolerância cobre 912.4999999999999 -> 9,13. */
export function roundHalfUpToHundredths(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const rounded = frac >= 0.5 - 1e-9 ? floor + 1 : floor;
  return rounded / 100;
}

/**
 * Converte a nota do usuário (0..10, no máximo 1 casa) em décimos inteiros.
 * Aceita number ou string decimal (vírgula ou ponto) — nunca NaN/Infinity/null.
 */
export function parseSupplierEvaluationScoreToTenths(
  raw: unknown,
  criterion: SupplierEvaluationCriterionKey | string
): number {
  const label =
    SUPPLIER_EVALUATION_CRITERIA.find((c) => c.key === criterion)?.shortLabel ??
    String(criterion);

  let value: number;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new SupplierEvaluationError(
        "INVALID_SUPPLIER_EVALUATION_SCORE",
        `Nota inválida em "${label}". Informe um número de 0 a 10 com no máximo uma casa decimal.`,
        String(criterion)
      );
    }
    value = Number(trimmed);
  } else {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_SCORE",
      `Nota obrigatória em "${label}". Informe um número de 0 a 10 com no máximo uma casa decimal.`,
      String(criterion)
    );
  }

  if (!Number.isFinite(value)) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_SCORE",
      `Nota inválida em "${label}". Informe um número de 0 a 10 com no máximo uma casa decimal.`,
      String(criterion)
    );
  }
  if (value < SUPPLIER_EVALUATION_SCORE_MIN || value > SUPPLIER_EVALUATION_SCORE_MAX) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_SCORE",
      `Nota fora do intervalo em "${label}". Use valores de 0 a 10.`,
      String(criterion)
    );
  }

  const scaled = value * 10;
  const tenths = Math.round(scaled);
  if (Math.abs(scaled - tenths) > 1e-6) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_SCORE",
      `Nota com precisão inválida em "${label}". Use no máximo uma casa decimal.`,
      String(criterion)
    );
  }
  return tenths;
}

/**
 * Nota do pedido = média aritmética simples dos quatro critérios (25% cada).
 * Valor financeiro, quantidade e número de itens NÃO influenciam.
 *
 * Cálculo em inteiros: décimos -> centésimos com HALF-UP exato
 * (9,1 + 9,1 + 9,1 + 9,2 = 36,5 -> 9,125 -> 9,13).
 */
export function computeSupplierOrderOverallScoreFromTenths(
  tenths: Record<SupplierEvaluationCriterionKey, number>
): number {
  const sum = tenths.quality + tenths.delivery + tenths.conformity + tenths.service;
  const numerator = sum * 10; // centésimos x 4
  const quotient = Math.floor(numerator / 4);
  const remainder = numerator - quotient * 4;
  const hundredths = remainder * 2 >= 4 ? quotient + 1 : quotient;
  return hundredths / 100;
}

/** Valida as quatro notas e devolve notas normalizadas + nota geral do pedido. */
export function computeSupplierOrderEvaluation(input: {
  qualityScore: unknown;
  deliveryScore: unknown;
  conformityScore: unknown;
  serviceScore: unknown;
}): { scores: SupplierEvaluationScores; overallScore: number } {
  const tenths = {
    quality: parseSupplierEvaluationScoreToTenths(input.qualityScore, "quality"),
    delivery: parseSupplierEvaluationScoreToTenths(input.deliveryScore, "delivery"),
    conformity: parseSupplierEvaluationScoreToTenths(input.conformityScore, "conformity"),
    service: parseSupplierEvaluationScoreToTenths(input.serviceScore, "service"),
  };
  return {
    scores: {
      quality: tenths.quality / 10,
      delivery: tenths.delivery / 10,
      conformity: tenths.conformity / 10,
      service: tenths.service / 10,
    },
    overallScore: computeSupplierOrderOverallScoreFromTenths(tenths),
  };
}

/** Observação opcional; trim server-side e limite de tamanho. */
export function normalizeSupplierEvaluationNotes(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
      "Observações inválidas.",
      "notes"
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > SUPPLIER_EVALUATION_NOTES_MAX_LENGTH) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
      `Observações acima do limite de ${SUPPLIER_EVALUATION_NOTES_MAX_LENGTH} caracteres.`,
      "notes"
    );
  }
  return trimmed;
}

/** Motivo obrigatório em toda revisão (a versão anterior fica no histórico). */
export function normalizeSupplierEvaluationRevisionReason(raw: unknown): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
      "Informe o motivo da revisão da avaliação.",
      "revisionReason"
    );
  }
  if (trimmed.length > SUPPLIER_EVALUATION_REVISION_REASON_MAX_LENGTH) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
      `Motivo da revisão acima do limite de ${SUPPLIER_EVALUATION_REVISION_REASON_MAX_LENGTH} caracteres.`,
      "revisionReason"
    );
  }
  return trimmed;
}

/** `expectedRevision`: null/ausente = criação; inteiro >= 1 = revisão. */
export function normalizeSupplierEvaluationExpectedRevision(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
      "Versão esperada da avaliação inválida.",
      "expectedRevision"
    );
  }
  return parsed;
}

/* ------------------------------------------------------------------ *
 * Elegibilidade — regra ÚNICA (backend é autoridade)
 * ------------------------------------------------------------------ */

export function isPurchaseOrderSupplierEvaluationEligible(
  status: string | null | undefined
): boolean {
  if (!status) return false;
  return (SUPPLIER_EVALUATION_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

export type PurchaseOrderEvaluationEligibility = {
  eligible: boolean;
  eligibilityReason: string | null;
};

export function describePurchaseOrderSupplierEvaluationEligibility(
  status: string | null | undefined
): PurchaseOrderEvaluationEligibility {
  if (isPurchaseOrderSupplierEvaluationEligible(status)) {
    return { eligible: true, eligibilityReason: null };
  }
  if (status === "CANCELADO") {
    return {
      eligible: false,
      eligibilityReason: "Pedido cancelado não é elegível para avaliação de fornecedor.",
    };
  }
  return {
    eligible: false,
    eligibilityReason: "Pedido ainda não está recebido ou encerrado.",
  };
}

export function assertPurchaseOrderSupplierEvaluationEligible(
  status: string | null | undefined
): void {
  const decision = describePurchaseOrderSupplierEvaluationEligibility(status);
  if (!decision.eligible) {
    throw new SupplierEvaluationError(
      "PURCHASE_ORDER_NOT_ELIGIBLE_FOR_SUPPLIER_EVALUATION",
      decision.eligibilityReason ?? "Pedido não elegível para avaliação."
    );
  }
}

/* ------------------------------------------------------------------ *
 * Período — semântica ÚNICA (retroatividade)
 * ------------------------------------------------------------------ */

/**
 * Eixo do período é a data do PEDIDO, nunca a data da avaliação: avaliação
 * retroativa feita em setembro sobre pedido de fevereiro pertence a fevereiro.
 */
export function resolvePurchaseOrderEvaluationReferenceDate(order: {
  issuedAt: Date | string | null | undefined;
  createdAt: Date | string;
}): Date {
  const raw = order.issuedAt ?? order.createdAt;
  return raw instanceof Date ? raw : new Date(raw);
}

export const SUPPLIER_PERFORMANCE_PERIOD_PRESETS = [
  { id: "last6m", label: "Últimos 6 meses" },
  { id: "last12m", label: "Últimos 12 meses" },
  { id: "all", label: "Todos" },
  { id: "custom", label: "Personalizado" },
] as const;

export type SupplierPerformancePeriodPresetId =
  (typeof SUPPLIER_PERFORMANCE_PERIOD_PRESETS)[number]["id"];

export const SUPPLIER_PERFORMANCE_DEFAULT_PERIOD_PRESET: SupplierPerformancePeriodPresetId =
  "last12m";

const CIVIL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toCivilKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Valida `YYYY-MM-DD`; retorna null quando ausente/inválido (filtro ignorado). */
export function parseSupplierPerformanceCivilDateParam(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = CIVIL_DATE_RE.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export type SupplierPerformancePeriod = {
  from: string | null;
  to: string | null;
};

/** Janela relativa em meses a partir de "hoje" (dia civil local). */
export function buildSupplierPerformancePeriodFromPreset(
  preset: SupplierPerformancePeriodPresetId,
  today: Date = new Date()
): SupplierPerformancePeriod {
  if (preset === "all" || preset === "custom") return { from: null, to: null };
  const months = preset === "last6m" ? 6 : 12;
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = new Date(to.getFullYear(), to.getMonth() - months, to.getDate());
  return { from: toCivilKey(from), to: toCivilKey(to) };
}

export function civilKeyToLocalDate(key: string): Date {
  const match = CIVIL_DATE_RE.exec(key.trim());
  if (!match) return new Date(Number.NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

/**
 * Intervalo aplicado em `COALESCE(issuedAt, createdAt)`.
 * Dia civil local (mesma convenção dos demais filtros do repo — nunca
 * `new Date("YYYY-MM-DD")`, que desloca o dia por fuso). Fim exclusivo.
 */
export function resolveSupplierPerformanceDateRange(
  period: SupplierPerformancePeriod
): { gte: Date | null; lt: Date | null } {
  const gte = period.from ? civilKeyToLocalDate(period.from) : null;
  let lt: Date | null = null;
  if (period.to) {
    const end = civilKeyToLocalDate(period.to);
    lt = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 0, 0, 0);
  }
  return { gte, lt };
}

/* ------------------------------------------------------------------ *
 * Agregação do fornecedor — derivada, nunca gravada no cadastro
 * ------------------------------------------------------------------ */

/** Média simples com HALF-UP em 2 casas; lista vazia -> null (nunca 0). */
export function averageScoreOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) return null;
    sum += v;
  }
  return roundHalfUpToHundredths(sum / values.length);
}

export type SupplierPerformanceSummaryDto = {
  eligibleOrders: number;
  evaluatedOrders: number;
  pendingOrders: number;
  /** null quando não há pedido elegível no período (diferente de cobertura 0%). */
  coverage: number | null;
  overallScore: number | null;
  qualityScore: number | null;
  deliveryScore: number | null;
  conformityScore: number | null;
  serviceScore: number | null;
};

export type SupplierPerformanceRawAverages = {
  overall: number | null;
  quality: number | null;
  delivery: number | null;
  conformity: number | null;
  service: number | null;
};

/**
 * Cobertura e notas consolidadas.
 * - `eligibleOrders = 0` -> coverage null (sem base), notas null.
 * - `evaluatedOrders = 0` com elegíveis > 0 -> coverage 0, notas null (nunca 0).
 */
export function buildSupplierPerformanceSummary(input: {
  eligibleOrders: number;
  evaluatedOrders: number;
  averages: SupplierPerformanceRawAverages;
}): SupplierPerformanceSummaryDto {
  const eligibleOrders = Math.max(0, Math.trunc(input.eligibleOrders));
  const evaluatedOrders = Math.max(
    0,
    Math.min(eligibleOrders, Math.trunc(input.evaluatedOrders))
  );
  const pendingOrders = eligibleOrders - evaluatedOrders;
  const coverage = eligibleOrders === 0 ? null : evaluatedOrders / eligibleOrders;
  const round = (v: number | null | undefined): number | null =>
    v == null || !Number.isFinite(v) || evaluatedOrders === 0
      ? null
      : roundHalfUpToHundredths(v);

  return {
    eligibleOrders,
    evaluatedOrders,
    pendingOrders,
    coverage,
    overallScore: round(input.averages.overall),
    qualityScore: round(input.averages.quality),
    deliveryScore: round(input.averages.delivery),
    conformityScore: round(input.averages.conformity),
    serviceScore: round(input.averages.service),
  };
}

/* ------------------------------------------------------------------ *
 * Filtros / paginação
 * ------------------------------------------------------------------ */

export const SUPPLIER_PERFORMANCE_EVALUATION_STATUS_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendentes" },
  { id: "evaluated", label: "Avaliados" },
  { id: "ineligible", label: "Não elegíveis" },
] as const;

export type SupplierPerformanceEvaluationStatusFilter =
  (typeof SUPPLIER_PERFORMANCE_EVALUATION_STATUS_FILTERS)[number]["id"];

export function parseSupplierPerformanceEvaluationStatusFilter(
  raw: unknown
): SupplierPerformanceEvaluationStatusFilter {
  const value = String(Array.isArray(raw) ? raw[0] : (raw ?? "")).trim();
  const found = SUPPLIER_PERFORMANCE_EVALUATION_STATUS_FILTERS.find((f) => f.id === value);
  return found ? found.id : "all";
}

/**
 * Status do cadastro de fornecedor aceitos no filtro do relatório.
 * Espelha o enum canônico `FinancialSupplierStatus` do Prisma (o motor puro é
 * browser-safe e não pode importar @prisma/client). A paridade com o schema é
 * garantida por teste — ver supplierPerformanceSchema.test.ts.
 */
export const SUPPLIER_PERFORMANCE_SUPPLIER_STATUSES = [
  "ACTIVE",
  "NEEDS_REVIEW",
  "MERGED",
  "INACTIVE",
] as const;

export type SupplierPerformanceSupplierStatus =
  (typeof SUPPLIER_PERFORMANCE_SUPPLIER_STATUSES)[number];

export const SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT = 50;
export const SUPPLIER_PERFORMANCE_PAGE_SIZE_MAX = 200;

export function normalizeSupplierPerformancePage(raw: unknown): number {
  const parsed = Number.parseInt(String(Array.isArray(raw) ? raw[0] : (raw ?? "")), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export function normalizeSupplierPerformancePageSize(raw: unknown): number {
  const parsed = Number.parseInt(String(Array.isArray(raw) ? raw[0] : (raw ?? "")), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT;
  return Math.min(parsed, SUPPLIER_PERFORMANCE_PAGE_SIZE_MAX);
}

/* ------------------------------------------------------------------ *
 * Boundary HTTP — parsers ESTRITOS (fail-fast)
 *
 * Os parsers acima são tolerantes de propósito: servem à UI, onde um valor
 * intermediário não deve explodir a tela. A API é contrato formal: um filtro
 * enviado explicitamente e inválido NÃO pode ser ignorado em silêncio e ampliar
 * a consulta — ele vira 400. Parâmetro AUSENTE continua usando o default.
 *
 * Paginação segue normalizada/clamped (padrão do repositório): `page`/`pageSize`
 * não são filtros semânticos, e valores fora da faixa não distorcem população.
 * ------------------------------------------------------------------ */

/** Valor ausente = não informado. String vazia conta como ausente. */
function readSingleParam(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function filterError(message: string, field: string): SupplierEvaluationError {
  return new SupplierEvaluationError(
    "INVALID_SUPPLIER_PERFORMANCE_FILTER",
    message,
    field
  );
}

/** `YYYY-MM-DD` válido, ausente = null, presente e inválido = 400. */
export function parseSupplierPerformanceApiCivilDate(
  raw: unknown,
  field: "from" | "to"
): string | null {
  const text = readSingleParam(raw);
  if (text == null) return null;
  const parsed = parseSupplierPerformanceCivilDateParam(text);
  if (!parsed) {
    throw filterError(
      field === "from"
        ? "Data inicial inválida. Use o formato aaaa-mm-dd."
        : "Data final inválida. Use o formato aaaa-mm-dd.",
      field
    );
  }
  return parsed;
}

/** Período completo; `from > to` é erro explícito, nunca resultado vazio. */
export function parseSupplierPerformanceApiPeriod(query: {
  from?: unknown;
  to?: unknown;
}): SupplierPerformancePeriod {
  const from = parseSupplierPerformanceApiCivilDate(query.from, "from");
  const to = parseSupplierPerformanceApiCivilDate(query.to, "to");
  if (from && to && from > to) {
    throw filterError(
      "A data inicial não pode ser maior que a data final.",
      "period"
    );
  }
  return { from, to };
}

/** Ausente = "all"; presente e inválido = 400 (sem fallback silencioso). */
export function parseSupplierPerformanceApiEvaluationStatus(
  raw: unknown
): SupplierPerformanceEvaluationStatusFilter {
  const text = readSingleParam(raw);
  if (text == null) return "all";
  const found = SUPPLIER_PERFORMANCE_EVALUATION_STATUS_FILTERS.find(
    (f) => f.id === text
  );
  if (!found) {
    throw filterError(
      `Filtro de avaliação inválido. Use: ${SUPPLIER_PERFORMANCE_EVALUATION_STATUS_FILTERS.map(
        (f) => f.id
      ).join(", ")}.`,
      "evaluationStatus"
    );
  }
  return found.id;
}

/** Ausente = "name"; presente e inválido = 400. */
export function parseSupplierPerformanceApiSort(
  raw: unknown
): SupplierPerformanceReportSort {
  const text = readSingleParam(raw);
  if (text == null) return "name";
  if (!(SUPPLIER_PERFORMANCE_REPORT_SORTS as readonly string[]).includes(text)) {
    throw filterError(
      `Ordenação inválida. Use: ${SUPPLIER_PERFORMANCE_REPORT_SORTS.join(", ")}.`,
      "sort"
    );
  }
  return text as SupplierPerformanceReportSort;
}

/** Ausente = sem filtro (null); presente e inválido = 400. */
export function parseSupplierPerformanceApiSupplierStatus(
  raw: unknown
): SupplierPerformanceSupplierStatus | null {
  const text = readSingleParam(raw);
  if (text == null) return null;
  if (!(SUPPLIER_PERFORMANCE_SUPPLIER_STATUSES as readonly string[]).includes(text)) {
    throw filterError(
      `Status de fornecedor inválido. Use: ${SUPPLIER_PERFORMANCE_SUPPLIER_STATUSES.join(
        ", "
      )}.`,
      "supplierStatus"
    );
  }
  return text as SupplierPerformanceSupplierStatus;
}

/* ------------------------------------------------------------------ *
 * DTOs (compartilhados backend <-> frontend)
 * ------------------------------------------------------------------ */

export type SupplierEvaluationActorDto = {
  id: string | null;
  name: string | null;
};

export type PurchaseOrderSupplierEvaluationDto = {
  id: string;
  purchaseOrderId: string;
  scores: {
    quality: number;
    delivery: number;
    conformity: number;
    service: number;
    overall: number;
  };
  methodologyVersion: number;
  notes: string | null;
  revision: number;
  createdAt: string;
  createdBy: SupplierEvaluationActorDto;
  updatedAt: string;
  updatedBy: SupplierEvaluationActorDto;
};

export type PurchaseOrderSupplierEvaluationResponse = {
  purchaseOrderId: string;
  status: string;
  eligible: boolean;
  eligibilityReason: string | null;
  supplier: { id: string; name: string; document: string | null } | null;
  evaluation: PurchaseOrderSupplierEvaluationDto | null;
};

export type SupplierPerformanceOrderRowDto = {
  id: string;
  code: string;
  status: string;
  /** COALESCE(issuedAt, createdAt) em ISO — eixo canônico do período. */
  referenceDate: string;
  issuedAt: string | null;
  currency: string;
  totalAmount: number | null;
  eligible: boolean;
  eligibilityReason: string | null;
  evaluation: {
    id: string;
    overallScore: number;
    quality: number;
    delivery: number;
    conformity: number;
    service: number;
    revision: number;
    evaluatedAt: string;
    evaluatedBy: string | null;
  } | null;
};

export type SupplierPerformanceDetailResponse = {
  supplier: {
    id: string;
    name: string;
    document: string | null;
    status: string;
  };
  period: SupplierPerformancePeriod;
  summary: SupplierPerformanceSummaryDto;
  orders: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    items: SupplierPerformanceOrderRowDto[];
  };
};

export type SupplierPerformanceReportRowDto = {
  supplierId: string;
  supplierName: string;
  supplierDocument: string | null;
  supplierStatus: string;
  summary: SupplierPerformanceSummaryDto;
};

export type SupplierPerformanceReportResponse = {
  period: SupplierPerformancePeriod;
  generatedAt: string;
  methodologyVersion: number;
  totals: SupplierPerformanceSummaryDto;
  rows: SupplierPerformanceReportRowDto[];
};

/* ------------------------------------------------------------------ *
 * Ordenação do relatório
 * ------------------------------------------------------------------ */

export const SUPPLIER_PERFORMANCE_REPORT_SORTS = ["name", "score", "coverage"] as const;
export type SupplierPerformanceReportSort =
  (typeof SUPPLIER_PERFORMANCE_REPORT_SORTS)[number];

export function parseSupplierPerformanceReportSort(
  raw: unknown
): SupplierPerformanceReportSort {
  const value = String(Array.isArray(raw) ? raw[0] : (raw ?? "")).trim();
  return (SUPPLIER_PERFORMANCE_REPORT_SORTS as readonly string[]).includes(value)
    ? (value as SupplierPerformanceReportSort)
    : "name";
}

/** Ordena sem ranking gamificado: nome ASC default; nota/cobertura com null por último. */
export function sortSupplierPerformanceReportRows(
  rows: readonly SupplierPerformanceReportRowDto[],
  sort: SupplierPerformanceReportSort,
  direction: "asc" | "desc" = sort === "name" ? "asc" : "desc"
): SupplierPerformanceReportRowDto[] {
  const factor = direction === "asc" ? 1 : -1;
  const byName = (a: SupplierPerformanceReportRowDto, b: SupplierPerformanceReportRowDto) =>
    a.supplierName.localeCompare(b.supplierName, "pt-BR");

  return [...rows].sort((a, b) => {
    if (sort === "name") return byName(a, b) * factor;
    const av = sort === "score" ? a.summary.overallScore : a.summary.coverage;
    const bv = sort === "score" ? b.summary.overallScore : b.summary.coverage;
    if (av == null && bv == null) return byName(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return byName(a, b);
    return (av - bv) * factor;
  });
}

/* ------------------------------------------------------------------ *
 * Apresentação (pt-BR)
 * ------------------------------------------------------------------ */

export function formatSupplierScore(
  value: number | null | undefined,
  fractionDigits = 2
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Código ISO-4217 tem exatamente 3 letras. */
const CURRENCY_CODE_RE = /^[A-Za-z]{3}$/;

/**
 * Valor do Pedido de Compra na MOEDA DO PRÓPRIO PEDIDO.
 *
 * `PurchaseOrder.currency` pode ser BRL, USD, EUR… — presumir BRL falsifica o
 * valor exibido. Não há conversão cambial em lugar nenhum: só apresentação do
 * `totalAmountSnapshot` na moeda em que ele foi negociado.
 *
 * Moeda ausente/inválida por dado histórico inesperado não quebra a tela e
 * NUNCA vira "R$": cai para `CÓDIGO 1.000,00`, preservando a rastreabilidade.
 */
export function formatPurchaseOrderAmount(
  value: number | null | undefined,
  currency: string | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const amount = value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!CURRENCY_CODE_RE.test(code)) {
    return code ? `${code} ${amount}` : amount;
  }
  try {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    // Código com formato válido mas desconhecido pelo runtime (ex.: "XYZ").
    return `${code} ${amount}`;
  }
}

export function formatSupplierCoverage(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export const SUPPLIER_PERFORMANCE_EMPTY_COVERAGE_LABEL =
  "Sem pedidos elegíveis no período";

export const SUPPLIER_PERFORMANCE_EMPTY_EVALUATIONS_LABEL = "Sem avaliações no período.";

/** Texto declarado na tela e na impressão do relatório. */
export const SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT: readonly string[] = [
  "Cada Pedido de Compra elegível é avaliado de 0 a 10 nos critérios: Qualidade, Prazo, Conformidade e Atendimento.",
  "Os quatro critérios possuem o mesmo peso de 25%.",
  "A nota do Pedido de Compra é a média aritmética dos quatro critérios.",
  "A nota do fornecedor é a média aritmética das avaliações dos pedidos incluídos no período.",
  "Pedidos não avaliados não recebem nota zero; são contabilizados na cobertura.",
  "Metodologia interna de avaliação de fornecedores.",
];
