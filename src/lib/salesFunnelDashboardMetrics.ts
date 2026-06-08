import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  decimalToNumber,
} from "@/src/lib/executiveDashboardHelpers.js";
import {
  endOfYear,
  startOfYear,
} from "@/src/lib/executiveDashboardWorkdays.js";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters.js";
import type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
import { SALES_ORDER_STATUS_LABELS } from "@/src/lib/materialDemandFilters.js";
import {
  computeDaysOpen,
  computeFunnelPercent,
  SALES_FUNNEL_STAGE_DESCRIPTIONS,
} from "@/src/lib/salesFunnelDashboardRules.js";
import {
  computeTicketAverage,
  computeDaysOverdue,
  isOverdueSalesOrderInSelectedYear,
} from "@/src/lib/salesOrderDashboardRules.js";
import {
  orderIsInvoicedSql,
  orderNotInvoicedSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";
import type {
  DashboardMetricCard,
  DashboardStatusBreakdownRow,
  SalesFunnelConversionMonth,
  SalesFunnelCriticalOrderRow,
  SalesFunnelDashboardTab,
  SalesFunnelMonthlyPoint,
  SalesFunnelOpenCustomerRow,
  SalesFunnelStage,
} from "@/src/lib/executiveDashboardTypes.js";

const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const TOP_CUSTOMERS_LIMIT = 10;
const CRITICAL_ORDERS_LIMIT = 15;
const OPEN_DAYS_THRESHOLD = 30;

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;
const IS_INVOICED = orderIsInvoicedSql("so");
const NOT_INVOICED = orderNotInvoicedSql("so");

function metricCard(
  id: string,
  label: string,
  value: number | null,
  opts?: { hint?: string; asCurrency?: boolean; compact?: boolean; asPercent?: boolean; countLabel?: string }
): DashboardMetricCard {
  const formatted = opts?.asPercent
    ? formatExecutivePercent(value, 1)
    : opts?.asCurrency
      ? formatExecutiveCurrency(value)
      : formatExecutiveInteger(value);
  return {
    id,
    label,
    value,
    formatted,
    compactFormatted: opts?.compact && opts?.asCurrency ? formatExecutiveCompactCurrency(value) : undefined,
    hint: opts?.hint,
  };
}

function formatStage(stage: {
  count: number | null;
  value: number | null;
  percentOfEmitted: number | null;
  percentOfValid: number | null;
}) {
  return {
    count: formatExecutiveInteger(stage.count),
    value: formatExecutiveCurrency(stage.value),
    compactValue: formatExecutiveCompactCurrency(stage.value),
    percentOfEmitted:
      stage.percentOfEmitted != null ? formatExecutivePercent(stage.percentOfEmitted, 1) : "—",
    percentOfValid:
      stage.percentOfValid != null ? formatExecutivePercent(stage.percentOfValid, 1) : "—",
  };
}

function buildStage(
  id: SalesFunnelStage["id"],
  label: string,
  description: string,
  count: number | null,
  value: number | null,
  emittedCount: number,
  validCount: number
): SalesFunnelStage {
  const percentOfEmitted = computeFunnelPercent(count ?? 0, emittedCount);
  const percentOfValid = computeFunnelPercent(count ?? 0, validCount);
  return {
    id,
    label,
    description,
    count: count ?? 0,
    value,
    percentOfEmitted,
    percentOfValid,
    formatted: formatStage({ count, value, percentOfEmitted, percentOfValid }),
  };
}

async function queryYearFunnelTotals(
  yearStart: Date,
  yearEnd: Date,
  todayYmd: string
): Promise<{
  emittedCount: number;
  emittedValue: number | null;
  validCount: number;
  validValue: number | null;
  invoicedCount: number;
  invoicedValue: number | null;
  openCount: number;
  openValue: number | null;
  overdueCount: number;
  overdueValue: number | null;
  cancelledCount: number;
  cancelledValue: number | null;
  avgDaysOverdue: number | null;
}> {
  const [row] = await prisma.$queryRaw<
    {
      emitted_count: bigint;
      emitted_value: unknown;
      valid_count: bigint;
      valid_value: unknown;
      invoiced_count: bigint;
      invoiced_value: unknown;
      open_count: bigint;
      open_value: unknown;
      overdue_count: bigint;
      overdue_value: unknown;
      cancelled_count: bigint;
      cancelled_value: unknown;
      avg_days_overdue: unknown;
    }[]
  >(
    Prisma.sql`
      SELECT
        COUNT(*)::bigint AS emitted_count,
        COALESCE(SUM(so."totalNetValue"), 0) AS emitted_value,
        COUNT(*) FILTER (WHERE ${NOT_CANCELLED})::bigint AS valid_count,
        COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${NOT_CANCELLED}), 0) AS valid_value,
        COUNT(*) FILTER (WHERE ${NOT_CANCELLED} AND ${IS_INVOICED})::bigint AS invoiced_count,
        COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${NOT_CANCELLED} AND ${IS_INVOICED}), 0) AS invoiced_value,
        COUNT(*) FILTER (WHERE ${NOT_CANCELLED} AND ${NOT_INVOICED})::bigint AS open_count,
        COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${NOT_CANCELLED} AND ${NOT_INVOICED}), 0) AS open_value,
        COUNT(*) FILTER (
          WHERE ${NOT_CANCELLED}
            AND ${NOT_INVOICED}
            AND so."expectedDeliveryDate" IS NOT NULL
            AND so."expectedDeliveryDate"::date < ${todayYmd}::date
        )::bigint AS overdue_count,
        COALESCE(SUM(so."totalNetValue") FILTER (
          WHERE ${NOT_CANCELLED}
            AND ${NOT_INVOICED}
            AND so."expectedDeliveryDate" IS NOT NULL
            AND so."expectedDeliveryDate"::date < ${todayYmd}::date
        ), 0) AS overdue_value,
        COUNT(*) FILTER (WHERE so.status = 'CANCELLED')::bigint AS cancelled_count,
        COALESCE(SUM(so."totalNetValue") FILTER (WHERE so.status = 'CANCELLED'), 0) AS cancelled_value,
        AVG(
          (${todayYmd}::date - so."expectedDeliveryDate"::date)
        ) FILTER (
          WHERE ${NOT_CANCELLED}
            AND ${NOT_INVOICED}
            AND so."expectedDeliveryDate" IS NOT NULL
            AND so."expectedDeliveryDate"::date < ${todayYmd}::date
        ) AS avg_days_overdue
      FROM "SalesOrder" so
      WHERE so."issueDate" >= ${yearStart}
        AND so."issueDate" <= ${yearEnd}
    `
  );

  return {
    emittedCount: Number(row?.emitted_count ?? 0n),
    emittedValue: decimalToNumber(row?.emitted_value),
    validCount: Number(row?.valid_count ?? 0n),
    validValue: decimalToNumber(row?.valid_value),
    invoicedCount: Number(row?.invoiced_count ?? 0n),
    invoicedValue: decimalToNumber(row?.invoiced_value),
    openCount: Number(row?.open_count ?? 0n),
    openValue: decimalToNumber(row?.open_value),
    overdueCount: Number(row?.overdue_count ?? 0n),
    overdueValue: decimalToNumber(row?.overdue_value),
    cancelledCount: Number(row?.cancelled_count ?? 0n),
    cancelledValue: decimalToNumber(row?.cancelled_value),
    avgDaysOverdue: decimalToNumber(row?.avg_days_overdue),
  };
}

async function queryMonthlyFunnel(year: number): Promise<
  Map<
    number,
    {
      issuedCount: number;
      issuedValue: number;
      invoicedCount: number;
      invoicedValue: number;
    }
  >
> {
  const yearStart = startOfYear(new Date(year, 0, 1));
  const yearEnd = endOfYear(new Date(year, 0, 1));
  const rows = await prisma.$queryRaw<
    {
      month: number;
      issued_count: bigint;
      issued_value: unknown;
      invoiced_count: bigint;
      invoiced_value: unknown;
    }[]
  >(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM so."issueDate")::int AS month,
        COUNT(*) FILTER (WHERE ${NOT_CANCELLED})::bigint AS issued_count,
        COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${NOT_CANCELLED}), 0) AS issued_value,
        COUNT(*) FILTER (WHERE ${NOT_CANCELLED} AND ${IS_INVOICED})::bigint AS invoiced_count,
        COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${NOT_CANCELLED} AND ${IS_INVOICED}), 0) AS invoiced_value
      FROM "SalesOrder" so
      WHERE so."issueDate" >= ${yearStart}
        AND so."issueDate" <= ${yearEnd}
      GROUP BY 1
      ORDER BY 1
    `
  );

  const map = new Map<number, { issuedCount: number; issuedValue: number; invoicedCount: number; invoicedValue: number }>();
  for (const row of rows) {
    map.set(row.month, {
      issuedCount: Number(row.issued_count),
      issuedValue: decimalToNumber(row.issued_value) ?? 0,
      invoicedCount: Number(row.invoiced_count),
      invoicedValue: decimalToNumber(row.invoiced_value) ?? 0,
    });
  }
  return map;
}

async function queryStatusBreakdown(yearStart: Date, yearEnd: Date): Promise<DashboardStatusBreakdownRow[]> {
  const rows = await prisma.$queryRaw<{ status: string; count: bigint; total: unknown }[]>(
    Prisma.sql`
      SELECT
        so.status::text AS status,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      WHERE so."issueDate" >= ${yearStart}
        AND so."issueDate" <= ${yearEnd}
      GROUP BY so.status
      ORDER BY count DESC
    `
  );
  return rows.map((row) => ({
    status: row.status,
    label: SALES_ORDER_STATUS_LABELS[row.status] ?? row.status,
    count: Number(row.count),
    value: decimalToNumber(row.total),
  }));
}

async function queryOpenPortfolioByCustomer(
  yearStart: Date,
  yearEnd: Date,
  today: Date
): Promise<SalesFunnelOpenCustomerRow[]> {
  const rows = await prisma.$queryRaw<
    {
      customer_id: string;
      customer_name: string;
      order_count: bigint;
      open_value: unknown;
      oldest_issue: Date;
    }[]
  >(
    Prisma.sql`
      SELECT
        c.id AS customer_id,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        COUNT(*)::bigint AS order_count,
        COALESCE(SUM(so."totalNetValue"), 0) AS open_value,
        MIN(so."issueDate") AS oldest_issue
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${NOT_CANCELLED}
        AND ${NOT_INVOICED}
        AND so."issueDate" >= ${yearStart}
        AND so."issueDate" <= ${yearEnd}
      GROUP BY c.id, customer_name
      ORDER BY open_value DESC
      LIMIT ${TOP_CUSTOMERS_LIMIT}
    `
  );

  return rows.map((row) => {
    const oldest = new Date(row.oldest_issue);
    return {
      customerId: row.customer_id,
      customerName: row.customer_name,
      orderCount: Number(row.order_count),
      openValue: decimalToNumber(row.open_value),
      oldestIssueDate: oldest.toISOString(),
      daysOpen: computeDaysOpen(oldest, today),
    };
  });
}

async function queryCriticalOrders(
  selectedYear: number,
  yearStart: Date,
  yearEnd: Date,
  todayYmd: string,
  today: Date
): Promise<SalesFunnelCriticalOrderRow[]> {
  const openSince = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  openSince.setDate(openSince.getDate() - OPEN_DAYS_THRESHOLD);
  const openSinceYmd = toPgDateYmd(openSince);

  const rows = await prisma.$queryRaw<
    {
      id: string;
      order_code: string;
      customer_name: string;
      issue_date: Date;
      expected_delivery_date: Date | null;
      total_net_value: unknown;
      status: string;
    }[]
  >(
    Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        so."issueDate" AS issue_date,
        so."expectedDeliveryDate" AS expected_delivery_date,
        so."totalNetValue" AS total_net_value,
        so.status::text AS status
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${NOT_CANCELLED}
        AND ${NOT_INVOICED}
        AND so."issueDate" >= ${yearStart}
        AND so."issueDate" <= ${yearEnd}
        AND (
          (
            so."expectedDeliveryDate" IS NOT NULL
            AND so."expectedDeliveryDate"::date < ${todayYmd}::date
          )
          OR so."issueDate"::date <= ${openSinceYmd}::date
        )
      ORDER BY
        CASE
          WHEN so."expectedDeliveryDate" IS NOT NULL
            AND so."expectedDeliveryDate"::date < ${todayYmd}::date
          THEN 0
          ELSE 1
        END,
        so."expectedDeliveryDate" ASC NULLS LAST,
        so."issueDate" ASC
      LIMIT ${CRITICAL_ORDERS_LIMIT}
    `
  );

  return rows.map((row) => {
    const issueDate = new Date(row.issue_date);
    const expectedDelivery = row.expected_delivery_date ? new Date(row.expected_delivery_date) : null;
    const isOverdue = isOverdueSalesOrderInSelectedYear({
      status: row.status,
      issueDate,
      selectedYear,
      expectedDeliveryDate: expectedDelivery,
      today,
      hasNfeDataProcessamento: false,
    });
    const daysOverdue =
      isOverdue && expectedDelivery ? computeDaysOverdue(expectedDelivery, today) : null;
    return {
      orderId: row.id,
      orderCode: row.order_code,
      customerName: row.customer_name,
      issueDate: issueDate.toISOString(),
      expectedDeliveryDate: expectedDelivery?.toISOString() ?? null,
      totalNetValue: decimalToNumber(row.total_net_value),
      status: row.status,
      statusLabel: SALES_ORDER_STATUS_LABELS[row.status] ?? row.status,
      isInvoiced: false,
      isOverdue,
      daysOverdue,
      daysOpen: computeDaysOpen(issueDate, today),
      priority: isOverdue ? "overdue" : "open",
    };
  });
}

