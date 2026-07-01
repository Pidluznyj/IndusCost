#!/usr/bin/env npx tsx
/**
 * Bootstrap inicial da tabela oficial de custo de produção a partir do CIU da Engenharia.
 *
 * Uso:
 *   npx tsx scripts/bootstrap-production-cost-table-from-engineering.ts --preview
 *   npx tsx scripts/bootstrap-production-cost-table-from-engineering.ts --apply \
 *     --effectiveDate=2026-07-01 --code=2026-07 \
 *     --name="Tabela inicial de custo de produção — Jul/2026"
 *   npx tsx scripts/bootstrap-production-cost-table-from-engineering.ts --apply --publish --publishedBy=admin@empresa.com ...
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { civilDateToLocalDate, toCivilDateKey } from "../src/lib/financeCivilDate.ts";
import { createProductCostAnalysisEngine } from "../src/lib/productCostAnalysisEngine.server.ts";
import {
  applyBootstrapProductionCostTableFromEngineering,
  previewBootstrapProductionCostTableFromEngineering,
} from "../src/lib/productEngineeringCostSnapshot.server.ts";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const preview = hasFlag("preview");
  const apply = hasFlag("apply");
  if (!preview && !apply) {
    console.error("Informe --preview ou --apply.");
    process.exit(1);
  }

  const onlyProductCode = parseArg("onlyProductCode")?.trim() || null;
  const engine = createProductCostAnalysisEngine(prisma);
  await prisma.$connect();

  if (preview) {
    const result = await previewBootstrapProductionCostTableFromEngineering(prisma, engine, {
      onlyProductCode,
    });
    console.log("=== Preview — Bootstrap tabela de custo (Engenharia) ===\n");
    console.log(`Produtos ACTIVE avaliados: ${result.productsEvaluated}`);
    console.log(`Com custo calculável: ${result.calculableCount}`);
    console.log(`SEM_CUSTO: ${result.semCustoCount}`);
    console.log("\n--- Top 10 por custo ---");
    for (const row of result.topByCost) {
      console.log(
        `  ${row.sku} — R$ ${row.unitProductionCost?.toFixed(2) ?? "—"} hash=${row.calculationHash?.slice(0, 8) ?? "—"}`
      );
    }
    if (result.sampleProduct) {
      console.log("\n--- Amostra produto ---");
      console.log(JSON.stringify(result.sampleProduct, null, 2));
    }
    console.log(`\nErros: ${result.errors.length} | Avisos: ${result.warnings.length}`);
    if (result.errors.length > 0) {
      console.log("\nPrimeiros erros:");
      for (const e of result.errors.slice(0, 20)) {
        console.log(`  [${e.code}] ${e.sku}: ${e.message}`);
      }
    }
    console.log("\n--- JSON ---");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const effectiveDateRaw = parseArg("effectiveDate")?.trim() ?? toCivilDateKey(new Date());
  const effectiveDate = civilDateToLocalDate(effectiveDateRaw);
  if (Number.isNaN(effectiveDate.getTime())) {
    console.error(`--effectiveDate inválida: ${effectiveDateRaw}`);
    process.exit(1);
  }

  const code = parseArg("code")?.trim() ?? effectiveDateRaw.slice(0, 7);
  const name =
    parseArg("name")?.trim() ??
    `Tabela inicial de custo de produção — ${effectiveDateRaw.slice(0, 7)}`;
  const createdBy = parseArg("createdBy")?.trim() || null;
  const publishedBy = parseArg("publishedBy")?.trim() || null;
  const publish = hasFlag("publish");

  const result = await applyBootstrapProductionCostTableFromEngineering(prisma, engine, {
    effectiveDate,
    code,
    name,
    onlyProductCode,
    createdBy,
    publish,
    publishedBy,
  });

  console.log("=== Apply — Bootstrap tabela de custo (Engenharia) ===\n");
  console.log(`Versão: ${result.code} rev.${result.revision} [${result.status}]`);
  console.log(`versionId: ${result.versionId}`);
  console.log(`Produtos lidos: ${result.productsRead}`);
  console.log(`Itens criados: ${result.itemsCreated}`);
  console.log(`Itens ignorados (SEM_CUSTO): ${result.itemsSkipped}`);
  console.log(`Publicada: ${result.published ? "sim" : "não (DRAFT pendente)"}`);
  console.log("\n--- JSON ---");
  console.log(JSON.stringify(result, null, 2));

  if (result.itemsCreated === 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[bootstrap-production-cost-table-from-engineering]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
