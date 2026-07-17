/**
 * FIN-08 — Contas a Receber: agenda efetiva (CR + Documento aguardando + residual).
 *
 * Consome o motor FIN-05. Dedup de CR só por `externalId`.
 * Não inclui previsão integral substituída nem saldo de corte.
 * Linhas: CR REAL | DOCUMENTO AGUARDANDO CR | PREVISÃO RESIDUAL DO PEDIDO.
 */

import type {
  FinanceArDashboardFilters,
  FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  isFinanceArReceivedOrSettled,
  resolveFinanceArDueDateBounds,
  roundMoney,
  startOfLocalDay,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  classifyFinanceArReceivableOrigin,
  type FinanceArReceivableOrigin,
} from "@/src/lib/financeAccountsReceivableDeduplication.js";
import type { SalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";

export type FinanceArEffectiveLineKind =
  | "CR_REAL"
  | "DOCUMENT_AWAITING_CR"
  | "ORDER_RESIDUAL_FORECAST";

export const FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL: Record<
  FinanceArEffectiveLineKind,
  string
> = {
  CR_REAL: "CR REAL",
  DOCUMENT_AWAITING_CR: "DOCUMENTO AGUARDANDO CR",
  ORDER_RESIDUAL_FORECAST: "PREVISÃO RESIDUAL DO PEDIDO",
};

export type FinanceArEffectiveTitlesSummary = {
  totalTitles: number;
  totalOriginalValue: number;
  totalReceivedValue: number;
  totalOpenValue: number;
  totalOverdueValue: number;
  totalDueValue: number;
  averageTicket: number;
};

/** Linha da agenda efetiva na grade de Contas a Receber (FIN-08). */
export type FinanceArEffectiveTitleListItem = {
  externalId: number;
  companyName: string | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  comments: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  competenceDate: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  calculatedStatus: string;
  nomusStatus: boolean | null;
  daysOverdue: number;
  suspendCollection: boolean | null;
  origin: FinanceArReceivableOrigin;
  syncedAt: string;
  lineKind: FinanceArEffectiveLineKind;
  lineKindLabel: string;
  orderCode: string | null;
  salesOrderId: string | null;
};

export type FinanceArEffectiveOrderContext = {
  schedule: SalesOrderEffectiveFinancialSchedule;
  personId?: number | null;
  personName?: string | null;
  personCnpj?: string | null;
  companyName?: string | null;
};

export type BuildFinanceArEffectiveTitlesInput = {
  /** Títulos Nomus (já saneados ou brutos — CR dedupado por externalId aqui). */
  nomusRows: FinanceArDashboardRow[];
  /** Pedidos com agenda efetiva FIN-05. */
  orderContexts: FinanceArEffectiveOrderContext[];
  /** Filtro por Pedido — só linhas desse pedido. */
  orderCode?: string | null;
  /** Filtro por cliente (personId Nomus). */
  customerPersonId?: number | null;
  customerName?: string | null;
  customerCnpj?: string | null;
  referenceDate?: Date;
};

function decimalToNumber(value: { toFixed(dp: number): string }): number {
  return roundMoney(Number(value.toFixed(2)));
}

function parseIsoDateLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/** Dedup oficial de CR: somente chave externa. */
export function dedupeFinanceArCrByExternalId(
  rows: FinanceArDashboardRow[]
): FinanceArDashboardRow[] {
  const map = new Map<number, FinanceArDashboardRow>();
  for (const row of rows) {
    if (!map.has(row.externalId)) map.set(row.externalId, row);
  }
  return [...map.values()];
}

function syntheticExternalId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Sempre negativo para não colidir com externalId Nomus (>0).
  return h <= 0 ? h - 1 : -h;
}

