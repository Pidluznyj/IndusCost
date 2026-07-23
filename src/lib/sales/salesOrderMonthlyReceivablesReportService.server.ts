/**
 * Loader server-side — Recebíveis mensais por Pedido de Venda (OP-08).
 *
 * População: OP-02 (`resolveSalesOrderListWhere`).
 * Agenda: FIN-05 via `getOrderFullAudit` + `buildSalesOrderEffectiveFinancialSchedule`.
 * Linhas: FIN-08 (`buildFinanceArEffectiveTitles` via adapter).
 * Somente leitura — sem escrita em Pedido/CR/Documento/Fluxo.
 */
import type { PrismaClient } from "@prisma/client";
import { getSalesOrderNetValue } from "@/src/lib/crmCommercialOrderRules.js";
import { shouldIncludeSalesOrderInOperationalReceivables } from "@/src/lib/financeArCancelledSalesOrderExclusion.js";
import { getOrderFullAudit } from "@/src/lib/finance/orderFullAuditService.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";
import { buildEffectiveScheduleInputFromAudit } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "@/src/lib/salesOrderListQuery.server.js";
import { formatSalesOrderReportStatusLabel } from "./salesOrderReport.js";
import {
  buildMonthColumns,
  buildSalesOrderReportFilterLabels,
  computeMonthlyReceivablesTotalsFromRows,
  defaultDueMonthRange,
  parseYearMonthKey,
  rowHasReceivablesInSelectedPeriod,
  SALES_ORDER_MONTHLY_RECEIVABLES_MAX_MONTHS,
  SALES_ORDER_MONTHLY_RECEIVABLES_PAGE_SIZE_DEFAULT,
  SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_SUBTITLE,
  SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_TITLE,
  SALES_ORDER_MONTHLY_RECEIVABLES_ROWS_LIMIT,
  yearMonthKeyFromDueIso,
  type SalesOrderMonthlyReceivablesDetailPayload,
  type SalesOrderMonthlyReceivablesFinancialSituation,
  type SalesOrderMonthlyReceivablesOriginFilter,
  type SalesOrderMonthlyReceivablesReportFilters,
  type SalesOrderMonthlyReceivablesReportPayload,
  type SalesOrderMonthlyReceivablesRow,
} from "./salesOrderMonthlyReceivablesReport.js";
import {
  buildMonthlyReceivablesRowFromLines,
  lineMatchesFinancialSituation,
  lineMatchesOrigin,
  listEffectiveReceivableLinesFromSchedule,
  mapEffectiveLineToDetail,
  rowMatchesOriginFilter,
} from "./salesOrderMonthlyReceivablesReportMath.js";

const CONCURRENCY = 4;

function isoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function customerDisplayName(customer?: {
  companyName?: string | null;
  tradeName?: string | null;
} | null): string {
  return (
    customer?.tradeName?.trim() ||
    customer?.companyName?.trim() ||
    "—"
  );
}

function parseBool(raw: unknown): boolean {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "sim";
}

function parseFinancialSituation(
  raw: unknown
): SalesOrderMonthlyReceivablesFinancialSituation {
  const s = String(raw ?? "all").trim().toLowerCase();
  if (
    s === "planned" ||
    s === "open" ||
    s === "overdue" ||
    s === "received" ||
    s === "partial"
  ) {
    return s;
  }
  return "all";
}

function parseOrigin(raw: unknown): SalesOrderMonthlyReceivablesOriginFilter {
  const s = String(raw ?? "all").trim().toLowerCase();
  if (s === "planned" || s === "document" || s === "cr" || s === "mixed") {
    return s;
  }
  return "all";
}

