import { Prisma } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { buildFleetDashboardCards } from "@/src/lib/fleetManagementOps.js";
import { buildNomusAutoApplyBomDashboard } from "@/src/lib/nomusAutoApplyBomDashboard.js";
import {
  canSeeCrmActivity,
  canSeeCustomers,
  canSeeFleet,
  canSeeNomus,
  canSeePeople,
  canSeeProducts,
  canSeeProposals,
  canSeeSalesOrders,
  decimalToNumber,
  endOfMonth,
  endOfPreviousMonth,
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatMetricCount,
  safeMetricNumber,
  startOfMonth,
  startOfPreviousMonth,
  unavailableSection,
} from "@/src/lib/executiveDashboardHelpers.js";
import type {
  ExecutiveAlert,
  ExecutiveCommercial,
  ExecutiveCustomers,
  ExecutiveDashboardSummary,
  ExecutiveFleet,
  ExecutiveNomus,
  ExecutiveOverview,
  ExecutivePeople,
  ExecutiveProducts,
  ExecutiveQuickLink,
} from "@/src/lib/executiveDashboardTypes.js";
import {
  orderInvoicedInPeriodSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";

const OPEN_ORDER_STATUSES = ["DRAFT", "READY_TO_SEND"] as const;

async function queryInvoicedInPeriod(from: Date, to: Date): Promise<{ count: number | null; net: number | null }> {
  const fromYmd = toPgDateYmd(from);
  const toYmd = toPgDateYmd(to);
  const [row] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so
      WHERE so.status != 'CANCELLED'
        AND ${orderInvoicedInPeriodSql("so", fromYmd, toYmd)}
    `
  );
  return {
    count: safeMetricNumber(Number(row?.c ?? 0n)),
    net: decimalToNumber(row?.v),
  };
}

async function buildCommercialSection(
  user: AppAuthContext,
  now: Date
): Promise<ExecutiveCommercial> {
  const base: ExecutiveCommercial = {
    available: false,
    source:
      "SalesOrder (issueDate para emissão; nomusRawResponse.nfes.dataProcessamento para faturamento)",
    periodLabel: now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    ordersThisMonth: null,
    ordersNetThisMonth: null,
    invoicedNetThisMonth: null,
    invoicedOrdersThisMonth: null,
    ticketAvgThisMonth: null,
    openOrdersCount: null,
    sentToNomusCount: null,
    previousMonthOrders: null,
    previousMonthNet: null,
    previousMonthInvoicedNet: null,
  };

  if (!canSeeSalesOrders(user)) {
    return unavailableSection(base, "Sem permissão sales_orders.view para indicadores comerciais.");
  }

  base.available = true;
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const prevStart = startOfPreviousMonth(now);
  const prevEnd = endOfPreviousMonth(now);

  const notCancelled = { status: { not: "CANCELLED" as const } };
  const issueInMonth = { issueDate: { gte: monthStart, lte: monthEnd }, ...notCancelled };
  const issueInPrevMonth = { issueDate: { gte: prevStart, lte: prevEnd }, ...notCancelled };

  const [monthAgg, openCount, sentCount, prevAgg, invoicedMonth, invoicedPrev] = await Promise.all([
    prisma.salesOrder.aggregate({
      where: issueInMonth,
      _count: true,
      _sum: { totalNetValue: true },
    }),
    prisma.salesOrder.count({ where: { status: { in: [...OPEN_ORDER_STATUSES] } } }),
    prisma.salesOrder.count({ where: { status: "SENT_TO_NOMUS", ...notCancelled } }),
    prisma.salesOrder.aggregate({
      where: issueInPrevMonth,
      _count: true,
      _sum: { totalNetValue: true },
    }),
    queryInvoicedInPeriod(monthStart, monthEnd),
    queryInvoicedInPeriod(prevStart, prevEnd),
  ]);

  const count = safeMetricNumber(monthAgg._count);
  const net = decimalToNumber(monthAgg._sum.totalNetValue);

  base.ordersThisMonth = count;
  base.ordersNetThisMonth = net;
  base.invoicedOrdersThisMonth = invoicedMonth.count;
  base.invoicedNetThisMonth = invoicedMonth.net;
  base.ticketAvgThisMonth =
    count != null && count > 0 && net != null ? net / count : count === 0 ? 0 : null;
  base.openOrdersCount = safeMetricNumber(openCount);
  base.sentToNomusCount = safeMetricNumber(sentCount);
  base.previousMonthOrders = safeMetricNumber(prevAgg._count);
  base.previousMonthNet = decimalToNumber(prevAgg._sum.totalNetValue);
  base.previousMonthInvoicedNet = invoicedPrev.net;

  return base;
}

async function buildCustomersSection(user: AppAuthContext, now: Date): Promise<ExecutiveCustomers> {
  const base: ExecutiveCustomers = {
    available: false,
    source: "Customer + CustomerCnpjLookup + CommercialActivity",
    totalCustomers: null,
    activeCustomers: null,
    incompleteRegistration: null,
    newLast30Days: null,
    cnpjLookupsLast30Days: null,
    overdueFollowUps: null,
  };

  if (!canSeeCustomers(user)) {
    return unavailableSection(base, "Sem permissão customers.view.");
  }

  base.available = true;
  const since30 = new Date(now);
  since30.setUTCDate(since30.getUTCDate() - 30);

  const [total, active, incomplete, newCount, cnpjCount] = await Promise.all([
    prisma.customer.count(),
    prisma.customer.count({ where: { status: "ACTIVE" } }),
    prisma.customer.count({
      where: {
        OR: [{ state: null }, { state: "" }, { email: null }, { email: "" }],
      },
    }),
    prisma.customer.count({ where: { createdAt: { gte: since30 } } }),
    prisma.customerCnpjLookup.count({ where: { fetchedAt: { gte: since30 } } }),
  ]);

  base.totalCustomers = safeMetricNumber(total);
  base.activeCustomers = safeMetricNumber(active);
  base.incompleteRegistration = safeMetricNumber(incomplete);
  base.newLast30Days = safeMetricNumber(newCount);
  base.cnpjLookupsLast30Days = safeMetricNumber(cnpjCount);

  if (canSeeCrmActivity(user)) {
    const [overdueRow] = await prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c
        FROM "CommercialActivity" a
        WHERE a."nextActionAt" IS NOT NULL
          AND a."nextActionAt" < ${now}
          AND (
            a."status" IS NULL
            OR LOWER(TRIM(a."status")) NOT IN ('done', 'closed', 'cancelled', 'canceled')
          )
      `
    );
    base.overdueFollowUps = safeMetricNumber(Number(overdueRow?.c ?? 0n));
  }

  return base;
}