function normalizeOrderCode(code: string | null | undefined): string {
  return (code ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function orderCodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeOrderCode(a);
  const nb = normalizeOrderCode(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const strip = (s: string) => s.replace(/^pd\s*/i, "").replace(/\s+/g, "");
  return strip(na) === strip(nb);
}

function descriptionMentionsOrder(
  description: string | null | undefined,
  orderCode: string
): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  const code = normalizeOrderCode(orderCode);
  if (d.includes(code)) return true;
  const digits = code.replace(/^pd\s*/i, "").replace(/\s+/g, "");
  return digits.length >= 3 && d.includes(digits);
}

function customerMatches(
  row: Pick<FinanceArEffectiveTitleListItem, "personId" | "personName" | "personCnpj">,
  input: BuildFinanceArEffectiveTitlesInput
): boolean {
  if (input.customerPersonId != null) {
    return row.personId === input.customerPersonId;
  }
  const wantName = (input.customerName ?? "").trim().toLowerCase();
  const wantCnpj = (input.customerCnpj ?? "").replace(/\D/g, "");
  if (!wantName && !wantCnpj) return true;
  const name = (row.personName ?? "").toLowerCase();
  const cnpj = (row.personCnpj ?? "").replace(/\D/g, "");
  const nameOk = wantName ? name.includes(wantName) : false;
  const cnpjOk = wantCnpj ? cnpj === wantCnpj : false;
  if (wantName && wantCnpj) return nameOk || cnpjOk;
  if (wantName) return nameOk;
  return cnpjOk;
}

function mapNomusToEffectiveItem(
  row: FinanceArDashboardRow,
  referenceDate: Date,
  orderMeta: { orderCode: string | null; salesOrderId: string | null } | null
): FinanceArEffectiveTitleListItem {
  const origin: FinanceArReceivableOrigin = classifyFinanceArReceivableOrigin(row);
  return {
    externalId: row.externalId,
    companyName: row.companyName,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    description: row.description,
    comments: row.comments,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    competenceDate: row.competenceDate?.toISOString() ?? null,
    dueDate: row.dueDate?.toISOString() ?? null,
    settlementDate: row.settlementDate?.toISOString() ?? null,
    amountReceivable: roundMoney(row.amountReceivable),
    amountReceived: roundMoney(row.amountReceived),
    balanceReceivable: roundMoney(row.balanceReceivable),
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    calculatedStatus: classifyFinanceArTitle(row, referenceDate),
    nomusStatus: row.nomusStatus,
    daysOverdue: computeDaysOverdue(row.dueDate, referenceDate),
    suspendCollection: row.suspendCollection,
    origin,
    syncedAt: row.syncedAt.toISOString(),
    lineKind: "CR_REAL",
    lineKindLabel: FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL.CR_REAL,
    orderCode: orderMeta?.orderCode ?? null,
    salesOrderId: orderMeta?.salesOrderId ?? null,
  };
}

function buildSyntheticRow(input: {
  key: string;
  lineKind: FinanceArEffectiveLineKind;
  orderCode: string;
  salesOrderId: string;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  companyName: string | null;
  description: string;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDateIso: string | null;
  amount: number;
  referenceDate: Date;
}): FinanceArEffectiveTitleListItem {
  const dueDate = parseIsoDateLocal(input.dueDateIso);
  const amount = roundMoney(input.amount);
  const fakeRow: FinanceArDashboardRow = {
    externalId: syntheticExternalId(input.key),
    companyName: input.companyName,
    personId: input.personId,
    personName: input.personName,
    personCnpj: input.personCnpj,
    description: input.description,
    comments: null,
    dueDate,
    competenceDate: null,
    settlementDate: null,
    amountReceivable: amount,
    amountReceived: 0,
    balanceReceivable: amount,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: input.sourceInvoiceId,
    sourceInvoiceNumber: input.sourceInvoiceNumber,
    suspendCollection: false,
    nomusStatus: null,
    syncedAt: input.referenceDate,
  };
  const status =
    amount <= 0.009
      ? "settled"
      : input.dueDateIso
        ? classifyFinanceArTitle(fakeRow, input.referenceDate)
        : "open";
  return {
    externalId: fakeRow.externalId,
    companyName: input.companyName,
    personId: input.personId,
    personName: input.personName,
    personCnpj: input.personCnpj,
    description: input.description,
    comments: null,
    sourceInvoiceId: input.sourceInvoiceId,
    sourceInvoiceNumber: input.sourceInvoiceNumber,
    competenceDate: null,
    dueDate: dueDate?.toISOString() ?? null,
    settlementDate: null,
    amountReceivable: amount,
    amountReceived: 0,
    balanceReceivable: amount,
    paymentMethodName: null,
    bankAccountName: null,
    calculatedStatus: status,
    nomusStatus: null,
    daysOverdue: computeDaysOverdue(dueDate, input.referenceDate),
    suspendCollection: false,
    origin:
      input.sourceInvoiceId != null || input.sourceInvoiceNumber
        ? "WITH_NFE"
        : "WITHOUT_NFE",
    syncedAt: input.referenceDate.toISOString(),
    lineKind: input.lineKind,
    lineKindLabel: FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL[input.lineKind],
    orderCode: input.orderCode,
    salesOrderId: input.salesOrderId,
  };
}

export function computeFinanceArEffectiveTitlesSummary(
  items: FinanceArEffectiveTitleListItem[]
): FinanceArEffectiveTitlesSummary {
  let totalOriginalValue = 0;
  let totalReceivedValue = 0;
  let totalOpenValue = 0;
  let totalOverdueValue = 0;
  let totalDueValue = 0;
  for (const item of items) {
    totalOriginalValue += item.amountReceivable;
    totalReceivedValue += item.amountReceived;
    totalOpenValue += item.balanceReceivable;
    if (item.calculatedStatus === "overdue") {
      totalOverdueValue += item.balanceReceivable;
    }
    if (
      item.calculatedStatus === "upcoming" ||
      item.calculatedStatus === "dueToday"
    ) {
      totalDueValue += item.balanceReceivable;
    }
  }
  const totalTitles = items.length;
  return {
    totalTitles,
    totalOriginalValue: roundMoney(totalOriginalValue),
    totalReceivedValue: roundMoney(totalReceivedValue),
    totalOpenValue: roundMoney(totalOpenValue),
    totalOverdueValue: roundMoney(totalOverdueValue),
    totalDueValue: roundMoney(totalDueValue),
    averageTicket:
      totalTitles > 0 ? roundMoney(totalOriginalValue / totalTitles) : 0,
  };
}

/**
 * Une CR Nomus + agenda efetiva dos pedidos, sem duplicar camadas.
 */
export function buildFinanceArEffectiveTitles(
  input: BuildFinanceArEffectiveTitlesInput
): {
  items: FinanceArEffectiveTitleListItem[];
  summary: FinanceArEffectiveTitlesSummary;
} {
  const referenceDate = input.referenceDate ?? new Date();
  const nomusByExternalId = new Map(
    dedupeFinanceArCrByExternalId(input.nomusRows).map((r) => [r.externalId, r] as const)
  );

  const crToOrder = new Map<
    number,
    { orderCode: string; salesOrderId: string }
  >();
  for (const ctx of input.orderContexts) {
    for (const cr of ctx.schedule.realReceivables) {
      crToOrder.set(cr.externalId, {
        orderCode: ctx.schedule.orderCode,
        salesOrderId: ctx.schedule.salesOrderId,
      });
    }
  }

  const items: FinanceArEffectiveTitleListItem[] = [];
  const emittedCrIds = new Set<number>();

  for (const ctx of input.orderContexts) {
    const { schedule } = ctx;
    if (
      input.orderCode &&
      !orderCodesMatch(schedule.orderCode, input.orderCode)
    ) {
      continue;
    }

    const personId = ctx.personId ?? null;
    const personName = ctx.personName ?? null;
    const personCnpj = ctx.personCnpj ?? null;
    const companyName = ctx.companyName ?? null;

    // CR oficiais: só os que passaram no filtro Nomus (status/ano/etc.).
    // Não reinsere CR liquidado via agenda do Pedido quando o grid pediu "Em aberto".
    for (const cr of schedule.realReceivables) {
      if (emittedCrIds.has(cr.externalId)) continue;
      const nomus = nomusByExternalId.get(cr.externalId);
      if (!nomus) continue;
      emittedCrIds.add(cr.externalId);
      items.push(
        mapNomusToEffectiveItem(nomus, referenceDate, {
          orderCode: schedule.orderCode,
          salesOrderId: schedule.salesOrderId,
        })
      );
    }

    for (const doc of schedule.documentSchedule) {
      if (doc.kind === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE") {
        const amount = decimalToNumber(doc.allocatedByOrderPrice);
        if (amount <= 0.009) continue;
        items.push(
          buildSyntheticRow({
            key: `doc-await:${schedule.orderCode}:${doc.documentKey}`,
            lineKind: "DOCUMENT_AWAITING_CR",
            orderCode: schedule.orderCode,
            salesOrderId: schedule.salesOrderId,
            personId,
            personName,
            personCnpj,
            companyName,
            description: `Documento aguardando CR · Pedido ${schedule.orderCode}`,
            sourceInvoiceId: doc.sourceInvoiceId,
            sourceInvoiceNumber:
              doc.sourceInvoiceId != null ? String(doc.sourceInvoiceId) : null,
            dueDateIso: null,
            amount,
            referenceDate,
          })
        );
        continue;
      }

      for (const inst of doc.installments) {
        const amount = decimalToNumber(inst.amount);
        if (amount <= 0.009) continue;
        items.push(
          buildSyntheticRow({
            key: `doc-sched:${schedule.orderCode}:${doc.documentKey}:${inst.installmentNumber}`,
            lineKind: "DOCUMENT_AWAITING_CR",
            orderCode: schedule.orderCode,
            salesOrderId: schedule.salesOrderId,
            personId,
            personName,
            personCnpj,
            companyName,
            description: `Documento aguardando CR · Pedido ${schedule.orderCode} · Parcela ${inst.installmentNumber}`,
            sourceInvoiceId: doc.sourceInvoiceId,
            sourceInvoiceNumber:
              doc.sourceInvoiceId != null ? String(doc.sourceInvoiceId) : null,
            dueDateIso: inst.dueDate,
            amount,
            referenceDate,
          })
        );
      }
    }

    for (const line of schedule.activeOrderResidualSchedule) {
      const amount = decimalToNumber(line.residualAmount);
      if (amount <= 0.009) continue;
      items.push(
        buildSyntheticRow({
          key: `residual:${schedule.orderCode}:${line.installmentNumber}:${line.dueDate ?? "x"}`,
          lineKind: "ORDER_RESIDUAL_FORECAST",
          orderCode: schedule.orderCode,
          salesOrderId: schedule.salesOrderId,
          personId,
          personName,
          personCnpj,
          companyName,
          description: `Previsão residual · Pedido ${schedule.orderCode} · Parcela ${line.installmentNumber}`,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          dueDateIso: line.dueDate,
          amount,
          referenceDate,
        })
      );
    }
  }

  // CR de outros pedidos (mesmo cliente) / sem vínculo de agenda — mantém.
  for (const row of nomusByExternalId.values()) {
    if (emittedCrIds.has(row.externalId)) continue;
    const meta = crToOrder.get(row.externalId) ?? null;
    if (input.orderCode) {
      const linked =
        (meta && orderCodesMatch(meta.orderCode, input.orderCode)) ||
        descriptionMentionsOrder(row.description, input.orderCode);
      if (!linked) continue;
    }
    items.push(
      mapNomusToEffectiveItem(
        row,
        referenceDate,
        meta
          ? { orderCode: meta.orderCode, salesOrderId: meta.salesOrderId }
          : null
      )
    );
  }

  let filtered = items;
  if (input.orderCode) {
    filtered = filtered.filter(
      (item) =>
        orderCodesMatch(item.orderCode, input.orderCode) ||
        descriptionMentionsOrder(item.description, input.orderCode!)
    );
  }
  if (
    input.customerPersonId != null ||
    input.customerName ||
    input.customerCnpj
  ) {
    filtered = filtered.filter((item) => customerMatches(item, input));
  }

  const summary = computeFinanceArEffectiveTitlesSummary(filtered);
  return { items: filtered, summary };
}

/**
 * Reaplica filtros de status/vencimento na agenda efetiva (residual/Doc/CR),
 * para o grid de Títulos não ignorar "Em aberto" / ano / mês após o merge FIN-08.
 */
export function filterFinanceArEffectiveTitlesByDashboardFilters(
  items: readonly FinanceArEffectiveTitleListItem[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date()
): FinanceArEffectiveTitleListItem[] {
  const { from, toExclusive, empty } = resolveFinanceArDueDateBounds(filters);
  if (empty) return [];

  return items.filter((item) => {
    const due = item.dueDate ? parseIsoDateLocal(item.dueDate) : null;
    if (from && (!due || startOfLocalDay(due).getTime() < from.getTime())) {
      return false;
    }
    if (
      toExclusive &&
      (!due || startOfLocalDay(due).getTime() >= toExclusive.getTime())
    ) {
      return false;
    }

    const invoiceFilter = filters.invoiceIssued ?? "all";
    if (invoiceFilter !== "all") {
      const hasInvoice =
        item.sourceInvoiceId != null || Boolean(item.sourceInvoiceNumber?.trim());
      if (invoiceFilter === "yes" && !hasInvoice) return false;
      if (invoiceFilter === "no" && hasInvoice) return false;
    }

    if (filters.status === "all") return true;

    const rowLike = {
      balanceReceivable: item.balanceReceivable,
      amountReceivable: item.amountReceivable,
      amountReceived: item.amountReceived,
      settlementDate: item.settlementDate ? parseIsoDateLocal(item.settlementDate) : null,
      dueDate: due,
      suspendCollection: item.suspendCollection === true,
      // campos mínimos para classify
      externalId: item.externalId,
      companyName: item.companyName,
      personId: item.personId,
      personName: item.personName,
      personCnpj: item.personCnpj,
      description: item.description,
      comments: item.comments,
      competenceDate: null as Date | null,
      paymentMethodName: item.paymentMethodName,
      bankAccountName: item.bankAccountName,
      sourceInvoiceId: item.sourceInvoiceId,
      sourceInvoiceNumber: item.sourceInvoiceNumber,
      nomusStatus: item.nomusStatus,
      syncedAt: referenceDate,
    } satisfies FinanceArDashboardRow;

    if (filters.status === "open") return !isFinanceArReceivedOrSettled(rowLike);
    if (filters.status === "settled") return isFinanceArReceivedOrSettled(rowLike);
    const status = classifyFinanceArTitle(rowLike, referenceDate);
    if (filters.status === "suspended") return status === "suspended";
    return status === filters.status;
  });
}

export function formatFinanceArEffectiveLineKind(
  kind: FinanceArEffectiveLineKind | string | null | undefined
): string {
  if (!kind) return FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL.CR_REAL;
  if (kind in FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL) {
    return FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL[kind as FinanceArEffectiveLineKind];
  }
  return String(kind);
}
