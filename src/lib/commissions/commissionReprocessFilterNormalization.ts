/**
 * Forma CANÔNICA dos filtros de reprocessamento — base do preview determinístico.
 *
 * POR QUE EXISTE
 * `hashCommissionReprocessFilters` monta o payload direto do objeto recebido e
 * serializa com `JSON.stringify`. Isso produz hashes DIFERENTES para filtros
 * semanticamente IGUAIS:
 *
 *   - `JSON.stringify` OMITE chave com `undefined` e MANTÉM com `null`, então
 *     `{ customerExternalId: undefined }` e `{ customerExternalId: null }`
 *     geram payloads distintos;
 *   - `salesOrderCode: ""` e `salesOrderCode: null` significam "sem filtro" e
 *     geram hashes distintos;
 *   - booleano ausente e `false` significam o mesmo e geram hashes distintos;
 *   - `statuses` é ordenado mas não deduplicado;
 *   - datas podem chegar como `Date` ou string e serializam diferente.
 *
 * Consequência prática: o apply compara o hash do preview com o hash
 * recalculado. Divergência espúria vira `RUN_TOKEN_MISMATCH` num caso legítimo,
 * ou — pior — dois previews diferentes colidem no mesmo token.
 *
 * A normalização acontece ANTES do hash. Módulo puro: sem Prisma, sem I/O.
 */

import type {
  CommissionReprocessDateAxis,
  CommissionReprocessFilters,
  CommissionReprocessLifecycle,
} from "./commissionReprocess.js";

/** Ordem canônica dos lifecycles — estável e independente de alfabeto. */
const LIFECYCLE_ORDER: readonly CommissionReprocessLifecycle[] = [
  "forecast",
  "confirmed",
  "released",
  "paid",
];

const DEFAULT_DATE_AXIS: CommissionReprocessDateAxis = "issue";

/** Texto opcional: vazio, só espaços e ausente são o MESMO estado (sem filtro). */
function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Código de negócio: normaliza caixa para o filtro não depender de digitação. */
function normalizeCode(value: unknown): string | null {
  const text = normalizeOptionalText(value);
  return text == null ? null : text.toUpperCase();
}

/** Id numérico externo: `0`, `NaN` e não-finito não são id válido. */
function normalizeExternalId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Data civil `YYYY-MM-DD`. Aceita `Date` e string ISO longa, mas o filtro é por
 * DIA — guardar hora tornaria dois previews do mesmo dia diferentes.
 */
function normalizeCivilDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }
  const text = normalizeOptionalText(value);
  if (text == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1]! : null;
}

/** Booleano de flag: ausente/indefinido é `false`, nunca "diferente de false". */
function normalizeFlag(value: unknown): boolean {
  return value === true;
}

function normalizeDateAxis(value: unknown): CommissionReprocessDateAxis {
  return value === "nfe" || value === "settlement" || value === "issue"
    ? value
    : DEFAULT_DATE_AXIS;
}

/** Lifecycles: dedup + ordem canônica. Lista vazia = "todos", como o domínio já trata. */
function normalizeStatuses(value: unknown): CommissionReprocessLifecycle[] {
  if (!Array.isArray(value)) return [];
  const present = new Set<CommissionReprocessLifecycle>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const candidate = raw.trim().toLowerCase() as CommissionReprocessLifecycle;
    if (LIFECYCLE_ORDER.includes(candidate)) present.add(candidate);
  }
  return LIFECYCLE_ORDER.filter((s) => present.has(s));
}

/** Filtros na forma canônica. Todas as chaves presentes, nunca `undefined`. */
export type NormalizedCommissionReprocessFilters = {
  from: string | null;
  to: string | null;
  dateAxis: CommissionReprocessDateAxis;
  customerExternalId: number | null;
  sellerExternalId: number | null;
  salesOrderCode: string | null;
  productCode: string | null;
  priceTableId: string | null;
  statuses: CommissionReprocessLifecycle[];
  includeConfirmedNotPaid: boolean;
  includeReleasedNotPaid: boolean;
  includePaid: boolean;
};

export function normalizeCommissionReprocessFilters(
  filters: Partial<CommissionReprocessFilters> | null | undefined
): NormalizedCommissionReprocessFilters {
  const f = filters ?? {};
  return {
    from: normalizeCivilDate(f.from),
    to: normalizeCivilDate(f.to),
    dateAxis: normalizeDateAxis(f.dateAxis),
    customerExternalId: normalizeExternalId(f.customerExternalId),
    sellerExternalId: normalizeExternalId(f.sellerExternalId),
    salesOrderCode: normalizeCode(f.salesOrderCode),
    productCode: normalizeCode(f.productCode),
    priceTableId: normalizeOptionalText(f.priceTableId),
    statuses: normalizeStatuses(f.statuses),
    includeConfirmedNotPaid: normalizeFlag(f.includeConfirmedNotPaid),
    includeReleasedNotPaid: normalizeFlag(f.includeReleasedNotPaid),
    includePaid: normalizeFlag(f.includePaid),
  };
}

/**
 * Serialização canônica: chaves em ordem FIXA e explícita.
 *
 * Não depende da ordem de inserção do objeto nem do comportamento de
 * `JSON.stringify` com `undefined` — a normalização já garantiu que nenhuma
 * chave é `undefined`, e a ordem aqui é escrita à mão de propósito.
 */
export function serializeNormalizedCommissionReprocessFilters(
  normalized: NormalizedCommissionReprocessFilters
): string {
  return JSON.stringify([
    ["from", normalized.from],
    ["to", normalized.to],
    ["dateAxis", normalized.dateAxis],
    ["customerExternalId", normalized.customerExternalId],
    ["sellerExternalId", normalized.sellerExternalId],
    ["salesOrderCode", normalized.salesOrderCode],
    ["productCode", normalized.productCode],
    ["priceTableId", normalized.priceTableId],
    ["statuses", normalized.statuses],
    ["includeConfirmedNotPaid", normalized.includeConfirmedNotPaid],
    ["includeReleasedNotPaid", normalized.includeReleasedNotPaid],
    ["includePaid", normalized.includePaid],
  ]);
}
