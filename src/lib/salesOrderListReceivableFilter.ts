/**
 * Filtro de status de CR oficial (Contas a Receber) na listagem de Pedidos.
 * Cadeia canônica: SalesOrder → SalesOrderNfeLink.nfeExternalId →
 * NomusAccountsReceivable.sourceInvoiceId.
 *
 * Aceita um ou vários status (OR): `open`, `settled`, `none`
 * via CSV (`open,settled`) ou valor único.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";

/** Tolerância alinhada ao relatório comercial / auditoria financeira. */
export const SALES_ORDER_LIST_CR_OPEN_TOLERANCE = 0.01;

export const SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES = [
  "open",
  "settled",
  "none",
] as const;

export type SalesOrderListReceivableStatus =
  (typeof SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES)[number];

export const RECEIVABLE_STATUS_FILTER_OPTIONS: Array<{
  value: SalesOrderListReceivableStatus | "";
  label: string;
}> = [
  { value: "", label: "Todos" },
  { value: "open", label: "CR em aberto" },
  { value: "settled", label: "CR quitado" },
  { value: "none", label: "Sem CR" },
];

const STATUS_SET = new Set<string>(SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES);

/** Um token; compatível com callers legados. */
export function parseSalesOrderListReceivableStatusParam(
  value: unknown
): SalesOrderListReceivableStatus | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (STATUS_SET.has(token)) {
    return token as SalesOrderListReceivableStatus;
  }
  return null;
}

/**
 * Um ou vários status (CSV `open,settled` ou array).
 * Dedupe + ordem canônica. Os 3 valores ≡ sem filtro (array vazio).
 */
export function parseSalesOrderListReceivableStatusParams(
  value: unknown
): SalesOrderListReceivableStatus[] {
  const rawParts: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item == null) continue;
      rawParts.push(...String(item).split(","));
    }
  } else if (typeof value === "string") {
    rawParts.push(...value.split(","));
  } else if (value != null && value !== "") {
    rawParts.push(String(value));
  }

  const selected = new Set<SalesOrderListReceivableStatus>();
  for (const part of rawParts) {
    const token = part.trim().toLowerCase();
    if (STATUS_SET.has(token)) {
      selected.add(token as SalesOrderListReceivableStatus);
    }
  }

  if (selected.size === 0) return [];
  if (selected.size >= SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES.length) {
    return [];
  }

  return SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES.filter((s) => selected.has(s));
}

/** Serializa para query string (CSV). Vazio = sem filtro. */
export function formatSalesOrderListReceivableStatusParam(
  statuses: ReadonlyArray<SalesOrderListReceivableStatus>
): string {
  if (!statuses.length) return "";
  if (statuses.length >= SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES.length) return "";
  return SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES.filter((s) =>
    statuses.includes(s)
  ).join(",");
}

export function receivableStatusFilterLabel(
  statuses: ReadonlyArray<SalesOrderListReceivableStatus>
): string | null {
  if (!statuses.length) return null;
  const labels = RECEIVABLE_STATUS_FILTER_OPTIONS.filter(
    (o) => o.value && statuses.includes(o.value)
  ).map((o) => o.label);
  return labels.length ? labels.join(", ") : null;
}

export function andSalesOrderListWhere(
  base: Prisma.SalesOrderWhereInput,
  extra: Prisma.SalesOrderWhereInput | null | undefined
): Prisma.SalesOrderWhereInput {
  if (!extra || Object.keys(extra).length === 0) return base;
  if (!base || Object.keys(base).length === 0) return extra;
  return { AND: [base, extra] };
}

function settledIdsFromSets(sets: {
  withAnyCr: ReadonlySet<string>;
  withOpenCr: ReadonlySet<string>;
}): string[] {
  const settledIds: string[] = [];
  for (const id of sets.withAnyCr) {
    if (!sets.withOpenCr.has(id)) settledIds.push(id);
  }
  return settledIds;
}

/** Where para um único status (comportamento legado). */
export function buildSalesOrderListReceivableStatusWhereFromSets(
  status: SalesOrderListReceivableStatus,
  sets: { withAnyCr: ReadonlySet<string>; withOpenCr: ReadonlySet<string> }
): Prisma.SalesOrderWhereInput {
  if (status === "open") {
    return { id: { in: [...sets.withOpenCr] } };
  }
  if (status === "settled") {
    return { id: { in: settledIdsFromSets(sets) } };
  }
  // none: pedidos sem CR oficial vinculado via NF
  if (sets.withAnyCr.size === 0) return {};
  return { id: { notIn: [...sets.withAnyCr] } };
}

