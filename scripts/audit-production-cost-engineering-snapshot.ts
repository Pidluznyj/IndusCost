#!/usr/bin/env npx tsx
/**
 * Auditoria: CIU atual vs custo congelado da Engenharia de Produto.
 *
 * Uso:
 *   npx tsx scripts/audit-production-cost-engineering-snapshot.ts --productCode=619.24AA --date=2026-07-01
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { civilDateToLocalDate, toCivilDateKey } from "../src/lib/financeCivilDate.ts";
import { createProductCostAnalysisEngine } from "../src/lib/productCostAnalysisEngine.server.ts";
import {
  evaluateProductEngineeringCost,
  getProductFrozenCostTrace,
} from "../src/lib/productEngineeringCostSnapshot.server.ts";
import { frozenCostTraceStatusLabel } from "../src/lib/productEngineeringCostSnapshot.ts";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }

  const productCode = parseArg("productCode")?.trim() || "619.24AA";
  const dateRaw = parseArg("date")?.trim() || toCivilDateKey(new Date());
  const referenceDate = civilDateToLocalDate(dateRaw);
  if (Number.isNaN(referenceDate.getTime())) {
    console.error(`--date inválida: ${dateRaw}`);
    process.exit(1);
  }

  await prisma.$connect();
  const engine = createProductCostAnalysisEngine(prisma);

  const product = await prisma.product.findFirst({
    where: { sku: productCode },
    select: { id: true, sku: true, name: true, status: true, type: true },
  });

  console.log("=== Auditoria — CIU Engenharia vs custo congelado ===\n");
  console.log(`Data referência: ${toCivilDateKey(referenceDate)}`);
  console.log(`Produto: ${productCode}`);

  if (!product) {
    console.log("\nProduto não encontrado.");
    process.exitCode = 1;
    return;
  }

  const evaluated = await evaluateProductEngineeringCost(prisma, engine, product.id);
  const trace = await getProductFrozenCostTrace(prisma, engine, product.id, referenceDate);

  console.log("\n--- CIU atual (Engenharia) ---");
  console.log(
    JSON.stringify(
      {
        sku: product.sku,
        name: product.name,
        status: product.status,
        type: product.type,
        liveCiu:
          evaluated.calculable && evaluated.resolved.ok ? evaluated.resolved.finalUnitCost : null,
        liveHash: evaluated.calculationHash,
        calculable: evaluated.calculable,
        errorCode: evaluated.errorCode,
        errorMessage: evaluated.errorMessage,
        warning: evaluated.warning,
      },
      null,
      2
    )
  );

  console.log("\n--- Custo congelado ---");
  console.log(JSON.stringify(trace, null, 2));

  if (trace) {
    console.log(`\nStatus rastreabilidade: ${frozenCostTraceStatusLabel(trace.traceStatus)}`);
    if (trace.liveHash && trace.frozenHash && trace.liveHash !== trace.frozenHash) {
      console.log("ALERTA: hash atual difere do hash congelado vigente.");
    }
    if (evaluated.calculable && !trace.frozenCost) {
      console.log("ALERTA: produto tem CIU calculável mas sem custo congelado vigente.");
    }
    if (
      evaluated.calculable &&
      evaluated.resolved.ok &&
      evaluated.resolved.finalUnitCost === 0 &&
      !evaluated.errorCode
    ) {
      console.log("INFO: custo zero — verificar se é zero explícito válido.");
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
