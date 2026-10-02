/**
 * FIN-08 — carrega agendas FIN-05 para enriquecer Contas a Receber.
 */

import type { PrismaClient } from "@prisma/client";
import { buildSalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";
import { getOrderFullAudit } from "./orderFullAuditService.js";
import { loadCashFlowOrderProjections } from "./cashFlowOrderProjectionLoader.server.js";
import type { CashFlowOrderProjection } from "./cashFlowOrderProjectionLoader.server.js";
import type { CashFlowProjectionMode } from "./cashFlowLightProjectionFlag.js";
import {
  recordCashFlowFullAuditCall,
  recordCashFlowLightLoaderCall,
  recordCashFlowOrderProjectionFailure,
  recordCashFlowProjectionMode,
} from "./cashFlowProjectionTelemetry.js";
import { buildEffectiveScheduleInputFromAudit } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import { extractFinanceArOrderCodeHint } from "./financeArOperationalPortfolio.js";
import type { FinanceArNfeOrderLink } from "./financeArOperationalPortfolio.js";
import { extractFinanceArOrderCodeHint as extractFinanceArOrderCodeHintFromQuery } from "@/src/lib/financeAccountsReceivableTitles.js";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  buildFinanceArEffectiveSalesOrderWhere,
} from "@/src/lib/financeArCancelledSalesOrderExclusion.server.js";
import { shouldIncludeSalesOrderInOperationalReceivables } from "@/src/lib/financeArCancelledSalesOrderExclusion.js";
import {
  summarizePortfolioOrderLimitSelection,
  type CashFlowPortfolioOrderLimitSummary,
} from "@/src/lib/finance/cashFlowPortfolioLimitMath.js";

const DEFAULT_ORDER_LIMIT = 24;
/** Teto de pedidos distintos por portfólio AR (descrição + NF). */
export const PORTFOLIO_ORDER_LIMIT = 80;
/**
 * Mitigação de latência do Fluxo de Caixa (FC): quantas chamadas a
 * `getOrderFullAudit` (auditoria 360º completa — ~28 consultas por pedido)
 * rodam em paralelo ao montar o contexto efetivo do portfólio.
 *
 * NÃO reduz o trabalho total do banco — só reduz o número de ONDAS
 * sequenciais (PORTFOLIO_ORDER_LIMIT / CONCURRENCY). Antes: 80/4 = 20 ondas.
 * Agora: 80/8 = 10 ondas. É seguro por construção: o conjunto de pedidos
 * processados (`orders`) e o resultado final (`mergeFinanceArEffectiveOrderContexts`,
 * que funde por `salesOrderId` num Map) não dependem da ordem nem do tamanho
 * do lote — só da timing de execução. Ver
 * financeAccountsReceivableEffectiveTitlesConcurrency.test.ts para a prova.
 *
 * Se a carga no banco piorar (mais conexões concorrentes competindo pelo pool
 * do Prisma) em vez de melhorar, reverta este número para 4 — é a única
 * mudança desta mitigação.
 */
const EFFECTIVE_ORDER_AUDIT_CONCURRENCY = 8;

export type FinanceArPortfolioSalesOrderRefs = {
  orderCodes: string[];
  salesOrderIds: string[];
};

/** Where exato — evita `contains` que estoura o take e omite pedidos (ex.: PD 02719). */
export function buildExactPortfolioSalesOrderWhere(
  orderCodes: string[],
  salesOrderIds: string[]
): Record<string, unknown> | null {
  const orClauses: Array<Record<string, unknown>> = [];
  const codes = [...new Set(orderCodes.map((c) => c.trim()).filter(Boolean))];
  for (const code of codes) {
    orClauses.push({ orderCode: { equals: code, mode: "insensitive" } });
  }
  const ids = [...new Set(salesOrderIds.filter(Boolean))];
  if (ids.length > 0) {
    orClauses.push({ id: { in: ids } });
  }
  if (orClauses.length === 0) return null;
  return orClauses.length === 1 ? orClauses[0]! : { OR: orClauses };
}

