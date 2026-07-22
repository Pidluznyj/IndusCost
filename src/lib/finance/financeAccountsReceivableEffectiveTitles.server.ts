/**
 * FIN-08 — carrega agendas FIN-05 para enriquecer Contas a Receber.
 */

import type { PrismaClient } from "@prisma/client";
import { buildSalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";
import { getOrderFullAudit } from "./orderFullAuditService.js";
import { buildEffectiveScheduleInputFromAudit } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import { extractFinanceArOrderCodeHint } from "./financeArOperationalPortfolio.js";
import { extractFinanceArOrderCodeHint as extractFinanceArOrderCodeHintFromQuery } from "@/src/lib/financeAccountsReceivableTitles.js";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  buildFinanceArEffectiveSalesOrderWhere,
} from "@/src/lib/financeArCancelledSalesOrderExclusion.server.js";
import { shouldIncludeSalesOrderInOperationalReceivables } from "@/src/lib/financeArCancelledSalesOrderExclusion.js";

const DEFAULT_ORDER_LIMIT = 24;
const PORTFOLIO_ORDER_LIMIT = 40;

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
      SalesOrder: { select: { orderCode: true } },
    },
  });

  const codes = new Set<string>();
  for (const link of links) {
    const code = link.SalesOrder?.orderCode?.trim();
    if (code) codes.add(code);
  }
  return [...codes];
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
  referenceDate: Date
): Promise<FinanceArEffectiveOrderContext[]> {
  const CONCURRENCY = 4;
  const contexts: FinanceArEffectiveOrderContext[] = [];

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
 * Resolve pedidos do contexto (Pedido e/ou cliente) e monta agendas FIN-05.
 */
export async function loadFinanceArEffectiveOrderContexts(
  prisma: PrismaClient,
  input: LoadFinanceArEffectiveOrderContextsInput,
  referenceDate: Date = new Date()
): Promise<FinanceArEffectiveOrderContext[]> {
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

  const orders = await prisma.salesOrder.findMany({
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

  return buildFinanceArEffectiveContextsForOrders(prisma, orders, referenceDate);
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
  limit = PORTFOLIO_ORDER_LIMIT
): Promise<FinanceArEffectiveOrderContext[]> {
  const fromDescriptions = collectFinanceArOrderCodesFromPortfolioRows(rows);
  const fromInvoices = await resolveFinanceArOrderCodesFromInvoiceLinks(
    prisma,
    rows
  );
  const portfolioOrderCodes = [...new Set([...fromDescriptions, ...fromInvoices])];
  if (portfolioOrderCodes.length === 0) return [];

  return loadFinanceArEffectiveOrderContexts(
    prisma,
    { portfolioOrderCodes, limit },
    referenceDate
  );
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
