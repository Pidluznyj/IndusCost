#!/usr/bin/env npx tsx
/**
 * Gera pacote ZIP "Gerar Relatório Analisável" (read-only).
 * Saída: tmp/diagnostic-bundles/ (gitignored)
 *
 * Uso:
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=SYSTEM
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=PRODUCT_ENGINEERING --sku=618.08AA
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=COST_TO_CASH
 */
import "dotenv/config";
import { buildAndWriteDiagnosticBundle } from "../src/lib/diagnostics/diagnosticBundleBuilder.server.ts";
import { buildProductEngineeringDiagnosticBundleInput } from "../src/lib/diagnostics/productEngineeringDiagnostic.server.ts";
import type { DiagnosticScope } from "../src/lib/diagnostics/chatgptDiagnosticTypes.ts";
import { prisma } from "../src/lib/prisma.ts";

function parseArg(prefix: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return arg?.slice(prefix.length + 1)?.trim() || null;
}

function parseScope(): DiagnosticScope {
  const raw = parseArg("--scope")?.toUpperCase() ?? "SYSTEM";
  const allowed: DiagnosticScope[] = [
    "SYSTEM",
    "PRODUCT_ENGINEERING",
    "PUBLISHED_PRICE",
    "SALES_ORDER",
    "COMMISSION_RECEIPT_CLOSING",
    "COST_TO_CASH",
  ];
  if (!allowed.includes(raw as DiagnosticScope)) {
    console.error(`Escopo inválido: ${raw}. Use: ${allowed.join(", ")}`);
    process.exit(1);
  }
  return raw as DiagnosticScope;
}

async function main(): Promise<void> {
  const scope = parseScope();
  const sku = parseArg("--sku");
  const productId = parseArg("--product-id");

  let result;
  if (scope === "PRODUCT_ENGINEERING") {
    if (!process.env.DATABASE_URL?.trim()) {
      console.error("[generate-diagnostic-bundle] DATABASE_URL ausente — configure .env para PRODUCT_ENGINEERING.");
      process.exit(1);
    }
    if (!sku && !productId) {
      console.error("[generate-diagnostic-bundle] Informe --sku ou --product-id para PRODUCT_ENGINEERING.");
      process.exit(1);
    }
    await prisma.$connect();
    const input = await buildProductEngineeringDiagnosticBundleInput(prisma, {
      sku,
      productId,
      screenTitle: "Engenharia de Produto",
      screenRoute: "/products/engineering",
      errorMessage:
        "Warning de custo pendente investigado — bundle gerado para diagnóstico ChatGPT.",
    });
    result = await buildAndWriteDiagnosticBundle(input);
  } else {
    result = await buildAndWriteDiagnosticBundle({
      scope,
      context: {
        scope,
        screenTitle: "Gerar Relatório Analisável",
        screenRoute: scope === "COST_TO_CASH" ? "/reports/cost-to-cash-trace" : null,
        notes: "Gerado via CLI read-only.",
      },
    });
  }

  console.log("=== ChatGPT Analyzable Diagnostic Bundle ===");
  console.log(`Escopo: ${scope}`);
  console.log(`Bundle ID: ${result.bundle.manifest.bundleId}`);
  console.log(`Pasta: ${result.outputDir}`);
  console.log(`ZIP: ${result.zipPath}`);
  console.log(`Arquivos: ${result.bundle.manifest.files.length}`);
  if (scope === "PRODUCT_ENGINEERING") {
    const evidence = JSON.parse(result.bundle.entries["evidence/product-cost-trace.json"] ?? "{}");
    console.log(`SKU: ${evidence.product?.sku ?? sku ?? "—"}`);
    console.log(`Warning: ${evidence.cost?.warningStatus ?? "—"}`);
    console.log(
      `Custo eng/oficial/diff: ${evidence.cost?.calculatedCurrent ?? "—"} / ${evidence.cost?.officialPublished ?? "—"} / ${evidence.cost?.difference ?? "—"}`
    );
  }
}

main().catch((error) => {
  console.error("[generate-diagnostic-bundle]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
