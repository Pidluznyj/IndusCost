#!/usr/bin/env npx tsx
/**
 * Validação read-only do núcleo Custo → Preço → Venda → Comissão.
 * Não aplica fechamento, não altera dados, não publica custo/preço.
 *
 * Uso:
 *   npx tsx scripts/validate-cost-to-cash-trace.ts
 *   npx tsx scripts/validate-cost-to-cash-trace.ts --live
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import { getReceiptClosingPreviewPage } from "../src/lib/commissions/commissionReceiptClosingApi.server.ts";
import {
  buildCommissionTrace,
  buildProductCostTrace,
  buildPublishedPriceTrace,
} from "../src/lib/audit/costToCashTrace.server.ts";
import { resolvePublishedPriceItemIdForTrace } from "../src/lib/audit/costToCashTraceResolve.server.ts";
import { hasFlag } from "./commission-audit-args.ts";

type CheckResult = {
  id: string;
  ok: boolean;
  detail: string;
};

const SKU = "618.08AA";
const TABLE_CODE = "VAREJO_2";
const PREVIEW_YEAR = 2026;
const PREVIEW_MONTH = 6;
const COMMISSION_SELLER = "GISLENE";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function push(results: CheckResult[], id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail });
  const mark = ok ? "OK" : "FAIL";
  console.log(`[${mark}] ${id}: ${detail}`);
}

function gitStatusClean(): boolean {
  const status = execSync("git status --short", { encoding: "utf8" }).trim();
  return status.length === 0;
}

async function runLiveChecks(results: CheckResult[]): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    push(
      results,
      "live.database",
      false,
      "DATABASE_URL ausente — configure .env para validação ao vivo."
    );
    return;
  }

  await prisma.$connect();

  try {
    const preview = await getReceiptClosingPreviewPage({
      year: PREVIEW_YEAR,
      month: PREVIEW_MONTH,
    });
    push(
      results,
      "live.commission-preview",
      preview != null && typeof preview === "object",
      `Preview jun/${PREVIEW_YEAR} retornou payload (${preview.lines?.length ?? 0} linhas).`
    );
  } catch (error) {
    push(
      results,
      "live.commission-preview",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    const product = await buildProductCostTrace(prisma, {
      sku: SKU,
      productId: null,
      referenceDate: new Date(),
      includeBom: true,
      includeProcess: true,
      includeMaterials: true,
    });
    const critical = product.alerts.filter((a) => a.severity === "critical" || a.severity === "error");
    const diff = product.currentCost.difference;
    const aligned =
      product.status === "PASS" &&
      (critical.length === 0 ||
        (diff != null && Math.abs(diff) < 0.0001 && !product.currentCost.warning?.blocking));
    push(
      results,
      "live.product-cost-618",
      product.status === "PASS",
      `status=${product.status}; oficial=${product.currentCost.officialPublishedCost}; eng=${product.currentCost.engineeringCost}; BOM=${product.bom.componentCount}; alertas críticos=${critical.length}`
    );
    push(
      results,
      "live.product-cost-no-critical-drift",
      aligned,
      critical.length
        ? `críticos: ${critical.map((a) => a.code).join(", ")}`
        : "sem alerta crítico de divergência custo oficial × calculado"
    );
  } catch (error) {
    push(results, "live.product-cost-618", false, error instanceof Error ? error.message : String(error));
  }

  try {
    const resolved = await resolvePublishedPriceItemIdForTrace(prisma, {
      sku: SKU,
      tableCode: TABLE_CODE,
    });
    if (!resolved.priceItemId) {
      push(results, "live.published-price-618-varejo2", false, resolved.errorMessage ?? "sem priceItemId");
    } else {
      const price = await buildPublishedPriceTrace(prisma, { priceItemId: resolved.priceItemId });
      push(
        results,
        "live.published-price-618-varejo2",
        price.commercialPrice.salePrice != null,
        `preço=${price.commercialPrice.salePrice}; custo=${price.costSource.industrialCost}; margem=${price.marginSource.publishedMarginPercent}%; comissão=${price.commissionSource.commissionAmount}; imposto=${price.taxSource.taxAmount}`
      );
    }
  } catch (error) {
    push(
      results,
      "live.published-price-618-varejo2",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    const commission = await buildCommissionTrace(prisma, {
      year: PREVIEW_YEAR,
      month: PREVIEW_MONTH,
      seller: COMMISSION_SELLER,
      includeLines: true,
    });
    push(
      results,
      "live.commission-gislene-june",
      commission.status === "PASS" || commission.items.length > 0 || commission.receipts.length > 0,
      `status=${commission.status}; itens=${commission.items.length}; receipts=${commission.receipts.length}; final=${commission.totals.totalFinalCommission}`
    );
  } catch (error) {
    push(
      results,
      "live.commission-gislene-june",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  const live = hasFlag("live") || Boolean(process.env.DATABASE_URL?.trim());

  console.log("=== Validação Cost-to-Cash Trace ===\n");

  push(
    results,
    "static.trace-page",
    read("src/components/audit/CostToCashTracePage.tsx").includes("cost-to-cash-trace-page"),
    "CostToCashTracePage registrada"
  );
  push(
    results,
    "static.export-dossier",
    read("src/lib/audit/costToCashTraceExport.ts").includes("exportCostToCashDossierJson"),
    "Export JSON/CSV do dossiê"
  );
  push(
    results,
    "static.price-modal-tab",
    read("src/components/PricingModule.tsx").includes("Fonte do Preço"),
    "Modal de preço com aba Fonte do Preço"
  );
  push(
    results,
    "static.script-product-cost",
    existsSync("scripts/audit-product-cost-trace.ts"),
    "audit-product-cost-trace.ts"
  );
  push(
    results,
    "static.script-published-price",
    existsSync("scripts/audit-published-price-trace.ts"),
    "audit-published-price-trace.ts"
  );
  push(
    results,
    "static.script-sales-order",
    existsSync("scripts/audit-sales-order-trace.ts"),
    "audit-sales-order-trace.ts"
  );
  push(
    results,
    "static.script-commission",
    existsSync("scripts/audit-commission-trace.ts"),
    "audit-commission-trace.ts"
  );
  push(
    results,
    "static.closing-blocked-without-confirm",
    read("src/lib/commissions/commissionReceiptClosing.ts").includes("RECEIPT_CLOSING_CONFIRM_APPLY"),
    "Fechamento exige confirmação explícita"
  );
  push(
    results,
    "static.tmp-gitignored",
    read(".gitignore").includes("tmp/"),
    "tmp/ ignorado pelo git"
  );

  if (live) {
    console.log("\n--- Validação ao vivo (read-only) ---\n");
    await runLiveChecks(results);
  } else {
    push(results, "live.skipped", true, "Passe --live ou configure DATABASE_URL para checks ao vivo.");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nResumo: ${results.length - failed.length}/${results.length} OK`);
  if (failed.length) {
    console.error("\nFalhas:");
    for (const item of failed) console.error(`  - ${item.id}: ${item.detail}`);
    process.exitCode = 1;
  }

  if (live && gitStatusClean()) {
    push(results, "git.clean-after-live", true, "git status limpo após validação");
  }
}

main()
  .catch((error) => {
    console.error("[validate-cost-to-cash-trace]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
