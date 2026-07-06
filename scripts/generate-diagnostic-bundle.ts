#!/usr/bin/env npx tsx
/**
 * Gera pacote ZIP "Gerar Relatório Analisável" (read-only).
 * Saída: tmp/diagnostic-bundles/ (gitignored)
 *
 * Uso:
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=SYSTEM
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=PRODUCT_ENGINEERING --sku=618.08AA
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=PUBLISHED_PRICE --sku=618.08AA --table-code=VAREJO_2
 *   npx tsx scripts/generate-diagnostic-bundle.ts --scope=COMMISSION_RECEIPT_CLOSING --year=2026 --month=6
 */
import "dotenv/config";
import { buildAndWriteDiagnosticBundle } from "../src/lib/diagnostics/diagnosticBundleBuilder.server.ts";
import { buildSystemDiagnosticBundleInput } from "../src/lib/diagnostics/systemDiagnostic.server.ts";
import { buildProductEngineeringDiagnosticBundleInput } from "../src/lib/diagnostics/productEngineeringDiagnostic.server.ts";
import { buildCommissionReceiptClosingDiagnosticBundleInput } from "../src/lib/diagnostics/commissionDiagnostic.server.ts";
import { buildPublishedPriceDiagnosticBundleInput } from "../src/lib/diagnostics/pricingDiagnostic.server.ts";
import { buildCostToCashDiagnosticBundleInput } from "../src/lib/diagnostics/costToCashDiagnostic.server.ts";
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
  const tableCode = parseArg("--table-code");

  let result;

  if (
    scope === "PRODUCT_ENGINEERING" ||
    scope === "PUBLISHED_PRICE" ||
    scope === "COMMISSION_RECEIPT_CLOSING" ||
    scope === "COST_TO_CASH"
  ) {
    if (!process.env.DATABASE_URL?.trim()) {
      console.error(
        `[generate-diagnostic-bundle] DATABASE_URL ausente — configure .env para ${scope}.`
      );
      process.exit(1);
    }
    await prisma.$connect();
  }

  if (scope === "SYSTEM") {
    if (process.env.DATABASE_URL?.trim()) {
      await prisma.$connect();
    }
    const input = await buildSystemDiagnosticBundleInput(
      process.env.DATABASE_URL?.trim() ? prisma : null,
      {
        screenTitle: "Gerar Relatório Analisável",
        screenRoute: "/settings/diagnostic-bundle",
      }
    );
    result = await buildAndWriteDiagnosticBundle(input);
  } else if (scope === "PRODUCT_ENGINEERING") {
    if (!sku && !productId) {
      console.error("[generate-diagnostic-bundle] Informe --sku ou --product-id para PRODUCT_ENGINEERING.");
      process.exit(1);
    }
    const input = await buildProductEngineeringDiagnosticBundleInput(prisma, {
      sku,
      productId,
      screenTitle: "Engenharia de Produto",
      screenRoute: "/products/engineering",
    });
    result = await buildAndWriteDiagnosticBundle(input);
  } else if (scope === "PUBLISHED_PRICE") {
    if (!parseArg("--price-item-id") && !sku && !productId) {
      console.error(
        "[generate-diagnostic-bundle] Informe --price-item-id ou --sku (com --table-code) para PUBLISHED_PRICE."
      );
      process.exit(1);
    }
    const input = await buildPublishedPriceDiagnosticBundleInput(prisma, {
      sku,
      productId,
      tableCode,
      priceItemId: parseArg("--price-item-id"),
      priceTableVersionId: parseArg("--price-table-version-id"),
      screenTitle: "Formação de Preço",
      screenRoute: "/pricing",
    });
    result = await buildAndWriteDiagnosticBundle(input);
  } else if (scope === "COMMISSION_RECEIPT_CLOSING") {
    const year = Number(parseArg("--year"));
    const month = Number(parseArg("--month"));
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      console.error("[generate-diagnostic-bundle] Informe --year e --month para COMMISSION_RECEIPT_CLOSING.");
      process.exit(1);
    }
    const input = await buildCommissionReceiptClosingDiagnosticBundleInput(prisma, {
      year,
      month,
      seller: parseArg("--seller"),
      customer: parseArg("--customer"),
      screenTitle: "Fechamento por Recebimento",
      screenRoute: "/commissions/receipt-closing",
    });
    result = await buildAndWriteDiagnosticBundle(input);
  } else if (scope === "COST_TO_CASH") {
    const orderNumber = parseArg("--order-number");
    const salesOrderId = parseArg("--sales-order-id");
    const nfeNumber = parseArg("--nfe-number");
    const receivableCode = parseArg("--receivable-code");
    const yearRaw = parseArg("--year");
    const monthRaw = parseArg("--month");
    const year = yearRaw ? Number(yearRaw) : null;
    const month = monthRaw ? Number(monthRaw) : null;

    if (
      !sku &&
      !productId &&
      !parseArg("--price-item-id") &&
      !salesOrderId &&
      !orderNumber &&
      !nfeNumber &&
      !receivableCode &&
      !(parseArg("--customer") && year != null)
    ) {
      console.error(
        "[generate-diagnostic-bundle] Informe --sku, --order-number, --nfe-number, --receivable-code ou --customer com --year para COST_TO_CASH."
      );
      process.exit(1);
    }

    const input = await buildCostToCashDiagnosticBundleInput(prisma, {
      sku,
      productId,
      tableCode,
      priceItemId: parseArg("--price-item-id"),
      salesOrderId,
      orderNumber,
      nfeNumber,
      receivableCode,
      year: Number.isInteger(year) ? year : null,
      month: Number.isInteger(month) ? month : null,
      seller: parseArg("--seller"),
      customer: parseArg("--customer"),
      screenTitle: "Rastreabilidade Custo → Caixa",
      screenRoute: "/reports/cost-to-cash-trace",
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
  }

  if (scope === "PUBLISHED_PRICE") {
    const evidence = JSON.parse(result.bundle.entries["evidence/published-price-trace.json"] ?? "{}");
    console.log(`SKU: ${evidence.product?.sku ?? sku ?? "—"}`);
    console.log(`Tabela: ${evidence.commercialTable?.tableCode ?? tableCode ?? "—"}`);
    console.log(`Preço: ${evidence.price?.salePrice ?? evidence.trace?.commercialPrice?.salePrice ?? "—"}`);
    console.log(`Custo usado: ${evidence.price?.costUsed ?? evidence.trace?.costSource?.industrialCost ?? "—"}`);
  }

  if (scope === "COMMISSION_RECEIPT_CLOSING") {
    const evidence = JSON.parse(result.bundle.entries["evidence/commission-trace.json"] ?? "{}");
    console.log(`Preview OK: ${evidence.capture?.ok ?? "—"}`);
    console.log(`Erro: ${evidence.capture?.error?.classification ?? "—"}`);
    console.log(`Recebido único: ${evidence.uniqueReceivedTotal ?? "—"}`);
  }

  if (scope === "COST_TO_CASH") {
    const evidence = JSON.parse(result.bundle.entries["evidence/cost-to-cash-timeline.json"] ?? "{}");
    const raw = JSON.parse(
      result.bundle.entries["evidence/raw-limited/cost-to-cash-summary.json"] ?? "{}"
    );
    console.log(`SKU: ${raw.sku ?? sku ?? "—"}`);
    console.log(
      `Timeline: ${raw.completedSteps ?? evidence.timeline?.completedSteps ?? "—"}/${raw.totalSteps ?? evidence.timeline?.totalSteps ?? "—"}`
    );
    console.log(`Cadeia: ${raw.chainBreakDescription ?? evidence.chainBreakDescription ?? "—"}`);
    console.log(`Diagnósticos: ${(raw.diagnosticCodes ?? []).join(", ") || "—"}`);
  }

  if (scope === "SYSTEM") {
    const snapshot = JSON.parse(result.bundle.entries["06_SYSTEM_SNAPSHOT.json"] ?? "{}");
    console.log(`Commit: ${snapshot.git?.commit ?? snapshot.app?.commit ?? "—"}`);
    console.log(`Branch: ${snapshot.git?.branch ?? "—"}`);
    console.log(`Migrations pendentes: ${snapshot.database?.pendingCount ?? "—"}`);
  }
}

main().catch((error) => {
  console.error("[generate-diagnostic-bundle]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