async function buildProductsSection(user: AppAuthContext): Promise<ExecutiveProducts> {
  const base: ExecutiveProducts = {
    available: false,
    source: "Product + ProductBOM + ProductPricing (counts)",
    activeProducts: null,
    withProductBom: null,
    withPricing: null,
    manufacturedProducts: null,
  };

  if (!canSeeProducts(user)) {
    return unavailableSection(base, "Sem permissão products.view.");
  }

  base.available = true;
  const [active, withBom, withPricing, manufactured] = await Promise.all([
    prisma.product.count({ where: { status: "ACTIVE" } }),
    prisma.product.count({
      where: { status: "ACTIVE", ProductBOM: { some: {} } },
    }),
    prisma.productPricing.count(),
    prisma.product.count({
      where: { status: "ACTIVE", type: "PRODUCT" },
    }),
  ]);

  base.activeProducts = safeMetricNumber(active);
  base.withProductBom = safeMetricNumber(withBom);
  base.withPricing = safeMetricNumber(withPricing);
  base.manufacturedProducts = safeMetricNumber(manufactured);
  return base;
}

async function buildNomusSection(user: AppAuthContext): Promise<ExecutiveNomus> {
  const base: ExecutiveNomus = {
    available: false,
    source: "buildNomusAutoApplyBomDashboard (read-only, sem revalidação)",
    lastSyncAt: null,
    hasReport: false,
    blocked: null,
    applied: null,
    noChanges: null,
    pendingReview: null,
    errors: null,
    emptyMessage: null,
  };

  if (!canSeeNomus(user)) {
    return unavailableSection(base, "Sem permissão para indicadores Nomus/engenharia.");
  }

  base.available = true;
  try {
    const dash = await buildNomusAutoApplyBomDashboard({ revalidateBlocked: false });
    base.hasReport = dash.hasReport;
    base.lastSyncAt = dash.lastRun?.finishedAt ?? dash.generatedAt ?? null;
    base.emptyMessage = dash.emptyMessage;
    const totals = dash.totals ?? dash.batchTotals;
    if (totals) {
      base.blocked = safeMetricNumber(totals.parentsBlocked);
      base.applied = safeMetricNumber(totals.parentsApplied);
      base.noChanges = safeMetricNumber(totals.parentsNoChanges);
      base.errors = safeMetricNumber(totals.parentsErrored);
      const skipped = safeMetricNumber(totals.parentsSkipped) ?? 0;
      const blocked = base.blocked ?? 0;
      base.pendingReview = blocked + skipped;
    } else if (dash.filterCounts) {
      base.blocked = safeMetricNumber(dash.filterCounts.BLOCKED);
      base.applied = safeMetricNumber(dash.filterCounts.APPLIED);
      base.noChanges = safeMetricNumber(dash.filterCounts.NO_CHANGES);
      base.errors = safeMetricNumber(dash.filterCounts.ERROR);
      base.pendingReview = safeMetricNumber(
        (dash.filterCounts.BLOCKED ?? 0) +
          (dash.filterCounts.LOCAL_PENDING ?? 0) +
          (dash.filterCounts.OPTIONAL_PENDING ?? 0)
      );
    }
  } catch {
    base.emptyMessage = "Não foi possível carregar resumo Nomus.";
  }

  return base;
}

