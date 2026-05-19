import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  applyPlansReportToCsv,
  buildNomusBomApplyPlansReport,
  type NomusBomApplyPlanReportFilters,
} from "../src/lib/nomusBomApplyPlanLoad.ts";
import type { NomusBomActionClass, NomusBomRiskLevel } from "../src/lib/nomusBomClassification.ts";

const prisma = new PrismaClient();

type CliArgs = {
  sku?: string;
  limit: number;
  offset: number;
  onlyCandidates: boolean;
  onlyBlocked: boolean;
  onlyImportProducts: boolean;
  onlyUpdateQuantities: boolean;
  risk?: NomusBomRiskLevel;
  actionClass?: NomusBomActionClass;
  format: "json" | "csv";
  outPath?: string;
};

function parseArgs(): CliArgs {
  const args: CliArgs = {
    limit: 100,
    offset: 0,
    onlyCandidates: false,
    onlyBlocked: false,
    onlyImportProducts: false,
    onlyUpdateQuantities: false,
    format: "json",
  };

  for (const arg of process.argv.slice(2)) {
    const skuMatch = arg.match(/^--sku=(.+)$/);
    if (skuMatch) {
      args.sku = skuMatch[1].trim();
      continue;
    }
    const limitMatch = arg.match(/^--limit=(\d+)$/);
    if (limitMatch) {
      args.limit = Number.parseInt(limitMatch[1], 10);
      continue;
    }
    const offsetMatch = arg.match(/^--offset=(\d+)$/);
    if (offsetMatch) {
      args.offset = Number.parseInt(offsetMatch[1], 10);
      continue;
    }
    const riskMatch = arg.match(/^--risk=(LOW|MEDIUM|HIGH|BLOCKED)$/i);
    if (riskMatch) {
      args.risk = riskMatch[1].toUpperCase() as NomusBomRiskLevel;
      continue;
    }
    const actionClassMatch = arg.match(/^--action-class=(.+)$/);
    if (actionClassMatch) {
      args.actionClass = actionClassMatch[1].trim() as NomusBomActionClass;
      continue;
    }
    const outMatch = arg.match(/^--out=(.+)$/);
    if (outMatch) {
      args.outPath = outMatch[1].trim();
      continue;
    }
    const formatMatch = arg.match(/^--format=(json|csv)$/i);
    if (formatMatch) {
      args.format = formatMatch[1].toLowerCase() as CliArgs["format"];
      continue;
    }
    if (arg === "--only-candidates") args.onlyCandidates = true;
    if (arg === "--only-blocked") args.onlyBlocked = true;
    if (arg === "--only-import-products") args.onlyImportProducts = true;
    if (arg === "--only-update-quantities") args.onlyUpdateQuantities = true;
  }

  return args;
}

function toFilters(args: CliArgs): NomusBomApplyPlanReportFilters {
  return {
    sku: args.sku,
    limit: args.limit,
    offset: args.offset,
    risk: args.risk,
    actionClass: args.actionClass,
    onlyCandidates: args.onlyCandidates || undefined,
    onlyBlocked: args.onlyBlocked || undefined,
    onlyImportProducts: args.onlyImportProducts || undefined,
    onlyUpdateQuantities: args.onlyUpdateQuantities || undefined,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const filters = toFilters(args);

  console.warn(
    `[nomus-bom-plan] dry-run sku=${filters.sku ?? "(batch)"} limit=${filters.limit}`
  );

  const report = await buildNomusBomApplyPlansReport(filters);

  console.warn(
    `[nomus-bom-plan] concluído plans=${report.plans.length} importActions=${report.summary.importProductActions}`
  );

  if (args.format === "csv") {
    const csv = applyPlansReportToCsv(report);
    if (args.outPath) {
      await mkdir(dirname(args.outPath), { recursive: true });
      await writeFile(args.outPath, csv, "utf8");
      console.warn(`[nomus-bom-plan] CSV gravado em ${args.outPath}`);
    }
    process.stdout.write(csv);
    return;
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);

  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, json, "utf8");
    console.warn(`[nomus-bom-plan] JSON gravado em ${args.outPath}`);
  }
}

main()
  .catch((err) => {
    console.error("[nomus-bom-plan] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