export async function buildSalesFunnelDashboardTab(
  yearCtx: ExecutiveDashboardYearContext
): Promise<SalesFunnelDashboardTab> {
  const year = yearCtx.selectedYear;
  const yearStart = startOfYear(new Date(year, 0, 1));
  const yearEnd = endOfYear(new Date(year, 0, 1));
  const operationalNow = new Date();
  const todayYmd = toPgDateYmd(operationalNow);

  const [totals, monthlyMap, statusBreakdown, openPortfolioByCustomer, criticalOrders] =
    await Promise.all([
      queryYearFunnelTotals(yearStart, yearEnd, todayYmd),
      queryMonthlyFunnel(year),
      queryStatusBreakdown(yearStart, yearEnd),
      queryOpenPortfolioByCustomer(yearStart, yearEnd, operationalNow),
      queryCriticalOrders(year, yearStart, yearEnd, todayYmd, operationalNow),
    ]);

  const ticketAvg = computeTicketAverage(totals.validValue, totals.validCount);
  const invoicedPercent = computeFunnelPercent(totals.invoicedCount, totals.validCount);
  const openPercent = computeFunnelPercent(totals.openCount, totals.validCount);
  const cancelledPercent = computeFunnelPercent(totals.cancelledCount, totals.emittedCount);
  const billingConversion = computeFunnelPercent(
    totals.invoicedValue ?? 0,
    totals.validValue ?? 0
  );

  const funnelStages: SalesFunnelStage[] = [
    buildStage(
      "emitted",
      "Emitidos",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.emitted,
      totals.emittedCount,
      totals.emittedValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "valid",
      "Válidos",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.valid,
      totals.validCount,
      totals.validValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "openPortfolio",
      "Em carteira",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.openPortfolio,
      totals.openCount,
      totals.openValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "invoiced",
      "Faturados",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.invoiced,
      totals.invoicedCount,
      totals.invoicedValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "overdue",
      "Atrasados",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.overdue,
      totals.overdueCount,
      totals.overdueValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "cancelled",
      "Cancelados",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.cancelled,
      totals.cancelledCount,
      totals.cancelledValue,
      totals.emittedCount,
      totals.validCount
    ),
  ];

  const monthlyEvolution: SalesFunnelMonthlyPoint[] = MONTH_SHORT.map((monthLabel, idx) => {
    const month = idx + 1;
    const data = monthlyMap.get(month);
    const issuedCount = data?.issuedCount ?? 0;
    const invoicedCount = data?.invoicedCount ?? 0;
    return {
      month,
      monthLabel,
      issuedValue: data?.issuedValue ?? 0,
      invoicedValue: data?.invoicedValue ?? 0,
      openPortfolioValue: null,
      overdueValue: null,
      issuedCount,
      invoicedCount,
      conversionPercent: computeFunnelPercent(invoicedCount, issuedCount),
    };
  });

  const conversionByMonth: SalesFunnelConversionMonth[] = monthlyEvolution.map((point) => ({
    month: point.month,
    monthLabel: point.monthLabel,
    issuedCount: point.issuedCount,
    invoicedCount: point.invoicedCount,
    conversionPercent: point.conversionPercent,
  }));

  const summaryCards: DashboardMetricCard[] = [
    metricCard("funnel-emitted-count", "Pedidos emitidos", totals.emittedCount, {
      hint: `${formatExecutiveCurrency(totals.emittedValue)} no ano ${year}`,
    }),
    metricCard("funnel-emitted-value", "Valor emitido", totals.emittedValue, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("funnel-invoiced-count", "Faturados", totals.invoicedCount, {
      hint:
        invoicedPercent != null
          ? `${formatExecutivePercent(invoicedPercent, 1)} dos válidos`
          : undefined,
    }),
    metricCard("funnel-invoiced-value", "Valor faturado", totals.invoicedValue, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("funnel-open-count", "Carteira aberta", totals.openCount, {
      hint:
        openPercent != null ? `${formatExecutivePercent(openPercent, 1)} dos válidos` : undefined,
    }),
    metricCard("funnel-open-value", "Valor em aberto", totals.openValue, {
      asCurrency: true,
      compact: true,
      hint: `${formatExecutiveInteger(totals.overdueCount)} atrasados incluídos na carteira`,
    }),
    metricCard("funnel-overdue-count", "Atrasados", totals.overdueCount, {
      hint: SALES_FUNNEL_STAGE_DESCRIPTIONS.overdue,
    }),
    metricCard("funnel-overdue-value", "Valor atrasado", totals.overdueValue, {
      asCurrency: true,
      compact: true,
      hint:
        totals.avgDaysOverdue != null
          ? `Média ${formatExecutiveInteger(Math.round(totals.avgDaysOverdue))} dias de atraso`
          : undefined,
    }),
    metricCard("funnel-cancelled-count", "Cancelados", totals.cancelledCount, {
      hint:
        cancelledPercent != null
          ? `${formatExecutivePercent(cancelledPercent, 1)} dos emitidos`
          : undefined,
    }),
    metricCard("funnel-cancelled-value", "Valor cancelado", totals.cancelledValue, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("funnel-ticket", "Ticket médio", ticketAvg, { asCurrency: true }),
    metricCard("funnel-conversion", "Conversão p/ faturamento", billingConversion, {
      asPercent: true,
      hint: "Valor faturado ÷ valor emitido válido",
    }),
    metricCard("funnel-backlog", "Backlog comercial", totals.openValue, {
      asCurrency: true,
      compact: true,
      hint: `Carteira aberta (${formatExecutiveInteger(totals.overdueCount)} pedidos atrasados)`,
    }),
  ];

  return {
    available: true,
    source: "SalesOrder por issueDate; faturado via NF processada; carteira/atraso operacional",
    selectedYear: year,
    summaryCards,
    funnelStages,
    monthlyEvolution,
    statusBreakdown,
    conversionByMonth,
    openPortfolioByCustomer,
    criticalOrders,
    rules: [
      "Data comercial: issueDate do pedido.",
      "Valor: totalNetValue.",
      "Faturado: NF com data de processamento.",
      "Atrasados: emitidos no ano selecionado, entrega vencida, sem NF.",
      "Evolução mensal de carteira/atraso: pendente (snapshot histórico).",
    ],
    unavailableIndicators: [],
  };
}
