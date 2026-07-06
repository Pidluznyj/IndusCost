import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildBomComparisonForParentCode,
  listDistinctParentCodesFromStage,
} from "../src/lib/nomusBomComparisonLoad.ts";
import type { BomComparisonResult } from "../src/lib/nomusBomComparison.ts";

const prisma = new PrismaClient();

function parseArgs() {
  let sku: string | null = null;
  let limit = 100;
  let onlyDivergent = false;
  let outPath: string | null = null;

  for (const arg of process.argv.slice(2)) {
    const skuMatch = arg.match(/^--sku=(.+)$/);
    if (skuMatch) {
      sku = skuMatch[1].trim();
      continue;
    }
    const limitMatch = arg.match(/^--limit=(\d+)$/);
    if (limitMatch) {
      limit = Math.max(1, Number.parseInt(limitMatch[1], 10));
      continue;
    }
    if (arg === "--only-divergent") {
      onlyDivergent = true;
      continue;
    }
    const outMatch = arg.match(/^--out=(.+)$/);
    if (outMatch) {
      outPath = outMatch[1].trim();
    }
  }

  return { sku, limit, onlyDivergent, outPath };
}

function aggregateSummary(results: BomComparisonResult[]) {
  return {
    parentsCompared: results.length,
    okCount: results.filter((r) => r.summary.status === "OK").length,
    divergentCount: results.filter((r) => r.summary.status === "DIVERGENT").length,
    blockedCount: results.filter((r) => r.summary.status === "BLOCKED").length,
    missingProductInIndusCost: results.filter((r) => r.summary.missingProductInIndusCost).length,
    noNomusBom: results.filter((r) => r.summary.nomusLines === 0).length,
    noIndusBom: results.filter((r) => r.summary.indusLines === 0 && !r.summary.missingProductInIndusCost)
      .length,
    quantityDiffs: results.reduce((acc, r) => acc + r.summary.quantityDiffs, 0),
    onlyInNomus: results.reduce((acc, r) => acc + r.summary.onlyInNomus, 0),
    onlyInIndusCost: results.reduce((acc, r) => acc + r.summary.onlyInIndusCost, 0),
  };
}

async function main(): Promise<void> {
  const { sku, limit, onlyDivergent, outPath } = parseArgs();
  const generatedAt = new Date().toISOString();

  console.warn(`[nomus-bom-compare] início sku=${sku ?? "(batch)"} limit=${limit}`);

  const parentCodes = sku ? [sku] : await listDistinctParentCodesFromStage(limit);
  const results: BomComparisonResult[] = [];

  for (const parentCode of parentCodes) {
    console.warn(`[nomus-bom-compare] comparando parentCode=${parentCode}`);
    const result = await buildBomComparisonForParentCode(parentCode);
    if (onlyDivergent && result.summary.status === "OK") continue;
    results.push(result);
  }

  const payload = {
    generatedAt,
    mode: "compare" as const,
    sku,
    summary: aggregateSummary(results),
    results,
  };

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  console.log(json);

  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, json, "utf8");
    console.warn(`[nomus-bom-compare] gravado em ${outPath}`);
  }
}

main()
  .catch((err) => {
    console.error("[nomus-bom-compare] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
