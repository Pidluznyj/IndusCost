#!/usr/bin/env npx tsx
/**
 * Gera pacote ZIP "Gerar Relatório Analisável" (read-only).
 * Saída: tmp/diagnostic-bundles/ (gitignored)
 *
 * Uso:
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=SYSTEM
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=COST_TO_CASH
 */
import { buildAndWriteDiagnosticBundle } from "../src/lib/diagnostics/diagnosticBundleBuilder.server.ts";
import type { DiagnosticScope } from "../src/lib/diagnostics/chatgptDiagnosticTypes.ts";

function parseScope(): DiagnosticScope {
  const arg = process.argv.find((a) => a.startsWith("--scope="));
  const raw = arg?.slice("--scope=".length)?.trim()?.toUpperCase() ?? "SYSTEM";
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
  const result = await buildAndWriteDiagnosticBundle({
    scope,
    context: {
      scope,
      screenTitle: "Gerar Relatório Analisável",
      screenRoute: scope === "COST_TO_CASH" ? "/reports/cost-to-cash-trace" : null,
      notes: "Gerado via CLI read-only.",
    },
  });

  console.log("=== ChatGPT Analyzable Diagnostic Bundle ===");
  console.log(`Escopo: ${scope}`);
  console.log(`Bundle ID: ${result.bundle.manifest.bundleId}`);
  console.log(`Pasta: ${result.outputDir}`);
  console.log(`ZIP: ${result.zipPath}`);
  console.log(`Arquivos: ${result.bundle.manifest.files.length}`);
}

main().catch((error) => {
  console.error("[generate-diagnostic-bundle]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
