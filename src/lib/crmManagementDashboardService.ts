/**
 * Serviço do GET /api/crm/management-dashboard — cockpit do gestor comercial.
 *
 * ARQUITETURA (decisão de 17/08/2026):
 *   - Tudo que é PEDIDO vem da população canônica da tela Pedidos de Venda,
 *     via `loadCrmManagementOrderFacts` (Prisma + `buildSalesOrderListWhere`)
 *     e `loadCrmSalesOrderMetrics` (motor oficial). O CRM não decide o que é
 *     pedido válido, carteira, faturado, intercompany nem período.
 *   - Tudo que é RELACIONAMENTO (contato, follow-up, atividade) é métrica
 *     PRÓPRIA do CRM, calculada sobre `CommercialActivity` em janelas móveis
 *     declaradas — não reconcilia com Pedidos de Venda, e não deveria mesmo.
 *
 * O SQL cru que existia aqui reescrevia regra de pedido (status, carteira,
 * NF, intercompany) e foi removido: era a fonte das divergências.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import {
  buildManagementRiskReasons,
  buildManagementSuggestedAction,
  mgmtDaysSince,
  mgmtDisplayName,
  mgmtIso,
} from "@/src/lib/crmManagementDashboard";
import { orderHasFollowUpAfterCutoff } from "@/src/lib/crmOrderFollowUp";
import { loadCrmSalesOrderMetrics } from "@/src/lib/commercial/crmSalesOrderMetricsService.js";
import {
  CRM_RELATIONSHIP_HORIZON_MONTHS,
  loadCrmManagementOrderFacts,
} from "@/src/lib/commercial/crmManagementOrderFacts.server.js";
import {
  buildManagementDashboardSourceInfo,
  mergeOfficialOrderMetricsIntoManagementSummary,
  resolveManagementDashboardPeriod,
  type CrmManagementDashboardRequest,
} from "@/src/lib/crmManagementDashboardOfficialOrders.js";

const LIST_LIMIT = 10;

export type { CrmManagementDashboardRequest };
export {
  buildManagementDashboardSourceInfo,
  mergeOfficialOrderMetricsIntoManagementSummary,
  resolveManagementDashboardPeriod,
};

type ActivityRow = {
  id: string;
  customerId: string;
  salesOrderId: string | null;
  contactDate: Date | null;
  createdAt: Date;
  nextActionAt: Date | null;
  nextActionDescription: string | null;
  assignedTo: string | null;
  createdByName: string | null;
  status: string | null;
  channel: string | null;
  reason: string | null;
};

function activityMoment(a: ActivityRow): Date {
  return a.contactDate ?? a.createdAt;
}

/** Mesma semântica do `CRM_ACTIVITY_NOT_CLOSED_SQL` que este serviço usava. */
function isActivityOpen(a: ActivityRow): boolean {
  const s = a.status?.trim().toLowerCase();
  return !s || !["done", "closed", "cancelled", "canceled"].includes(s);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function buildCrmManagementDashboardResponse(
  input: CrmManagementDashboardRequest = {},
  now = new Date()
) {
  const period = resolveManagementDashboardPeriod(input, now);
  const canonicalPeriod = {
    year: input.year ?? null,
    month: input.month ?? null,
    allYears: input.allYears ?? false,
  };
  const nowMs = now.getTime();
  const shift = (days: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };
  const since7 = shift(-7);
  const since30 = shift(-30);
  const since60 = shift(-60);
  const since90 = shift(-90);
  const since180 = shift(-180);
  const in7 = shift(7);
  const in30 = shift(30);

  const [orderFacts, orderMetrics, activities, profiles, breakdownRows] = await Promise.all([
    loadCrmManagementOrderFacts(prisma, canonicalPeriod, now),
    loadCrmSalesOrderMetrics(
      prisma,
      {
        year: canonicalPeriod.year,
        month: canonicalPeriod.month,
        allYears: canonicalPeriod.allYears,
      },
      { referenceDate: now }
    ),
    // Relacionamento: atividades da janela móvel mais longa do cockpit, mais
    // as que têm próxima ação agendada (agenda não tem janela).
    prisma.commercialActivity.findMany({
      where: {
        OR: [
          { contactDate: { gte: since180 } },
          { AND: [{ contactDate: null }, { createdAt: { gte: since180 } }] },
          { nextActionAt: { not: null } },
        ],
      },
      select: {
        id: true,
        customerId: true,
        salesOrderId: true,
        contactDate: true,
        createdAt: true,
        nextActionAt: true,
        nextActionDescription: true,
        assignedTo: true,
        createdByName: true,
        status: true,
        channel: true,
        reason: true,
      },
    }) as unknown as Promise<ActivityRow[]>,
    prisma.crmCustomerProfile.findMany({
      select: { customerId: true, relationshipLevel: true, commercialTemperature: true },
    }) as unknown as Promise<
      Array<{
        customerId: string;
        relationshipLevel: string | null;
        commercialTemperature: string | null;
      }>
    >,
    prisma.$queryRaw<{ kind: string; key: string; count: bigint }[]>(Prisma.sql`
      SELECT 'channel' AS kind, COALESCE(NULLIF(TRIM(a."channel"), ''), 'Não informado') AS key,
        COUNT(*)::bigint AS count
      FROM "CommercialActivity" a
      WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
      GROUP BY 2
      UNION ALL
      SELECT 'reason', COALESCE(NULLIF(TRIM(a."reason"), ''), 'Não informado'), COUNT(*)::bigint
      FROM "CommercialActivity" a
      WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
      GROUP BY 2
      UNION ALL
      SELECT 'responsible',
        COALESCE(NULLIF(TRIM(a."assignedTo"), ''), NULLIF(TRIM(a."createdByName"), ''), 'Sem responsável'),
        COUNT(*)::bigint
      FROM "CommercialActivity" a
      WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
      GROUP BY 2
    `),
  ]);

  const scopedIds = new Set(orderFacts.customers.map((c) => c.id));
  const profileById = new Map(profiles.map((p) => [p.customerId, p]));

  // ── Relacionamento (CRM puro, janelas móveis) ───────────────────────────
  const lastContactByCustomer = new Map<string, Date>();
  const activitiesByCustomer = new Map<string, ActivityRow[]>();
  const nextFollowUpByCustomer = new Map<string, Date>();
  let contactsLast7Days = 0;
  let contactsLast30Days = 0;
  const contacted30 = new Set<string>();
  const overdueFollowUpRows: ActivityRow[] = [];
  const upcoming7Rows: ActivityRow[] = [];
  const upcoming30Rows: ActivityRow[] = [];

  for (const a of activities) {
    const moment = activityMoment(a);
    const list = activitiesByCustomer.get(a.customerId) ?? [];
    list.push(a);
    activitiesByCustomer.set(a.customerId, list);

    const current = lastContactByCustomer.get(a.customerId);
    if (!current || moment > current) lastContactByCustomer.set(a.customerId, moment);

    if (moment >= since7) contactsLast7Days += 1;
    if (moment >= since30) {
      contactsLast30Days += 1;
      contacted30.add(a.customerId);
    }

    if (a.nextActionAt && isActivityOpen(a)) {
      if (a.nextActionAt < now) {
        overdueFollowUpRows.push(a);
      } else {
        if (a.nextActionAt < in7) upcoming7Rows.push(a);
        if (a.nextActionAt < in30) upcoming30Rows.push(a);
        const nextCurrent = nextFollowUpByCustomer.get(a.customerId);
        if (!nextCurrent || a.nextActionAt < nextCurrent) {
          nextFollowUpByCustomer.set(a.customerId, a.nextActionAt);
        }
      }
    }
  }

  const countScopedWithoutContactSince = (since: Date): number => {
    let count = 0;
    for (const id of scopedIds) {
      const last = lastContactByCustomer.get(id);
      if (!last || last < since) count += 1;
    }
    return count;
  };

  // ── Carteira sem follow-up: população canônica × regra CRM de follow-up ──
  const ordersWithoutFollowUpAll = orderFacts.openPortfolioOrders.filter((order) => {
    if (!order.customerId) return true;
    const acts = activitiesByCustomer.get(order.customerId) ?? [];
    return !orderHasFollowUpAfterCutoff(order.id, order.updatedAt, acts);
  });
  const customersWithOrderNoFollowUp = new Set(
    ordersWithoutFollowUpAll.map((o) => o.customerId).filter((id): id is string => Boolean(id))
  );

  // ── Contadores e listas de cliente ──────────────────────────────────────
  const scopedCustomers = orderFacts.customers;
  const totalCustomers = scopedCustomers.length;
  let customersWithoutPurchaseHorizon = 0;
  let customersWithoutPurchase90 = 0;
  let customersWithoutPurchase180 = 0;
  let customersWithoutOrderInPeriod = 0;
  let customersAtHighRisk = 0;

  type ScopedCustomer = (typeof scopedCustomers)[number];
  const riskRows: Array<{
    customer: ScopedCustomer;
    riskLevel: "HIGH" | "MEDIUM";
    reasons: string[];
    lastPurchase: Date | null;
    lastContact: Date | null;
    open: { orders: number; value: number };
  }> = [];
  const opportunityRows: Array<{
    customer: ScopedCustomer;
    tier: number;
    lastPurchase: Date | null;
    lastContact: Date | null;
    purchased12m: number;
    openOrders: number;
  }> = [];

  for (const customer of scopedCustomers) {
    const lastPurchase = orderFacts.lastPurchaseByCustomer.get(customer.id) ?? null;
    const lastContact = lastContactByCustomer.get(customer.id) ?? null;
    const open = orderFacts.openPortfolioByCustomer.get(customer.id) ?? { orders: 0, value: 0 };
    const purchased12m = orderFacts.purchase12mByCustomer.get(customer.id)?.value ?? 0;
    const hasOrderNoFollowUp = customersWithOrderNoFollowUp.has(customer.id);

    if (!lastPurchase) customersWithoutPurchaseHorizon += 1;
    if (!lastPurchase || lastPurchase < since90) customersWithoutPurchase90 += 1;
    if (!lastPurchase || lastPurchase < since180) customersWithoutPurchase180 += 1;
    if (!orderFacts.customersWithOrderInPeriod.has(customer.id)) customersWithoutOrderInPeriod += 1;

    const riskLevel: "HIGH" | "MEDIUM" | "LOW" =
      hasOrderNoFollowUp || (lastPurchase != null && lastPurchase < since90)
        ? "HIGH"
        : lastPurchase == null || open.orders > 0
          ? "MEDIUM"
          : "LOW";

    if (riskLevel !== "LOW") {
      if (riskLevel === "HIGH") customersAtHighRisk += 1;
      riskRows.push({
        customer,
        riskLevel,
        reasons: buildManagementRiskReasons({
          riskLevel,
          hasOrderNoFollowUp,
          lastPurchaseAt: lastPurchase,
          openOrdersCount: open.orders,
          since90,
        }),
        lastPurchase,
        lastContact,
        open,
      });
    }

    const tier =
      lastPurchase != null && lastPurchase >= since30
        ? 1
        : open.orders > 0
          ? 2
          : purchased12m > 0 && (lastContact == null || lastContact < since30)
            ? 3
            : null;
    if (tier != null) {
      opportunityRows.push({
        customer,
        tier,
        lastPurchase,
        lastContact,
        purchased12m,
        openOrders: open.orders,
      });
    }
  }

  const riskCustomers = riskRows
    .sort((a, b) => {
      if (a.riskLevel !== b.riskLevel) return a.riskLevel === "HIGH" ? -1 : 1;
      return b.open.value - a.open.value;
    })
    .slice(0, LIST_LIMIT)
    .map((row) => ({
      customerId: row.customer.id,
      displayName: mgmtDisplayName(row.customer.companyName, row.customer.tradeName),
      taxId: row.customer.taxId,
      city: row.customer.city,
      state: row.customer.state,
      riskLevel: row.riskLevel,
      riskReasons: row.reasons,
      daysSinceLastPurchase: mgmtDaysSince(row.lastPurchase, nowMs),
      daysSinceLastContact: mgmtDaysSince(row.lastContact, nowMs),
      openOrdersCount: row.open.orders,
      openOrdersValue: roundMoney(row.open.value),
      nextFollowUpAt: mgmtIso(nextFollowUpByCustomer.get(row.customer.id) ?? null),
      relationshipLevel: profileById.get(row.customer.id)?.relationshipLevel ?? null,
      commercialTemperature: profileById.get(row.customer.id)?.commercialTemperature ?? null,
    }));

  const opportunityCustomers = opportunityRows
    .sort((a, b) => a.tier - b.tier || b.purchased12m - a.purchased12m)
    .slice(0, LIST_LIMIT)
    .map((row) => ({
      customerId: row.customer.id,
      displayName: mgmtDisplayName(row.customer.companyName, row.customer.tradeName),
      taxId: row.customer.taxId,
      daysSinceLastPurchase: mgmtDaysSince(row.lastPurchase, nowMs),
      daysSinceLastContact: mgmtDaysSince(row.lastContact, nowMs),
      totalPurchasedLast12Months: roundMoney(row.purchased12m),
      openOrdersCount: row.openOrders,
      suggestedAction: buildManagementSuggestedAction({
        lastPurchaseAt: row.lastPurchase,
        lastContactAt: row.lastContact,
        openOrdersCount: row.openOrders,
        tier: row.tier,
        since30,
      }),
    }));

  const followUpDto = (a: ActivityRow) => {
    const c = orderFacts.customerById.get(a.customerId);
    return {
      activityId: a.id,
      customerId: a.customerId,
      displayName: c ? mgmtDisplayName(c.companyName, c.tradeName) : "(cliente)",
      nextActionAt: mgmtIso(a.nextActionAt) ?? now.toISOString(),
      nextActionDescription: a.nextActionDescription,
      assignedTo: a.assignedTo,
      createdByName: a.createdByName,
    };
  };

  const overdueFollowUps = overdueFollowUpRows
    .slice()
    .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime())
    .slice(0, LIST_LIMIT)
    .map((a) => ({
      ...followUpDto(a),
      daysOverdue: Math.max(0, Math.floor((nowMs - a.nextActionAt!.getTime()) / 86400000)),
    }));

  const upcomingFollowUps = upcoming7Rows
    .slice()
    .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime())
    .slice(0, LIST_LIMIT)
    .map((a) => ({
      ...followUpDto(a),
      daysUntil: Math.max(0, Math.ceil((a.nextActionAt!.getTime() - nowMs) / 86400000)),
    }));

  const ordersWithoutFollowUp = ordersWithoutFollowUpAll.slice(0, LIST_LIMIT).map((order) => {
    const customer = order.customerId ? orderFacts.customerById.get(order.customerId) : null;
    return {
      salesOrderId: order.id,
      orderCode: order.orderCode,
      customerId: order.customerId ?? "",
      displayName: customer
        ? mgmtDisplayName(customer.companyName, customer.tradeName)
        : "(sem cliente vinculado)",
      status: order.status,
      totalNetValue: roundMoney(order.totalNetValue),
      updatedAt: mgmtIso(order.updatedAt) ?? now.toISOString(),
      daysWithoutFollowUp: Math.max(0, Math.floor((nowMs - order.updatedAt.getTime()) / 86400000)),
      responsible: order.responsible,
    };
  });

  const topCustomersLast12Months = [...orderFacts.purchase12mByCustomer.entries()]
    .filter(([customerId]) => scopedIds.has(customerId))
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, LIST_LIMIT)
    .map(([customerId, agg]) => {
      const c = orderFacts.customerById.get(customerId)!;
      return {
        customerId,
        displayName: mgmtDisplayName(c.companyName, c.tradeName),
        taxId: c.taxId,
        totalPurchasedLast12Months: roundMoney(agg.value),
        ordersCount: agg.orders,
        lastPurchaseAt: mgmtIso(orderFacts.lastPurchaseByCustomer.get(customerId) ?? null),
        daysSinceLastContact: mgmtDaysSince(lastContactByCustomer.get(customerId) ?? null, nowMs),
      };
    });

  const breakdownOf = (kind: string) =>
    breakdownRows
      .filter((r) => r.kind === kind)
      .map((r) => ({ key: r.key, count: Number(r.count ?? 0n) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

  const openPortfolioTotals = [...orderFacts.openPortfolioByCustomer.values()].reduce(
    (acc, agg) => ({ orders: acc.orders + agg.orders, value: acc.value + agg.value }),
    { orders: 0, value: 0 }
  );

  const summary = mergeOfficialOrderMetricsIntoManagementSummary({
    base: {
      totalCustomers,
      customersWithContactLast30Days: [...contacted30].filter((id) => scopedIds.has(id)).length,
      customersWithoutContactLast30Days: countScopedWithoutContactSince(since30),
      customersWithoutContactLast60Days: countScopedWithoutContactSince(since60),
      customersWithoutContactLast90Days: countScopedWithoutContactSince(since90),
      customersWithoutValidPurchase: customersWithoutPurchaseHorizon,
      customersWithoutPurchase90Days: customersWithoutPurchase90,
      customersWithoutPurchase180Days: customersWithoutPurchase180,
      contactsLast7Days,
      contactsLast30Days,
      overdueFollowUps: overdueFollowUpRows.length,
      upcomingFollowUpsNext7Days: upcoming7Rows.length,
      upcomingFollowUpsNext30Days: upcoming30Rows.length,
      openOrdersCount: openPortfolioTotals.orders,
      openOrdersValue: roundMoney(openPortfolioTotals.value),
      ordersWithoutFollowUpCount: ordersWithoutFollowUpAll.length,
      customersAtHighRisk,
    },
    metrics: orderMetrics,
    totalCustomers,
    customersWithoutOrderInPeriod,
  });

  return {
    generatedAt: now.toISOString(),
    summary,
    riskCustomers,
    opportunityCustomers,
    overdueFollowUps,
    upcomingFollowUps,
    ordersWithoutFollowUp,
    topCustomersLast12Months,
    topCustomers: orderMetrics.topCustomers,
    topProducts: orderMetrics.topProducts,
    topCommercialOwners: orderMetrics.topCommercialOwners,
    /** Agregados do ranking COMPLETO — base de reconciliação, não Top N. */
    reconciliation: {
      customerRanking: orderMetrics.customerRankingTotals,
      commercialOwnerRanking: orderMetrics.commercialOwnerRankingTotals,
    },
    activityBreakdown: {
      periodDays: 30,
      byChannel: breakdownOf("channel"),
      byReason: breakdownOf("reason"),
      byResponsible: breakdownOf("responsible"),
    },
    sourceInfo: {
      ...buildManagementDashboardSourceInfo({
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        metrics: orderMetrics,
      }),
      relationshipHorizonMonths: CRM_RELATIONSHIP_HORIZON_MONTHS,
    },
  };
}
