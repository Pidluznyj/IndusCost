import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildNomusBomClassificationReport,
  classificationReportToCsv,
  type NomusBomClassificationReportFilters,
} from "../src/lib/nomusBomBatchReport.ts";
import type { NomusBomActionClass, NomusBomRiskLevel } from "../src/lib/nomusBomClassification.ts";

const prisma = new PrismaClient();

type CliArgs = {
  limit: number;
  offset: number;
  search?: string;
  onlyBlocked: boolean;
  onlyReview: boolean;
  onlyCandidates: boolean;
  risk?: NomusBomRiskLevel;
  actionClass?: NomusBomActionClass;
  format: "json" | "csv";
  outPath?: string;
};

function parseArgs(): CliArgs {
  const args: CliArgs = {
    limit: 100,
    offset: 0,
    onlyBlocked: false,
    onlyReview: false,
    onlyCandidates: false,
    format: "json",
  };

  for (const arg of process.argv.slice(2)) {
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
    const searchMatch = arg.match(/^--search=(.+)$/);
    if (searchMatch) {
      args.search = searchMatch[1].trim();
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
    if (arg === "--only-blocked") args.onlyBlocked = true;
    if (arg === "--only-review") args.onlyReview = true;
    if (arg === "--only-candidates") args.onlyCandidates = true;
  }

  return args;
}

function toFilters(args: CliArgs): NomusBomClassificationReportFilters {
  return {
    limit: args.limit,
    offset: args.offset,
    search: args.search,
    risk: args.risk,
    actionClass: args.actionClass,
    onlyBlocked: args.onlyBlocked || undefined,
    onlyReview: args.onlyReview || undefined,
    onlyCandidates: args.onlyCandidates || undefined,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const filters = toFilters(args);

  console.warn(
    `[nomus-bom-classify] início limit=${filters.limit} offset=${filters.offset ?? 0} risk=${filters.risk ?? ""} actionClass=${filters.actionClass ?? ""}`
  );

  const report = await buildNomusBomClassificationReport(filters);

  console.warn(
    `[nomus-bom-classify] concluído compared=${report.comparedCount} rows=${report.rows.length} blocked=${report.classificationSummary.blockedMissingParentProduct + report.classificationSummary.blockedMissingComponents}`
  );

  if (args.format === "csv") {
    const csv = classificationReportToCsv(report);
    if (args.outPath) {
      await mkdir(dirname(args.outPath), { recursive: true });
      await writeFile(args.outPath, csv, "utf8");
      console.warn(`[nomus-bom-classify] CSV gravado em ${args.outPath}`);
    }
    process.stdout.write(csv);
    return;
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);

  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, json, "utf8");
    console.warn(`[nomus-bom-classify] JSON gravado em ${args.outPath}`);
  }
}

main()
  .catch((err) => {
    console.error("[nomus-bom-classify] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