export async function resolveFinanceArNfeOrderLinksFromRows(
  prisma: PrismaClient,
  rows: Array<Pick<FinanceArDashboardRow, "sourceInvoiceId">>
): Promise<FinanceArNfeOrderLink[]> {
  const refs = await resolveFinanceArPortfolioSalesOrderRefs(prisma, rows);
  if (refs.salesOrderIds.length === 0 && refs.orderCodes.length === 0) {
    return [];
  }

  const nfeIds = [
    ...new Set(
      rows
        .map((r) => r.sourceInvoiceId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];
  if (nfeIds.length === 0) return [];

  const links = await prisma.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: nfeIds } },
    select: {
      nfeExternalId: true,
      salesOrderId: true,
      orderCode: true,
      SalesOrder: { select: { id: true, orderCode: true } },
    },
  });

  return links
    .map((link) => {
      const orderCode = (link.orderCode ?? link.SalesOrder?.orderCode ?? "").trim();
      const salesOrderId = link.salesOrderId ?? link.SalesOrder?.id ?? "";
      if (!orderCode || !salesOrderId || !link.nfeExternalId) return null;
      return {
        sourceInvoiceId: link.nfeExternalId,
        orderCode,
        salesOrderId,
      };
    })
    .filter((link): link is FinanceArNfeOrderLink => link != null);
}

async function resolveFinanceArPortfolioSalesOrderRefs(
  prisma: PrismaClient,
  rows: Array<Pick<FinanceArDashboardRow, "sourceInvoiceId">>
): Promise<FinanceArPortfolioSalesOrderRefs> {
  const nfeIds = [
    ...new Set(
      rows
        .map((r) => r.sourceInvoiceId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];
  if (nfeIds.length === 0) {
    return { orderCodes: [], salesOrderIds: [] };
  }

  const links = await prisma.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: nfeIds } },
    select: {
      salesOrderId: true,
      orderCode: true,
      SalesOrder: { select: { id: true, orderCode: true } },
    },
  });

  const orderCodes = new Set<string>();
  const salesOrderIds = new Set<string>();
  for (const link of links) {
    if (link.salesOrderId) salesOrderIds.add(link.salesOrderId);
    const code = (link.orderCode ?? link.SalesOrder?.orderCode ?? "").trim();
    if (code) orderCodes.add(code);
  }
  return {
    orderCodes: [...orderCodes],
    salesOrderIds: [...salesOrderIds],
  };
}

export type LoadFinanceArEffectiveOrderContextsInput = {
  search?: string | null;
  document?: string | null;
  customerPersonId?: number | null;
  customerName?: string | null;
  /** Pedidos inferidos do portfólio AR (descrição + NF vinculada). */
  portfolioOrderCodes?: string[] | null;
  limit?: number;
};

/** Coleta códigos PD… nas descrições Nomus do portfólio. */
export function collectFinanceArOrderCodesFromPortfolioRows(
  rows: Array<Pick<FinanceArDashboardRow, "description">>
): string[] {
  const codes = new Set<string>();
  for (const row of rows) {
    const hint = extractFinanceArOrderCodeHint(row.description);
    if (hint) codes.add(hint);
  }
  return [...codes];
}

async function resolveFinanceArOrderCodesFromInvoiceLinks(
  prisma: PrismaClient,
  rows: Array<Pick<FinanceArDashboardRow, "sourceInvoiceId">>
): Promise<string[]> {
  const refs = await resolveFinanceArPortfolioSalesOrderRefs(prisma, rows);
  return refs.orderCodes;
}

function shouldLoadEffectiveContexts(
  input: LoadFinanceArEffectiveOrderContextsInput
): boolean {
  if (extractFinanceArOrderCodeHintFromQuery(input.search, input.document)) {
    return true;
  }
  if (input.customerPersonId != null) return true;
  if ((input.customerName ?? "").trim()) return true;
  if ((input.portfolioOrderCodes ?? []).length > 0) return true;
  return false;
}

