/**
 * Shadow comparison read-only: estágio persistido vs motor atual (nova regra).
 *
 * Uso:
 *   npx tsx scripts/shadowCompareSalesOrderFlowStages.ts
 *   npx tsx scripts/shadowCompareSalesOrderFlowStages.ts --limit=500
 *
 * Requisitos: DATABASE_URL no ambiente.
 * Não persiste, não sync, não recompute, não altera dados.
 */

import { PrismaClient } from "@prisma/client";
import { loadSalesOrderFlowEvidence } from "../src/lib/sales/salesOrderFlowEvidence.server.js";
import { resolveSalesOrderItemFlowFromEvidence } from "../src/lib/sales/salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "../src/lib/sales/salesOrderFlowEngine.js";

type Stage = string;

function parseLimit(argv: string[]): number {
  const raw = argv.find((a) => a.startsWith("--limit="));
  if (!raw) return 200;
  const n = Number(raw.slice("--limit=".length));
  return Number.isFinite(n) && n > 0 ? Math.min(5000, Math.floor(n)) : 200;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      "[shadow-compare] DATABASE_URL ausente — execute no servidor com banco local/staging."
    );
    console.error(
      "Este script é estritamente read-only e não altera snapshots nem sincroniza Nomus."
    );
    process.exitCode = 2;
    return;
  }

  const limit = parseLimit(process.argv.slice(2));
  const prisma = new PrismaClient();

  const same = new Map<Stage, number>();
  const transitions = new Map<string, number>();
  const special = {
    liberatedOpBackToWaitingProduction: 0,
    releaseToWaitingNfe: 0,
    releaseToWaitingOutput: 0,
    withClosedOp: 0,
    errors: 0,
  };

  try {
    const snapshots = await prisma.salesOrderFlowSnapshot.findMany({
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        salesOrderId: true,
        currentStage: true,
      },
    });

    console.log(`[shadow-compare] pedidos amostrados: ${snapshots.length}`);

    for (const snap of snapshots) {
      try {
        const pack = await loadSalesOrderFlowEvidence(prisma, snap.salesOrderId);
        if (!pack) {
          special.errors += 1;
          continue;
        }

        const itemResults = pack.items
          .map((item) => resolveSalesOrderItemFlowFromEvidence(pack, item.id))
          .filter((r): r is NonNullable<typeof r> => r != null);

        const order = resolveSalesOrderFlow(itemResults, {
          salesOrderId: snap.salesOrderId,
        });

        const from = snap.currentStage ?? "NULL";
        const to = order.currentStage;
        if (from === to) {
          same.set(to, (same.get(to) ?? 0) + 1);
        } else {
          const key = `${from}→${to}`;
          transitions.set(key, (transitions.get(key) ?? 0) + 1);
        }

        const hasClosed = pack.productionOrders.some(
          (o) => (o.status ?? "").toLowerCase().includes("encerr")
        );
        if (hasClosed) special.withClosedOp += 1;

        if (
          from === "WAITING_OUTPUT_DOCUMENT" &&
          to === "WAITING_PRODUCTION_ORDER"
        ) {
          special.liberatedOpBackToWaitingProduction += 1;
        }
        if (from === "WAITING_RELEASE" && to === "WAITING_NFE") {
          special.releaseToWaitingNfe += 1;
        }
        if (from === "WAITING_RELEASE" && to === "WAITING_OUTPUT_DOCUMENT") {
          special.releaseToWaitingOutput += 1;
        }
      } catch {
        special.errors += 1;
      }
    }

    console.log("\n=== Permaneceriam iguais (por estágio calculado) ===");
    for (const [stage, count] of [...same.entries()].sort()) {
      console.log(`${stage}: ${count}`);
    }

    console.log("\n=== Transições (persistido → calculado) ===");
    for (const [key, count] of [...transitions.entries()].sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`${key}: ${count}`);
    }

    console.log("\n=== Recortes especiais ===");
    console.log(
      `WAITING_OUTPUT_DOCUMENT → WAITING_PRODUCTION_ORDER: ${special.liberatedOpBackToWaitingProduction}`
    );
    console.log(
      `WAITING_RELEASE → WAITING_NFE: ${special.releaseToWaitingNfe}`
    );
    console.log(
      `WAITING_RELEASE → WAITING_OUTPUT_DOCUMENT: ${special.releaseToWaitingOutput}`
    );
    console.log(`Pedidos com OP Encerrada na amostra: ${special.withClosedOp}`);
    console.log(`Erros/leitura incompleta: ${special.errors}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[shadow-compare] falha", err);
  process.exitCode = 1;
});