function parsePage(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

function parseSort(
  raw: unknown
): {
  sortBy:
    | "orderCode"
    | "customer"
    | "issueDate"
    | "seller"
    | "commercial"
    | "agenda"
    | "difference"
    | "quality";
  sortDir: "asc" | "desc";
} {
  const s = String(raw ?? "issueDate").trim();
  const allowed = new Set([
    "orderCode",
    "customer",
    "issueDate",
    "seller",
    "commercial",
    "agenda",
    "difference",
    "quality",
  ]);
  const sortBy = (allowed.has(s) ? s : "issueDate") as
    | "orderCode"
    | "customer"
    | "issueDate"
    | "seller"
    | "commercial"
    | "agenda"
    | "difference"
    | "quality";
  return { sortBy, sortDir: "desc" };
}

function compareRows(
  a: SalesOrderMonthlyReceivablesRow,
  b: SalesOrderMonthlyReceivablesRow,
  sortBy: ReturnType<typeof parseSort>["sortBy"],
  sortDir: "asc" | "desc"
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  const str = (x: string | null | undefined) => (x ?? "").toLocaleLowerCase("pt-BR");
  switch (sortBy) {
    case "orderCode":
      return dir * str(a.orderCode).localeCompare(str(b.orderCode), "pt-BR");
    case "customer":
      return dir * str(a.customerName).localeCompare(str(b.customerName), "pt-BR");
    case "seller":
      return dir * str(a.sellerName).localeCompare(str(b.sellerName), "pt-BR");
    case "commercial":
      return dir * (a.orderCommercialTotal - b.orderCommercialTotal);
    case "agenda":
      return dir * (a.effectiveScheduleTotal - b.effectiveScheduleTotal);
    case "difference":
      return dir * (a.difference - b.difference);
    case "quality":
      return dir * str(a.qualityStatus).localeCompare(str(b.qualityStatus), "pt-BR");
    case "issueDate":
    default: {
      const ta = a.issueDate ? new Date(a.issueDate).getTime() : 0;
      const tb = b.issueDate ? new Date(b.issueDate).getTime() : 0;
      return dir * (ta - tb);
    }
  }
}

export type LoadMonthlyReceivablesReportInput = {
  query: Record<string, unknown>;
  emitterName?: string | null;
  referenceDate?: Date;
};

export async function loadSalesOrderMonthlyReceivablesReportPayload(
  prisma: PrismaClient,
  input: LoadMonthlyReceivablesReportInput
): Promise<SalesOrderMonthlyReceivablesReportPayload> {
  const now = input.referenceDate ?? new Date();
  const defaults = defaultDueMonthRange(now);
  const listQuery = parseSalesOrderListQuery(input.query);

  const dueMonthFrom =
    parseYearMonthKey(String(input.query.dueMonthFrom ?? "")) != null
      ? String(input.query.dueMonthFrom).trim()
      : defaults.dueMonthFrom;
  const dueMonthTo =
    parseYearMonthKey(String(input.query.dueMonthTo ?? "")) != null
      ? String(input.query.dueMonthTo).trim()
      : defaults.dueMonthTo;

  const months = buildMonthColumns(dueMonthFrom, dueMonthTo);
  const periodTooWide = months.length > SALES_ORDER_MONTHLY_RECEIVABLES_MAX_MONTHS;
  const monthKeys = periodTooWide
    ? months.slice(0, SALES_ORDER_MONTHLY_RECEIVABLES_MAX_MONTHS).map((m) => m.key)
    : months.map((m) => m.key);
  const monthColumns = periodTooWide
    ? months.slice(0, SALES_ORDER_MONTHLY_RECEIVABLES_MAX_MONTHS)
    : months;

  const includeCancelled = parseBool(input.query.includeCancelled);
  const onlyDivergent = parseBool(input.query.onlyDivergent);
  const onlyIncompleteAgenda = parseBool(input.query.onlyIncompleteAgenda);
  const financialSituation = parseFinancialSituation(input.query.financialSituation);
  const origin = parseOrigin(input.query.origin);
  const company =
    String(input.query.company ?? input.query.companyIssuer ?? "").trim() || null;
  const orderCodeFilter =
    String(input.query.orderCode ?? input.query.document ?? "").trim() || null;

  const page = parsePage(input.query.page, 1);
  const pageSize = Math.min(
    200,
    Math.max(10, parsePage(input.query.pageSize, SALES_ORDER_MONTHLY_RECEIVABLES_PAGE_SIZE_DEFAULT))
  );
  const { sortBy, sortDir } = parseSort(input.query.sortBy);
  const sortDirParam = String(input.query.sortDir ?? "desc").toLowerCase() === "asc"
    ? "asc"
    : "desc";

  const sellerWhere = await resolveSalesOrderListSellerWhere(prisma, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  const where = await resolveSalesOrderListWhere(prisma, listQuery, sellerWhere);
  if (company) {
    Object.assign(where, {
      AND: [
        ...(Array.isArray((where as { AND?: unknown[] }).AND)
          ? ((where as { AND: unknown[] }).AND ?? [])
          : []),
        { companyIssuer: { contains: company, mode: "insensitive" } },
      ],
    });
  }
  if (orderCodeFilter) {
    Object.assign(where, {
      AND: [
        ...(Array.isArray((where as { AND?: unknown[] }).AND)
          ? ((where as { AND: unknown[] }).AND ?? [])
          : []),
        { orderCode: { contains: orderCodeFilter, mode: "insensitive" } },
      ],
    });
  }
  if (!includeCancelled) {
    Object.assign(where, {
      status: { notIn: ["CANCELLED", "ERROR"] },
    });
  }

  const orders = await prisma.salesOrder.findMany({
    where,
    select: {
      id: true,
      orderCode: true,
      status: true,
      issueDate: true,
      totalNetValue: true,
      nomusSellerName: true,
      responsible: true,
      sourcePresenceStatus: true,
      companyIssuer: true,
      Customer: { select: { companyName: true, tradeName: true, taxId: true } },
      externalCustomerId: true,
    },
    orderBy: { issueDate: "desc" },
    take: SALES_ORDER_MONTHLY_RECEIVABLES_ROWS_LIMIT + 1,
  });

  const truncated = orders.length > SALES_ORDER_MONTHLY_RECEIVABLES_ROWS_LIMIT;
  const scoped = orders.slice(0, SALES_ORDER_MONTHLY_RECEIVABLES_ROWS_LIMIT);
  const warnings: string[] = [];
  if (periodTooWide) {
    warnings.push(
      `Intervalo limitado a ${SALES_ORDER_MONTHLY_RECEIVABLES_MAX_MONTHS} meses. Exporte ou reduza o período.`
    );
  }
  if (truncated) {
    warnings.push(
      `População truncada em ${SALES_ORDER_MONTHLY_RECEIVABLES_ROWS_LIMIT} pedidos. Refine os filtros.`
    );
  }

  const builtRows: SalesOrderMonthlyReceivablesRow[] = [];
  for (let i = 0; i < scoped.length; i += CONCURRENCY) {
    const slice = scoped.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      slice.map(async (order) => {
        if (
          !includeCancelled &&
          !shouldIncludeSalesOrderInOperationalReceivables({
            status: order.status,
            sourcePresenceStatus: order.sourcePresenceStatus,
          })
        ) {
          return null;
        }
        try {
          const audit = await getOrderFullAudit({
            salesOrderId: order.id,
            orderCode: order.orderCode,
          });
          if (!("ok" in audit) || audit.ok !== true) {
            return buildMonthlyReceivablesRowFromLines({
              salesOrderId: order.id,
              orderCode: order.orderCode,
              customerName: customerDisplayName(order.Customer),
              issueDate: isoOrNull(order.issueDate),
              sellerName:
                order.nomusSellerName?.trim() ||
                order.responsible?.trim() ||
                "—",
              status: order.status,
              statusLabel: formatSalesOrderReportStatusLabel(order.status),
              orderCommercialTotal: getSalesOrderNetValue(order),
              monthKeys,
              lines: [],
              hasIncompleteAgenda: true,
              warnings: ["Falha ao carregar agenda efetiva do pedido."],
            });
          }
          const scheduleInput = buildEffectiveScheduleInputFromAudit(audit, now);
          const schedule = buildSalesOrderEffectiveFinancialSchedule(scheduleInput);
          let lines = listEffectiveReceivableLinesFromSchedule({
            schedule,
            personId: order.externalCustomerId,
            personName: customerDisplayName(order.Customer),
            personCnpj: order.Customer?.taxId ?? null,
            companyName: order.companyIssuer,
            referenceDate: now,
          });
          lines = lines.filter(
            (line) =>
              lineMatchesFinancialSituation(line, financialSituation) &&
              lineMatchesOrigin(line, origin === "mixed" ? "all" : origin)
          );

          const hasIncomplete =
            Number(schedule.coverageSummary.unresolvedAmount) > 0.009 ||
            schedule.alerts.some((a) =>
              String(a.code ?? "").includes("INCOMPLETE") ||
              String(a.code ?? "").includes("PENDING")
            );
          const hasLinkWarning = schedule.alerts.some((a) =>
            String(a.code ?? "").includes("WITHOUT_REAL_CR")
          );

          return buildMonthlyReceivablesRowFromLines({
            salesOrderId: order.id,
            orderCode: order.orderCode,
            customerName: customerDisplayName(order.Customer),
            issueDate: isoOrNull(order.issueDate),
            sellerName:
              order.nomusSellerName?.trim() || order.responsible?.trim() || "—",
            status: order.status,
            statusLabel: formatSalesOrderReportStatusLabel(order.status),
            orderCommercialTotal: getSalesOrderNetValue(order),
            monthKeys,
            lines,
            hasIncompleteAgenda: hasIncomplete,
            hasLinkWarning,
            warnings: schedule.alerts.slice(0, 3).map((a) => a.message || a.code),
          });
        } catch (err) {
          console.error(
            "loadSalesOrderMonthlyReceivablesReportPayload",
            order.orderCode,
            err
          );
          return buildMonthlyReceivablesRowFromLines({
            salesOrderId: order.id,
            orderCode: order.orderCode,
            customerName: customerDisplayName(order.Customer),
            issueDate: isoOrNull(order.issueDate),
            sellerName:
              order.nomusSellerName?.trim() || order.responsible?.trim() || "—",
            status: order.status,
            statusLabel: formatSalesOrderReportStatusLabel(order.status),
            orderCommercialTotal: getSalesOrderNetValue(order),
            monthKeys,
            lines: [],
            hasIncompleteAgenda: true,
            warnings: ["Erro ao resolver agenda efetiva."],
          });
        }
      })
    );
    for (const row of settled) {
      if (row) builtRows.push(row);
    }
  }

  let filtered = builtRows.filter((row) => {
    // Vencimento DE/ATÉ: só pedidos com ao menos um título no período (após demais filtros de linha).
    if (!rowHasReceivablesInSelectedPeriod(row)) return false;
    if (onlyDivergent && Math.abs(row.difference) <= 1) return false;
    if (onlyIncompleteAgenda && !row.hasIncompleteAgenda && row.qualityStatus !== "SEM_AGENDA") {
      return false;
    }
    if (origin === "mixed" && !rowMatchesOriginFilter(row, "mixed")) return false;
    return true;
  });

  filtered.sort((a, b) => compareRows(a, b, sortBy, sortDirParam));

  const totals = computeMonthlyReceivablesTotalsFromRows(filtered, monthKeys);
  const totalRows = filtered.length;
  const includeAllRows = parseBool(input.query.includeAllRows);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = includeAllRows
    ? filtered
    : filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const appliedFilters: SalesOrderMonthlyReceivablesReportFilters = {
    year: listQuery.year,
    month: listQuery.month,
    status: listQuery.status ?? "",
    customerId: listQuery.customerId ?? "",
    customerName: null,
    sellerKey: listQuery.sellerKeyRaw ?? "",
    sellerLabel: null,
    startDate: listQuery.startDate ? listQuery.startDate.toISOString().slice(0, 10) : null,
    endDate: listQuery.endDate ? listQuery.endDate.toISOString().slice(0, 10) : null,
    search: listQuery.q ?? "",
    dueMonthFrom,
    dueMonthTo,
    issueDateFrom: listQuery.startDate
      ? listQuery.startDate.toISOString().slice(0, 10)
      : null,
    issueDateTo: listQuery.endDate ? listQuery.endDate.toISOString().slice(0, 10) : null,
    financialSituation,
    origin,
    onlyDivergent,
    onlyIncompleteAgenda,
    includeCancelled,
    company,
    orderCode: orderCodeFilter,
  };

  const filterLabels = [
    ...buildSalesOrderReportFilterLabels({
      customerId: appliedFilters.customerId,
      customerName: appliedFilters.customerName,
      status: appliedFilters.status,
      sellerKey: appliedFilters.sellerKey,
      sellerLabel: appliedFilters.sellerLabel,
      startDate: appliedFilters.startDate,
      endDate: appliedFilters.endDate,
      year: appliedFilters.year,
      month: appliedFilters.month,
      search: appliedFilters.search,
    }),
    { label: "Vencimento de", value: dueMonthFrom },
    { label: "Vencimento até", value: dueMonthTo },
    {
      label: "Situação financeira",
      value: financialSituation,
    },
    { label: "Origem", value: origin },
  ];

  return {
    generatedAt: now.toISOString(),
    emitterName: input.emitterName ?? null,
    title: SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_TITLE,
    subtitle: SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_SUBTITLE,
    filters: appliedFilters,
    filterLabels,
    period: {
      startMonth: dueMonthFrom,
      endMonth: dueMonthTo,
      months: monthColumns,
      monthCount: monthColumns.length,
      maxMonths: SALES_ORDER_MONTHLY_RECEIVABLES_MAX_MONTHS,
      periodTooWide,
    },
    totals,
    pagination: {
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
    },
    rows: pageRows,
    truncated,
    totalOrdersInScope: scoped.length,
    rowsLimit: SALES_ORDER_MONTHLY_RECEIVABLES_ROWS_LIMIT,
    warnings,
  };
}

/** Drilldown de uma célula (pedido + mês opcional). */
export async function loadSalesOrderMonthlyReceivablesDetail(
  prisma: PrismaClient,
  input: {
    salesOrderId: string;
    monthKey?: string | null;
    referenceDate?: Date;
  }
): Promise<SalesOrderMonthlyReceivablesDetailPayload | null> {
  const now = input.referenceDate ?? new Date();
  const order = await prisma.salesOrder.findUnique({
    where: { id: input.salesOrderId },
    select: {
      id: true,
      orderCode: true,
      externalCustomerId: true,
      companyIssuer: true,
      Customer: { select: { companyName: true, tradeName: true, taxId: true } },
    },
  });
  if (!order) return null;

  const audit = await getOrderFullAudit({
    salesOrderId: order.id,
    orderCode: order.orderCode,
  });
  if (!("ok" in audit) || audit.ok !== true) return null;

  const schedule = buildSalesOrderEffectiveFinancialSchedule(
    buildEffectiveScheduleInputFromAudit(audit, now)
  );
  let lines = listEffectiveReceivableLinesFromSchedule({
    schedule,
    personId: order.externalCustomerId,
    personName: customerDisplayName(order.Customer),
    personCnpj: order.Customer?.taxId ?? null,
    companyName: order.companyIssuer,
    referenceDate: now,
  });

  const monthKey = input.monthKey?.trim() || null;
  if (monthKey) {
    lines = lines.filter((l) => yearMonthKeyFromDueIso(l.dueDate) === monthKey);
  }

  const detailLines = lines.map(mapEffectiveLineToDetail);
  const totalAmount = detailLines.reduce((s, l) => s + l.amount, 0);
  const monthCol = monthKey
    ? buildMonthColumns(monthKey, monthKey)[0] ?? null
    : null;

  return {
    salesOrderId: order.id,
    orderCode: order.orderCode,
    customerName: customerDisplayName(order.Customer),
    monthKey,
    monthLabel: monthCol?.label ?? null,
    totalAmount: Math.round(totalAmount * 100) / 100,
    titleCount: detailLines.length,
    lines: detailLines,
  };
}