function buildSalesOrderWhereForOrderCodes(
  orderCodes: string[]
): Record<string, unknown> | null {
  const unique = [...new Set(orderCodes.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) return null;

  const orClauses: Array<Record<string, unknown>> = [];
  for (const orderCode of unique) {
    const digits = orderCode.replace(/^PD\s*/i, "").trim();
    orClauses.push(
      { orderCode: { equals: orderCode, mode: "insensitive" } },
      { orderCode: { contains: orderCode, mode: "insensitive" } },
      ...(digits
        ? [{ orderCode: { contains: digits, mode: "insensitive" as const } }]
        : [])
    );
  }
  return { OR: orClauses };
}

/**
 * Caminho LEVE — mesma fronteira financeira, fonte diferente.
 *
 * Carrega os pedidos em lote (sem auditoria 360º) e alimenta os MESMOS
 * builders canônicos. `getOrderFullAudit` não é chamado aqui.
 */
async function buildFinanceArEffectiveContextsFromLightProjection(
  prisma: PrismaClient,
  orders: Array<{
    id: string;
    orderCode: string;
    status: string | null;
    sourcePresenceStatus: string | null;
    externalCustomerId: number | null;
    Customer: { companyName: string | null; taxId: string | null } | null;
  }>,
  referenceDate: Date,
  /**
   * Quando informado, a carga em lote já foi feita pelo caller (união de
   * contextos). Não chama o loader de novo e não cai no Full Audit.
   */
  preloadedProjections?: Map<string, CashFlowOrderProjection>
): Promise<FinanceArEffectiveOrderContext[]> {
  const eligible = orders.filter((order) =>
    shouldIncludeSalesOrderInOperationalReceivables({
      status: order.status,
      sourcePresenceStatus: order.sourcePresenceStatus,
    })
  );
  if (eligible.length === 0) return [];

  let projections: Map<string, CashFlowOrderProjection>;
  if (preloadedProjections) {
    projections = preloadedProjections;
  } else {
    recordCashFlowLightLoaderCall();
    projections = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: eligible.map((order) => order.id),
      referenceDate,
    });
  }

  const contexts: FinanceArEffectiveOrderContext[] = [];
  for (const order of eligible) {
    const projection = projections.get(order.id);
    if (!projection) continue;
    try {
      const scheduleInput = buildEffectiveScheduleInputFromAudit(
        {
          salesOrderId: projection.salesOrderId,
          orderCode: projection.orderCode,
          salesOrder: { orderCode: projection.orderCode },
          items: projection.items,
          receivables: projection.receivables,
          stockDocuments: projection.stockDocuments,
          stockDocumentItems: [],
          plannedReceivables: projection.plannedReceivables,
        } as never,
        referenceDate
      );
      const schedule = buildSalesOrderEffectiveFinancialSchedule(scheduleInput);
      contexts.push({
        schedule,
        personId: order.externalCustomerId ?? null,
        personName: projection.personName ?? order.Customer?.companyName ?? null,
        personCnpj: projection.personCnpj ?? order.Customer?.taxId ?? null,
        companyName: projection.companyName ?? null,
      } satisfies FinanceArEffectiveOrderContext);
    } catch (err) {
      recordCashFlowOrderProjectionFailure();
      console.error(
        "loadFinanceArEffectiveOrderContexts(light): falha no pedido",
        order.orderCode,
        err
      );
    }
  }
  return contexts;
}

/**
 * Uma carga light para vários grupos de pedidos (cliente + portfólio).
 * A união é determinística: percorre os grupos na ordem recebida e ignora
 * id repetido. Cada grupo volta na própria ordem. Não há fallback para
 * `getOrderFullAudit`.
 */
export async function buildLightOrderContextGroups(
  prisma: PrismaClient,
  groups: Array<
    Array<{
      id: string;
      orderCode: string;
      status: string | null;
      sourcePresenceStatus: string | null;
      externalCustomerId: number | null;
      Customer: { companyName: string | null; taxId: string | null } | null;
    }>
  >,
  referenceDate: Date
): Promise<FinanceArEffectiveOrderContext[][]> {
  recordCashFlowProjectionMode("light");
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const group of groups) {
    for (const order of group) {
      if (
        !shouldIncludeSalesOrderInOperationalReceivables({
          status: order.status,
          sourcePresenceStatus: order.sourcePresenceStatus,
        })
      ) {
        continue;
      }
      if (seen.has(order.id)) continue;
      seen.add(order.id);
      ids.push(order.id);
    }
  }
  const projections =
    ids.length === 0
      ? new Map<string, CashFlowOrderProjection>()
      : await loadSharedLightProjections(prisma, ids, referenceDate);
  const built: FinanceArEffectiveOrderContext[][] = [];
  for (const group of groups) {
    built.push(
      await buildFinanceArEffectiveContextsFromLightProjection(
        prisma,
        group,
        referenceDate,
        projections
      )
    );
  }
  return built;
}

