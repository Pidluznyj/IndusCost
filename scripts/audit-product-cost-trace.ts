#!/usr/bin/env npx tsx
/**
 * Auditoria read-only: "Por que este produto custa isso?"
 *
 * Uso:
 *   npx tsx scripts/audit-product-cost-trace.ts --sku=618.08AA
 *   npx tsx scripts/audit-product-cost-trace.ts --product-id=<uuid> --date=2026-07-01 --json
 *   npx tsx scripts/audit-product-cost-trace.ts --sku=618.08AA --csv --outDir=tmp/product-cost-trace
 */
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildProductCostTraceCsv,
  formatProductCostTraceText,
} from "../src/lib/productCostTraceAudit.ts";
import {
  buildProductCostTraceAudit,
  parseProductCostTraceReferenceDate,
} from "../src/lib/productCostTraceAudit.server.ts";
import { hasFlag, parseArg, requireDatabaseUrl } from "./commission-audit-args.ts";

function parseProductIdArg(): string | undefined {
  return parseArg("product-id") ?? parseArg("productId");
}

function defaultCsvOutDir(sku: string | null): string {
  const safe = (sku ?? "product").replace(/[^\w.-]+/g, "_");
  return join("tmp", "product-cost-trace", safe);
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const sku = parseArg("sku")?.trim() || null;
  const productId = parseProductIdArg()?.trim() || null;
  const json = hasFlag("json");
  const csv = hasFlag("csv");

  if (!sku && !productId) {
    console.error("Informe --sku ou --product-id.");
    process.exit(1);
  }

  let referenceDate: Date;
  try {
    referenceDate = parseProductCostTraceReferenceDate(parseArg("date"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  await prisma.$connect();

  const report = await buildProductCostTraceAudit(prisma, {
    sku,
    productId,
    referenceDate,
    includeBom: hasFlag("include-bom") || !hasFlag("exclude-bom"),
    includeProcess: hasFlag("include-process") || !hasFlag("exclude-process"),
    includeMaterials: hasFlag("include-materials") || !hasFlag("exclude-materials"),
  });

  if (report.status === "FAIL") {
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(report.errorMessage ?? "Auditoria falhou.");
    }
    process.exit(1);
  }

  if (csv) {
    const outDir = parseArg("outDir")?.trim() || defaultCsvOutDir(report.product?.sku ?? sku);
    if (!outDir.replace(/\\/g, "/").startsWith("tmp/") && !outDir.includes("local-artifacts")) {
      console.warn(
        "Aviso: prefira --outDir=tmp/product-cost-trace para não sujar o git status."
      );
    }
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const stamp = report.auditedAt.replace(/[:.]/g, "-");
    const filePath = join(outDir, `product-cost-trace-${report.product?.sku ?? "product"}-${stamp}.csv`);
    writeFileSync(filePath, buildProductCostTraceCsv(report), "utf8");
    console.error(`CSV salvo em: ${filePath}`);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatProductCostTraceText(report));
  }
}

main()
  .catch((error) => {
    console.error("[audit-product-cost-trace]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