/**
 * Where para 0..N status (OR).
 * 0 ou os 3 → null (sem filtro).
 */
export function buildSalesOrderListReceivableStatusesWhereFromSets(
  statuses: ReadonlyArray<SalesOrderListReceivableStatus>,
  sets: { withAnyCr: ReadonlySet<string>; withOpenCr: ReadonlySet<string> }
): Prisma.SalesOrderWhereInput | null {
  const unique = parseSalesOrderListReceivableStatusParams(statuses.join(","));
  if (unique.length === 0) return null;
  if (unique.length === 1) {
    return buildSalesOrderListReceivableStatusWhereFromSets(unique[0]!, sets);
  }

  const hasOpen = unique.includes("open");
  const hasSettled = unique.includes("settled");
  const hasNone = unique.includes("none");

  // open ∪ settled = quem tem qualquer CR
  if (hasOpen && hasSettled && !hasNone) {
    return { id: { in: [...sets.withAnyCr] } };
  }

  const clauses: Prisma.SalesOrderWhereInput[] = [];
  if (hasOpen) {
    clauses.push({ id: { in: [...sets.withOpenCr] } });
  }
  if (hasSettled) {
    clauses.push({ id: { in: settledIdsFromSets(sets) } });
  }
  if (hasNone) {
    if (sets.withAnyCr.size === 0) {
      // Sem CR no sistema: "none" cobre todo mundo → filtro nulo junto com outros
      // já cobertos por open/settled vazios; tratar como sem restrição extra.
      return null;
    }
    clauses.push({ id: { notIn: [...sets.withAnyCr] } });
  }

  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0]!;
  return { OR: clauses };
}

/**
 * Agrega pedidos com CR (qualquer) e com saldo em aberto via NF vinculada.
 */
export async function loadSalesOrderOfficialCrOrderIdSets(
  prisma: PrismaClient
): Promise<{ withAnyCr: Set<string>; withOpenCr: Set<string> }> {
  const receivables = await prisma.nomusAccountsReceivable.findMany({
    where: { sourceInvoiceId: { not: null } },
    select: {
      externalId: true,
      sourceInvoiceId: true,
      balanceReceivable: true,
    },
  });

  const openByNfe = new Map<number, number>();
  const anyCrNfeIds = new Set<number>();
  const seenReceivable = new Set<number>();

  for (const row of receivables) {
    if (row.sourceInvoiceId == null) continue;
    if (seenReceivable.has(row.externalId)) continue;
    seenReceivable.add(row.externalId);
    anyCrNfeIds.add(row.sourceInvoiceId);
    const open = decimalToNumber(row.balanceReceivable) ?? 0;
    if (open > SALES_ORDER_LIST_CR_OPEN_TOLERANCE) {
      openByNfe.set(
        row.sourceInvoiceId,
        (openByNfe.get(row.sourceInvoiceId) ?? 0) + open
      );
    }
  }

  if (anyCrNfeIds.size === 0) {
    return { withAnyCr: new Set(), withOpenCr: new Set() };
  }

  const links = await prisma.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: [...anyCrNfeIds] } },
    select: { salesOrderId: true, nfeExternalId: true },
  });

  const withAnyCr = new Set<string>();
  const openByOrder = new Map<string, number>();
  for (const link of links) {
    withAnyCr.add(link.salesOrderId);
    const nfeOpen = openByNfe.get(link.nfeExternalId) ?? 0;
    if (nfeOpen > 0) {
      openByOrder.set(
        link.salesOrderId,
        (openByOrder.get(link.salesOrderId) ?? 0) + nfeOpen
      );
    }
  }

  const withOpenCr = new Set<string>();
  for (const [orderId, openSum] of openByOrder) {
    if (openSum > SALES_ORDER_LIST_CR_OPEN_TOLERANCE) {
      withOpenCr.add(orderId);
    }
  }

  return { withAnyCr, withOpenCr };
}

export async function resolveSalesOrderListReceivableStatusWhere(
  prisma: PrismaClient,
  statuses:
    | SalesOrderListReceivableStatus
    | ReadonlyArray<SalesOrderListReceivableStatus>
    | null
    | undefined
): Promise<Prisma.SalesOrderWhereInput | null> {
  const list = Array.isArray(statuses)
    ? parseSalesOrderListReceivableStatusParams(statuses.join(","))
    : statuses
      ? parseSalesOrderListReceivableStatusParams(statuses)
      : [];
  if (list.length === 0) return null;
  const sets = await loadSalesOrderOfficialCrOrderIdSets(prisma);
  return buildSalesOrderListReceivableStatusesWhereFromSets(list, sets);
}