async function buildFleetSection(user: AppAuthContext): Promise<ExecutiveFleet> {
  const base: ExecutiveFleet = {
    available: false,
    source: "buildFleetDashboardCards",
    totalVehicles: null,
    vehiclesAvailable: null,
    inUse: null,
    maintenance: null,
    blocked: null,
    openMaintenances: null,
    maintenanceOverdue: null,
    reservationsToday: null,
    documentsExpired: null,
  };

  if (!canSeeFleet(user)) {
    return unavailableSection(base, "Sem permissão para módulo Frota.");
  }

  base.available = true;
  const cards = await buildFleetDashboardCards();
  base.totalVehicles = safeMetricNumber(cards.totalVehicles);
  base.vehiclesAvailable = safeMetricNumber(cards.available);
  base.inUse = safeMetricNumber(cards.inUse);
  base.maintenance = safeMetricNumber(cards.maintenance);
  base.blocked = safeMetricNumber(cards.blocked);
  base.openMaintenances = safeMetricNumber(cards.openMaintenances);
  base.maintenanceOverdue = safeMetricNumber(cards.maintenanceOverdue);
  base.reservationsToday = safeMetricNumber(cards.reservationsToday);
  base.documentsExpired = safeMetricNumber(cards.documentsExpired);
  return base;
}

async function buildPeopleSection(user: AppAuthContext): Promise<ExecutivePeople> {
  const base: ExecutivePeople = {
    available: false,
    source: "Employee (status ACTIVE)",
    activeEmployees: null,
  };

  if (!canSeePeople(user)) {
    return unavailableSection(base, "Sem permissão employees.view.");
  }

  base.available = true;
  const count = await prisma.employee.count({ where: { status: "ACTIVE" } });
  base.activeEmployees = safeMetricNumber(count);
  return base;
}

function buildAlerts(input: {
  commercial: ExecutiveCommercial;
  customers: ExecutiveCustomers;
  nomus: ExecutiveNomus;
  fleet: ExecutiveFleet;
}): ExecutiveAlert[] {
  const alerts: ExecutiveAlert[] = [];

  if (input.nomus.available && (input.nomus.blocked ?? 0) > 0) {
    alerts.push({
      id: "nomus-blocked",
      severity: "warning",
      title: "Produtos bloqueados no Nomus",
      message: `${formatMetricCount(input.nomus.blocked)} produto(s) com bloqueio na rotina BOM.`,
      href: "/products",
      count: input.nomus.blocked ?? undefined,
    });
  }

  if (input.fleet.available && (input.fleet.maintenanceOverdue ?? 0) > 0) {
    alerts.push({
      id: "fleet-maintenance-overdue",
      severity: "critical",
      title: "Manutenções atrasadas",
      message: `${formatMetricCount(input.fleet.maintenanceOverdue)} manutenção(ões) em atraso.`,
      href: "/fleet",
      count: input.fleet.maintenanceOverdue ?? undefined,
    });
  }

  if (input.fleet.available && (input.fleet.documentsExpired ?? 0) > 0) {
    alerts.push({
      id: "fleet-documents-expired",
      severity: "warning",
      title: "Documentos de frota vencidos",
      message: `${formatMetricCount(input.fleet.documentsExpired)} documento(s) vencido(s).`,
      href: "/fleet",
      count: input.fleet.documentsExpired ?? undefined,
    });
  }

  if (input.customers.available && (input.customers.overdueFollowUps ?? 0) > 0) {
    alerts.push({
      id: "crm-followup-overdue",
      severity: "warning",
      title: "Follow-ups comerciais atrasados",
      message: `${formatMetricCount(input.customers.overdueFollowUps)} atividade(s) com retorno pendente.`,
      href: "/crm-commercial",
      count: input.customers.overdueFollowUps ?? undefined,
    });
  }

  if (input.customers.available && (input.customers.incompleteRegistration ?? 0) > 0) {
    alerts.push({
      id: "customers-incomplete",
      severity: "info",
      title: "Cadastros incompletos",
      message: `${formatMetricCount(input.customers.incompleteRegistration)} cliente(s) com UF ou e-mail ausente.`,
      href: "/customers",
      count: input.customers.incompleteRegistration ?? undefined,
    });
  }

  if (input.commercial.available && (input.commercial.openOrdersCount ?? 0) > 0) {
    alerts.push({
      id: "orders-open",
      severity: "info",
      title: "Pedidos em aberto",
      message: `${formatMetricCount(input.commercial.openOrdersCount)} pedido(s) aguardando envio/processamento.`,
      href: "/sales-orders",
      count: input.commercial.openOrdersCount ?? undefined,
    });
  }

  return alerts.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 };
    return rank[a.severity] - rank[b.severity];
  });
}

