/**
 * Repara qty atendida Nomus (parse pt-BR / FULFILLED coerente) e recomputa o fluxo.
 *
 * Uso:
 *   npx tsx scripts/repairSalesOrderFulfilledQtyAndFlow.ts --order="PD 02586"
 *   npx tsx scripts/repairSalesOrderFulfilledQtyAndFlow.ts --order="PD 02586" --apply
 *
 * Sem --apply: só inspeciona e faz dry-run do recompute.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { backfillSalesOrderItemNomusStatusForOrder } from "../src/lib/sales/backfillSalesOrderItemNomusStatus.server.ts";
import { recomputeSalesOrderFlow } from "../src/lib/sales/salesOrderFlowRecompute.server.ts";

const LOG = "[repair-fulfilled-qty-flow]";

function parseOrderCode(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith("--order=")) {
      const v = arg.slice("--order=".length).trim();
      return v.length > 0 ? v : null;
    }
  }
  return null;
}

function wantsApply(argv: string[]): boolean {
  return argv.includes("--apply");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const orderCode = parseOrderCode(argv);
  const apply = wantsApply(argv);
  if (!orderCode) {
    console.error(LOG, 'Informe --order="PD 02586"');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const order = await prisma.salesOrder.findFirst({
      where: { orderCode },
      select: {
        id: true,
        orderCode: true,
        items: {
          select: {
            id: true,
            quantity: true,
            nomusQuantityFulfilled: true,
            nomusItemStatusNormalized: true,
            nomusMatchReason: true,
          },
        },
        flowSnapshot: {
          select: {
            currentStage: true,
            activeResidualValue: true,
            bottleneckReason: true,
          },
        },
      },
    });
    if (!order) {
      console.error(LOG, "pedido não encontrado:", orderCode);
      process.exit(1);
    }

    console.log(LOG, "antes", {
      id: order.id,
      orderCode: order.orderCode,
      stage: order.flowSnapshot?.currentStage ?? null,
      activeResidualValue: order.flowSnapshot?.activeResidualValue?.toString() ?? null,
      bottleneckReason: order.flowSnapshot?.bottleneckReason ?? null,
      items: order.items.map((i) => ({
        id: i.id,
        quantity: i.quantity?.toString() ?? null,
        fulfilled: i.nomusQuantityFulfilled?.toString() ?? null,
        status: i.nomusItemStatusNormalized,
        matchReason: i.nomusMatchReason,
      })),
    });

    if (!apply) {
      console.log(LOG, "preview only — passe --apply para gravar backfill + recompute");
      process.exit(0);
    }

    const backfill = await backfillSalesOrderItemNomusStatusForOrder(prisma, order.id);
    const recompute = await recomputeSalesOrderFlow(prisma, order.id, {
      source: "manual",
      emitObservabilityLog: true,
    });

    const after = await prisma.salesOrder.findUnique({
      where: { id: order.id },
      select: {
        items: {
          select: {
            id: true,
            quantity: true,
            nomusQuantityFulfilled: true,
            nomusItemStatusNormalized: true,
            nomusMatchReason: true,
          },
        },
        flowSnapshot: {
          select: {
            currentStage: true,
            activeResidualValue: true,
            bottleneckReason: true,
          },
        },
      },
    });

    console.log(LOG, "depois", {
      backfillUpdated: backfill.updated,
      recomputeAction: recompute.action,
      recomputeStage: recompute.currentOrderStage,
      stage: after?.flowSnapshot?.currentStage ?? null,
      activeResidualValue: after?.flowSnapshot?.activeResidualValue?.toString() ?? null,
      bottleneckReason: after?.flowSnapshot?.bottleneckReason ?? null,
      items: (after?.items ?? []).map((i) => ({
        id: i.id,
        quantity: i.quantity?.toString() ?? null,
        fulfilled: i.nomusQuantityFulfilled?.toString() ?? null,
        status: i.nomusItemStatusNormalized,
        matchReason: i.nomusMatchReason,
      })),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(LOG, "fatal", message);
  if (/Can't reach database|P1001|DATABASE_URL/i.test(message)) {
    console.error(
      LOG,
      "Banco indisponível neste ambiente. Com DATABASE_URL apontando para o Postgres alvo, rode:",
      'npx tsx scripts/repairSalesOrderFulfilledQtyAndFlow.ts --order="PD 02586" --apply'
    );
  }
  process.exit(1);
});
