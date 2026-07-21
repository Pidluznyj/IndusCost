/**
 * FIN-08 — carrega agendas FIN-05 para enriquecer Contas a Receber.
 */

import type { PrismaClient } from "@prisma/client";
import { buildSalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";
import { getOrderFullAudit } from "./orderFullAuditService.js";
import { buildEffectiveScheduleInputFromAudit } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import { extractFinanceArOrderCodeHint } from "@/src/lib/financeAccountsReceivableTitles.js";
import {
  buildFinanceArEffectiveSalesOrderWhere,
} from "@/src/lib/financeArCancelledSalesOrderExclusion.server.js";
import { shouldIncludeSalesOrderInOperationalReceivables } from "@/src/lib/financeArCancelledSalesOrderExclusion.js";

const DEFAULT_ORDER_LIMIT = 24;

export type LoadFinanceArEffectiveOrderContextsInput = {
  search?: string | null;
  document?: string | null;
  customerPersonId?: number | null;
  customerName?: string | null;
  limit?: number;
};

function shouldLoadEffectiveContexts(
  input: LoadFinanceArEffectiveOrderContextsInput
): boolean {
  if (extractFinanceArOrderCodeHint(input.search, input.document)) return true;
  if (input.customerPersonId != null) return true;
  if ((input.customerName ?? "").trim()) return true;
  return false;
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
    40
  );
  const orderCodeHint = extractFinanceArOrderCodeHint(
    input.search,
    input.document
  );

  const whereParts: Array<Record<string, unknown>> = [];
  if (orderCodeHint) {
    const digits = orderCodeHint.replace(/^PD\s*/i, "").trim();
    whereParts.push({
      OR: [
        { orderCode: { equals: orderCodeHint, mode: "insensitive" } },
        { orderCode: { contains: orderCodeHint, mode: "insensitive" } },
        ...(digits
          ? [{ orderCode: { contains: digits, mode: "insensitive" as const } }]
          : []),
      ],
    });
  }

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

  // Evita N+1 sequencial: carrega audits em paralelo (pool limitado).
  // Ainda há 1 audit/pedido (custo do getOrderFullAudit); teto = `limit` ≤ 40.
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
