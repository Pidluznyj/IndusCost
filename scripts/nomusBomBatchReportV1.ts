import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  batchReportToCsv,
  buildNomusBomBatchReport,
  type NomusBomBatchReportFilters,
} from "../src/lib/nomusBomBatchReport.ts";

const prisma = new PrismaClient();

type CliArgs = {
  limit: number;
  offset: number;
  status: NomusBomBatchReportFilters["status"];
  onlyDivergent: boolean;
  onlyMissingProduct: boolean;
  onlyNoIndusBom: boolean;
  onlyQuantityDiffs: boolean;
  onlyOnlyInNomus: boolean;
  onlyOnlyInIndus: boolean;
  search?: string;
  outPath?: string;
  format: "json" | "csv";
};

function parseArgs(): CliArgs {
  const args: CliArgs = {
    limit: 100,
    offset: 0,
    status: "ALL",
    onlyDivergent: false,
    onlyMissingProduct: false,
    onlyNoIndusBom: false,
    onlyQuantityDiffs: false,
    onlyOnlyInNomus: false,
    onlyOnlyInIndus: false,
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
    const statusMatch = arg.match(/^--status=(ALL|OK|DIVERGENT|BLOCKED)$/i);
    if (statusMatch) {
      args.status = statusMatch[1].toUpperCase() as CliArgs["status"];
      continue;
    }
    const searchMatch = arg.match(/^--search=(.+)$/);
    if (searchMatch) {
      args.search = searchMatch[1].trim();
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
    if (arg === "--only-divergent") args.onlyDivergent = true;
    if (arg === "--only-missing-product") args.onlyMissingProduct = true;
    if (arg === "--only-no-indus-bom") args.onlyNoIndusBom = true;
    if (arg === "--only-quantity-diffs") args.onlyQuantityDiffs = true;
    if (arg === "--only-only-in-nomus") args.onlyOnlyInNomus = true;
    if (arg === "--only-only-in-indus") args.onlyOnlyInIndus = true;
  }

  if (args.onlyDivergent && args.status === "ALL") {
    args.status = "DIVERGENT";
  }

  return args;
}

function toFilters(args: CliArgs): NomusBomBatchReportFilters {
  return {
    limit: args.limit,
    offset: args.offset,
    status: args.status,
    onlyMissingProductInIndus: args.onlyMissingProduct || undefined,
    onlyNoIndusBom: args.onlyNoIndusBom || undefined,
    onlyQuantityDiffs: args.onlyQuantityDiffs || undefined,
    onlyOnlyInNomus: args.onlyOnlyInNomus || undefined,
    onlyOnlyInIndusCost: args.onlyOnlyInIndus || undefined,
    search: args.search,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const filters = toFilters(args);

  console.warn(
    `[nomus-bom-report] início limit=${filters.limit} offset=${filters.offset ?? 0} status=${filters.status ?? "ALL"} search=${filters.search ?? ""}`
  );

  const report = await buildNomusBomBatchReport(filters);

  console.warn(
    `[nomus-bom-report] concluído compared=${report.comparedCount} rows=${report.rows.length} divergent=${report.summary.divergentCount}`
  );

  if (args.format === "csv") {
    const csv = batchReportToCsv(report);
    if (args.outPath) {
      await mkdir(dirname(args.outPath), { recursive: true });
      await writeFile(args.outPath, csv, "utf8");
      console.warn(`[nomus-bom-report] CSV gravado em ${args.outPath}`);
    }
    process.stdout.write(csv);
    return;
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);

  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, json, "utf8");
    console.warn(`[nomus-bom-report] JSON gravado em ${args.outPath}`);
  }
}

main()
  .catch((err) => {
    console.error("[nomus-bom-report] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