async function loadSharedLightProjections(
  prisma: PrismaClient,
  salesOrderIds: string[],
  referenceDate: Date
): Promise<Map<string, CashFlowOrderProjection>> {
  recordCashFlowLightLoaderCall();
  return loadCashFlowOrderProjections(prisma, { salesOrderIds, referenceDate });
}

async function buildFinanceArEffectiveContextsForOrders(
  prisma: PrismaClient,
  orders: Array<{
    id: string;
    orderCode: string;
    status: string | null;
    sourcePresenceStatus: string | null;
    externalCustomerId: number | null;
    Customer: { companyName: string | null; taxId: string | null } | null;
  }>,
  referenceDate: Date,
  projectionMode: CashFlowProjectionMode = "legacy"
): Promise<FinanceArEffectiveOrderContext[]> {
  const CONCURRENCY = EFFECTIVE_ORDER_AUDIT_CONCURRENCY;
  const contexts: FinanceArEffectiveOrderContext[] = [];

  recordCashFlowProjectionMode(projectionMode);
  if (projectionMode === "light") {
    return buildFinanceArEffectiveContextsFromLightProjection(
      prisma,
      orders,
      referenceDate
    );
  }

  for (let i = 0; i < orders.length; i += CONCURRENCY) {
    const slice = orders.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      slice.map(async (order) => {
        if (
          !shouldIncludeSalesOrderInOperationalReceivables({
            status: order.status,
            sourcePresenceStatus: order.sourcePresenceStatus,
          })
        ) {
          return null;
        }
        try {
          recordCashFlowFullAuditCall();
          const audit = await getOrderFullAudit({
            salesOrderId: order.id,
            orderCode: order.orderCode,
          });
          if (!("ok" in audit) || audit.ok !== true) return null;
          const scheduleInput = buildEffectiveScheduleInputFromAudit(
            audit,
            referenceDate
          );
          const schedule =
            buildSalesOrderEffectiveFinancialSchedule(scheduleInput);
          const personFromCr = audit.receivables[0];
          return {
            schedule,
            personId: order.externalCustomerId ?? null,
            personName:
              personFromCr?.personName ?? order.Customer?.companyName ?? null,
            personCnpj:
              personFromCr?.personCnpj ?? order.Customer?.taxId ?? null,
            companyName: personFromCr?.companyName ?? null,
          } satisfies FinanceArEffectiveOrderContext;
        } catch (err) {
          recordCashFlowOrderProjectionFailure();
          console.error(
            "loadFinanceArEffectiveOrderContexts: falha no pedido",
            order.orderCode,
            err
          );
          return null;
        }
      })
    );
    for (const ctx of settled) {
      if (ctx) contexts.push(ctx);
    }
  }

  return contexts;
}

/**
 * Resolve pedidos do contexto (Pedido e/ou cliente) sem montar a agenda.
 */
