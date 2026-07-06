#!/usr/bin/env npx tsx
/**
 * Auditoria read-only: "De onde veio este preço publicado?"
 *
 * Uso:
 *   npx tsx scripts/audit-published-price-trace.ts --sku=618.08AA --table-code=VAREJO_2
 *   npx tsx scripts/audit-published-price-trace.ts --price-item-id=<uuid> --json --csv
 *   npx tsx scripts/audit-published-price-trace.ts --sku=618.08AA --table-code=VAREJO_2 --json --csv
 */
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildPublishedPriceTraceCsv,
  formatPublishedPriceTraceText,
} from "../src/lib/audit/publishedPriceTrace.ts";
import { buildPublishedPriceTrace } from "../src/lib/audit/costToCashTrace.server.ts";
import { resolvePublishedPriceItemIdForTrace } from "../src/lib/audit/costToCashTraceResolve.server.ts";
import { hasFlag, parseArg, requireDatabaseUrl } from "./commission-audit-args.ts";

function parseTableCodeArg(): string | undefined {
  return parseArg("table-code") ?? parseArg("tableCode");
}

function defaultCsvOutDir(sku: string | null, tableCode: string | null): string {
  const safeSku = (sku ?? "price").replace(/[^\w.-]+/g, "_");
  const safeTable = (tableCode ?? "table").replace(/[^\w.-]+/g, "_");
  return join("tmp", "published-price-trace", `${safeSku}-${safeTable}`);
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const sku = parseArg("sku")?.trim() || null;
  const productId = parseArg("product-id")?.trim() || parseArg("productId")?.trim() || null;
  const tableCode = parseTableCodeArg()?.trim() || null;
  const tableId = parseArg("table-id")?.trim() || parseArg("tableId")?.trim() || null;
  const priceItemIdArg = parseArg("price-item-id")?.trim() || parseArg("priceItemId")?.trim() || null;
  const json = hasFlag("json");
  const csv = hasFlag("csv");

  if (!priceItemIdArg && !sku && !productId) {
    console.error("Informe --price-item-id ou --sku (com --table-code opcional).");
    process.exit(1);
  }

  await prisma.$connect();

  const resolved = await resolvePublishedPriceItemIdForTrace(prisma, {
    priceItemId: priceItemIdArg,
    sku,
    productId,
    tableCode,
    tableId,
  });

  if (!resolved.priceItemId) {
    const message = resolved.errorMessage ?? "Preço publicado não encontrado.";
    if (json) {
      console.log(JSON.stringify({ status: "FAIL", errorMessage: message }, null, 2));
    } else {
      console.error(message);
    }
    process.exit(1);
  }

  const report = await buildPublishedPriceTrace(prisma, {
    priceItemId: resolved.priceItemId,
    productId,
    tableId,
  });

  if (csv) {
    const outDir = parseArg("outDir")?.trim() || defaultCsvOutDir(report.product.sku, report.commercialPrice.tableCode);
    if (!outDir.replace(/\\/g, "/").startsWith("tmp/") && !outDir.includes("local-artifacts")) {
      console.warn("Aviso: prefira --outDir=tmp/published-price-trace para não sujar o git status.");
    }
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(
      outDir,
      `published-price-trace-${report.product.sku}-${report.commercialPrice.tableCode}-${stamp}.csv`
    );
    writeFileSync(filePath, buildPublishedPriceTraceCsv(report), "utf8");
    console.error(`CSV salvo em: ${filePath}`);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatPublishedPriceTraceText(report));
  }
}

main()
  .catch((error) => {
    console.error("[audit-published-price-trace]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