/** KPIs principais da visão executiva — somente pedidos de venda (sem propostas). */
export function buildExecutiveOverview(
  commercial: ExecutiveCommercial,
  customers: ExecutiveCustomers,
  fleet: ExecutiveFleet,
  alerts: ExecutiveAlert[]
): ExecutiveOverview {
  const kpis: ExecutiveOverview["kpis"] = [];

  if (commercial.available && commercial.ordersThisMonth != null) {
    kpis.push({
      id: "orders-count-month",
      label: "Pedidos do mês",
      value: commercial.ordersThisMonth,
      formatted: formatExecutiveInteger(commercial.ordersThisMonth),
      hint: commercial.periodLabel,
      href: "/sales-orders",
    });
  }

  if (commercial.available && commercial.invoicedNetThisMonth != null) {
    kpis.push({
      id: "invoiced-net-month",
      label: "Faturamento líquido do mês",
      value: commercial.invoicedNetThisMonth,
      formatted: formatExecutiveCurrency(commercial.invoicedNetThisMonth),
      hint: "NFe com dataProcessamento no mês",
      href: "/sales-orders",
    });
  }

  if (customers.available && customers.activeCustomers != null) {
    kpis.push({
      id: "customers-active",
      label: "Clientes ativos",
      value: customers.activeCustomers,
      formatted: formatExecutiveInteger(customers.activeCustomers),
      href: "/customers",
    });
  } else if (customers.available && customers.totalCustomers != null) {
    kpis.push({
      id: "customers-total",
      label: "Clientes cadastrados",
      value: customers.totalCustomers,
      formatted: formatExecutiveInteger(customers.totalCustomers),
      href: "/customers",
    });
  }

  if (fleet.available && (fleet.inUse != null || fleet.maintenance != null)) {
    const inUse = fleet.inUse ?? 0;
    const maint = fleet.maintenance ?? 0;
    kpis.push({
      id: "fleet-in-use-maintenance",
      label: "Veículos em uso / manutenção",
      value: inUse + maint,
      formatted: `${formatExecutiveInteger(inUse)} / ${formatExecutiveInteger(maint)}`,
      href: "/fleet",
    });
  }

  kpis.push({
    id: "alerts-count",
    label: "Alertas ativos",
    value: alerts.length,
    formatted: formatExecutiveInteger(alerts.length),
    hint: "Consolidado das áreas visíveis",
  });

  return {
    available: kpis.length > 0,
    source: "SalesOrder + seções disponíveis (sem propostas)",
    alertCount: alerts.length,
    kpis,
  };
}

function buildQuickLinks(user: AppAuthContext): ExecutiveQuickLink[] {
  const links: ExecutiveQuickLink[] = [];
  if (canSeeSalesOrders(user)) {
    links.push({ id: "sales-orders", label: "Pedidos de venda", href: "/sales-orders", moduleId: "sales_orders" });
  }
  if (canSeeProposals(user)) {
    links.push({ id: "proposals", label: "Propostas", href: "/proposals", moduleId: "proposals" });
  }
  if (canSeeCustomers(user)) {
    links.push({ id: "customers", label: "Clientes", href: "/customers", moduleId: "customers" });
  }
  if (canSeeProducts(user)) {
    links.push({ id: "products", label: "Produtos", href: "/products", moduleId: "products" });
  }
  if (canSeeNomus(user)) {
    links.push({ id: "nomus", label: "Central Nomus", href: "/products", moduleId: "products" });
  }
  if (canSeeFleet(user)) {
    links.push({ id: "fleet", label: "Frota", href: "/fleet", moduleId: "fleet" });
  }
  links.push({ id: "settings", label: "Configurações", href: "/settings", moduleId: "settings" });
  return links;
}

export async function buildExecutiveDashboardSummary(
  user: AppAuthContext
): Promise<ExecutiveDashboardSummary> {
  const now = new Date();

  const [commercial, customers, products, nomus, fleet, people] = await Promise.all([
    buildCommercialSection(user, now),
    buildCustomersSection(user, now),
    buildProductsSection(user),
    buildNomusSection(user),
    buildFleetSection(user),
    buildPeopleSection(user),
  ]);

  const alerts = buildAlerts({ commercial, customers, nomus, fleet });
  const overview = buildExecutiveOverview(commercial, customers, fleet, alerts);

  return {
    generatedAt: now.toISOString(),
    overview,
    commercial,
    customers,
    products,
    nomus,
    fleet,
    people,
    alerts,
    quickLinks: buildQuickLinks(user),
    industrialLegacyAvailable: true,
  };
}