export async function selectFinanceArEffectiveOrders(
  prisma: PrismaClient,
  input: LoadFinanceArEffectiveOrderContextsInput
) {
  if (!shouldLoadEffectiveContexts(input)) return [];

  const limit = Math.min(
    Math.max(input.limit ?? DEFAULT_ORDER_LIMIT, 1),
    PORTFOLIO_ORDER_LIMIT
  );
  const orderCodeHint = extractFinanceArOrderCodeHintFromQuery(
    input.search,
    input.document
  );
  const portfolioCodes = (input.portfolioOrderCodes ?? []).filter(Boolean);

  const orderCodes = new Set<string>();
  if (orderCodeHint) orderCodes.add(orderCodeHint);
  for (const code of portfolioCodes) orderCodes.add(code);

  const whereParts: Array<Record<string, unknown>> = [];
  const orderWhere = buildSalesOrderWhereForOrderCodes([...orderCodes]);
  if (orderWhere) whereParts.push(orderWhere);

  const customerOr: Array<Record<string, unknown>> = [];
  if (input.customerPersonId != null) {
    customerOr.push({ externalCustomerId: input.customerPersonId });
  }
  if ((input.customerName ?? "").trim()) {
    const name = input.customerName!.trim();
    customerOr.push({
      Customer: { companyName: { contains: name, mode: "insensitive" } },
    });
  }
  if (customerOr.length === 1) whereParts.push(customerOr[0]!);
  else if (customerOr.length > 1) whereParts.push({ OR: customerOr });

  if (whereParts.length === 0) return [];

  const commercialWhere =
    whereParts.length === 1 ? whereParts[0]! : { AND: whereParts };
  const where = buildFinanceArEffectiveSalesOrderWhere(commercialWhere);

  return prisma.salesOrder.findMany({
    where: where as never,
    select: {
      id: true,
      orderCode: true,
      status: true,
      sourcePresenceStatus: true,
      externalCustomerId: true,
      Customer: { select: { companyName: true, taxId: true } },
    },
    orderBy: { issueDate: "desc" },
    take: limit,
  });
}

/**
 * Resolve pedidos do contexto (Pedido e/ou cliente) e monta agendas FIN-05.
 */
export async function loadFinanceArEffectiveOrderContexts(
  prisma: PrismaClient,
  input: LoadFinanceArEffectiveOrderContextsInput,
  referenceDate: Date = new Date(),
  projectionMode: CashFlowProjectionMode = "legacy"
): Promise<FinanceArEffectiveOrderContext[]> {
  const orders = await selectFinanceArEffectiveOrders(prisma, input);
  if (orders.length === 0) return [];
  return buildFinanceArEffectiveContextsForOrders(
    prisma,
    orders,
    referenceDate,
    projectionMode
  );
}

/**
 * Pedidos do portfólio AR (NF primeiro, depois código), já no teto, sem agenda.
 */
export async function selectFinanceArPortfolioOrders(
  prisma: PrismaClient,
  rows: Array<Pick<FinanceArDashboardRow, "description" | "sourceInvoiceId">>,
  limit = PORTFOLIO_ORDER_LIMIT
) {
  const fromDescriptions = collectFinanceArOrderCodesFromPortfolioRows(rows);
  const fromLinks = await resolveFinanceArPortfolioSalesOrderRefs(prisma, rows);
  const portfolioOrderCodes = [
    ...new Set([...fromDescriptions, ...fromLinks.orderCodes]),
  ];

  if (portfolioOrderCodes.length === 0 && fromLinks.salesOrderIds.length === 0) {
    return [];
  }

  const cap = Math.min(Math.max(limit, 1), PORTFOLIO_ORDER_LIMIT);
  const orderSelect = {
    id: true,
    orderCode: true,
    status: true,
    sourcePresenceStatus: true,
    externalCustomerId: true,
    Customer: { select: { companyName: true, taxId: true } },
  } as const;

  const priorityIds = [...new Set(fromLinks.salesOrderIds.filter(Boolean))];
  const priorityOrders =
    priorityIds.length > 0
      ? await prisma.salesOrder.findMany({
          where: buildFinanceArEffectiveSalesOrderWhere({
            id: { in: priorityIds },
          }) as never,
          select: orderSelect,
          orderBy: { orderCode: "asc" },
          take: cap,
        })
      : [];

  const loadedIds = new Set(priorityOrders.map((order) => order.id));
  const remainingCap = Math.max(0, cap - priorityOrders.length);

  let secondaryOrders: typeof priorityOrders = [];
  if (remainingCap > 0) {
    const secondaryWhere = buildExactPortfolioSalesOrderWhere(portfolioOrderCodes, []);
    if (secondaryWhere) {
      const where = buildFinanceArEffectiveSalesOrderWhere({
        AND: [
          secondaryWhere,
          loadedIds.size > 0 ? { id: { notIn: [...loadedIds] } } : {},
        ],
      });
      secondaryOrders = await prisma.salesOrder.findMany({
        where: where as never,
        select: orderSelect,
        orderBy: { orderCode: "asc" },
        take: remainingCap,
      });
    }
  }

  return [...priorityOrders, ...secondaryOrders];
}

