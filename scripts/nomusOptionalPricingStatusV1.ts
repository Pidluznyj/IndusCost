import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  listProductsWithOptionalNomusItems,
  type PricingOptionalStatus,
} from "../src/lib/nomusOptionalPricingSelection.ts";

const prisma = new PrismaClient();

type CliArgs = {
  search?: string;
  status?: PricingOptionalStatus;
  limit: number;
  offset: number;
  outPath?: string;
};

function parseArgs(): CliArgs {
  const args: CliArgs = { limit: 100, offset: 0 };
  for (const arg of process.argv.slice(2)) {
    const search = arg.match(/^--search=(.+)$/);
    if (search) {
      args.search = search[1].trim();
      continue;
    }
    const status = arg.match(/^--status=(PENDING|RESOLVED|NO_OPTIONALS|STALE)$/);
    if (status) {
      args.status = status[1] as PricingOptionalStatus;
      continue;
    }
    const limit = arg.match(/^--limit=(\d+)$/);
    if (limit) {
      args.limit = Number.parseInt(limit[1], 10);
      continue;
    }
    const offset = arg.match(/^--offset=(\d+)$/);
    if (offset) {
      args.offset = Number.parseInt(offset[1], 10);
      continue;
    }
    const out = arg.match(/^--out=(.+)$/);
    if (out) args.outPath = out[1].trim();
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.warn(
    `[nomus-optional-pricing-status] search=${args.search ?? "-"} status=${args.status ?? "-"}`
  );

  const report = await listProductsWithOptionalNomusItems({
    search: args.search,
    status: args.status,
    limit: args.limit,
    offset: args.offset,
  });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);

  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, json, "utf8");
    console.warn(`[nomus-optional-pricing-status] gravado em ${args.outPath}`);
  }
}

main()
  .catch((err) => {
    console.error("[nomus-optional-pricing-status] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
