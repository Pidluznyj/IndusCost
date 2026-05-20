import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import { normalizeSku } from "../src/lib/nomusBomComparison.ts";
import {
  applyPlansReportToCsv,
  buildNomusBomApplyPlansReport,
  type NomusBomApplyPlansReport,
  type NomusBomApplyPlanReportFilters,
} from "../src/lib/nomusBomApplyPlanLoad.ts";
import { aggregateApplyPlansSummary } from "../src/lib/nomusBomApplyPlan.ts";
import type { NomusBomActionClass, NomusBomRiskLevel } from "../src/lib/nomusBomClassification.ts";

const prisma = new PrismaClient();

type CliArgs = {
  sku?: string;
  parentCode?: string;
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
    const parentMatch = arg.match(/^--parentCode=(.+)$/);
    if (parentMatch) {
      args.parentCode = parentMatch[1].trim();
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
  if (args.parentCode) {
    return {
      parentCode: args.parentCode,
      limit: 1,
      offset: 0,
      risk: args.risk,
      actionClass: args.actionClass,
      onlyCandidates: args.onlyCandidates || undefined,
      onlyBlocked: args.onlyBlocked || undefined,
      onlyImportProducts: args.onlyImportProducts || undefined,
      onlyUpdateQuantities: args.onlyUpdateQuantities || undefined,
    };
  }

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

function assertSingleParentPlan(report: NomusBomApplyPlansReport, parentCode: string): NomusBomApplyPlansReport {
  const wanted = normalizeSku(parentCode);
  const matching = report.plans.filter((p) => normalizeSku(p.parentCode) === wanted);

  if (matching.length === 0) {
    throw new Error(
      `Nenhum plano gerado para parentCode exato "${parentCode}". Verifique se o produto existe no stage Nomus.`
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `Mais de um plano retornado para parentCode "${parentCode}" (${matching.length}). Abortando validação.`
    );
  }

  return {
    ...report,
    comparedCount: 1,
    totalParentsInNomusStage: 1,
    plans: matching,
    summary: aggregateApplyPlansSummary(matching),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const filters = toFilters(args);

  if (args.parentCode && args.sku) {
    console.warn("[nomus-bom-plan] --parentCode tem prioridade; --sku ignorado.");
  }

  console.warn(
    `[nomus-bom-plan] dry-run parentCode=${filters.parentCode ?? "(none)"} sku=${filters.sku ?? "(none)"} limit=${filters.limit}`
  );

  let report = await buildNomusBomApplyPlansReport(filters);

  if (args.parentCode) {
    if (report.totalParentsInNomusStage === 0) {
      throw new Error(
        `parentCode "${args.parentCode}" não encontrado no NomusBomComponentStage (match exato).`
      );
    }
    report = assertSingleParentPlan(report, args.parentCode);
  }

  console.warn(
    `[nomus-bom-plan] concluído plans=${report.plans.length} parentCodes=${report.plans.map((p) => p.parentCode).join(",") || "(none)"}`
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