/**
 * Carrega agendas FIN-05 para todos os pedidos inferidos do portfólio AR
 * (descrição Nomus + vínculo NF → SalesOrderNfeLink).
 */
export async function loadFinanceArEffectiveOrderContextsForPortfolio(
  prisma: PrismaClient,
  rows: Array<
    Pick<FinanceArDashboardRow, "description" | "sourceInvoiceId">
  >,
  referenceDate: Date = new Date(),
  limit = PORTFOLIO_ORDER_LIMIT,
  projectionMode: CashFlowProjectionMode = "legacy"
): Promise<FinanceArEffectiveOrderContext[]> {
  const orders = await selectFinanceArPortfolioOrders(prisma, rows, limit);
  if (orders.length === 0) return [];

  return buildFinanceArEffectiveContextsForOrders(
    prisma,
    orders,
    referenceDate,
    projectionMode
  );
}

const ORDER_ID_SELECT = { id: true } as const;

/**
 * Auditoria read-only do teto de pedidos. Não chama auditoria 360º nem o
 * schedule. O valor projetado dos excluídos não é calculado: esse número só
 * existe depois do motor FIN-05, e somar `totalNetValue` do pedido seria outra
 * métrica.
 */
export async function summarizeFinanceArPortfolioOrderLimit(
  prisma: PrismaClient,
  rows: Array<Pick<FinanceArDashboardRow, "description" | "sourceInvoiceId">>,
  limit = PORTFOLIO_ORDER_LIMIT
): Promise<CashFlowPortfolioOrderLimitSummary> {
  const fromDescriptions = collectFinanceArOrderCodesFromPortfolioRows(rows);
  const fromLinks = await resolveFinanceArPortfolioSalesOrderRefs(prisma, rows);
  const portfolioOrderCodes = [
    ...new Set([...fromDescriptions, ...fromLinks.orderCodes]),
  ];
  const cap = Math.min(Math.max(limit, 1), PORTFOLIO_ORDER_LIMIT);
  const priorityIds = [...new Set(fromLinks.salesOrderIds.filter(Boolean))];

  const priorityEligible =
    priorityIds.length > 0
      ? await prisma.salesOrder.findMany({
          where: buildFinanceArEffectiveSalesOrderWhere({
            id: { in: priorityIds },
          }) as never,
          select: ORDER_ID_SELECT,
          orderBy: { orderCode: "asc" },
        })
      : [];
  const priorityEligibleIds = priorityEligible.map((order) => order.id);
  const takenPriorityIds = priorityEligibleIds.slice(0, cap);

  let secondaryEligibleIds: string[] = [];
  const secondaryWhere = buildExactPortfolioSalesOrderWhere(portfolioOrderCodes, []);
  if (secondaryWhere) {
    const where = buildFinanceArEffectiveSalesOrderWhere({
      AND: [
        secondaryWhere,
        takenPriorityIds.length > 0 ? { id: { notIn: takenPriorityIds } } : {},
      ],
    });
    const secondary = await prisma.salesOrder.findMany({
      where: where as never,
      select: ORDER_ID_SELECT,
      orderBy: { orderCode: "asc" },
    });
    secondaryEligibleIds = secondary.map((order) => order.id);
  }

  return summarizePortfolioOrderLimitSelection({
    configuredLimit: cap,
    priorityEligibleIdsInOrder: priorityEligibleIds,
    secondaryEligibleIdsExcludingTakenPriority: secondaryEligibleIds,
  });
}

export function mergeFinanceArEffectiveOrderContexts(
  ...groups: FinanceArEffectiveOrderContext[][]
): FinanceArEffectiveOrderContext[] {
  const byOrder = new Map<string, FinanceArEffectiveOrderContext>();
  for (const group of groups) {
    for (const ctx of group) {
      byOrder.set(ctx.schedule.salesOrderId, ctx);
    }
  }
  return [...byOrder.values()];
}
