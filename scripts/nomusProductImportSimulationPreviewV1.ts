import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildNomusProductImportSimulationPreview } from "../src/lib/nomusProductImportSimulation.ts";

const prisma = new PrismaClient();

type CliArgs = {
  parentCode?: string;
  recursive: boolean;
  maxDepth: number;
  outPath?: string;
};

function parseArgs(): CliArgs {
  const args: CliArgs = { recursive: true, maxDepth: 10 };
  for (const arg of process.argv.slice(2)) {
    const parent = arg.match(/^--parentCode=(.+)$/);
    if (parent) {
      args.parentCode = parent[1].trim();
      continue;
    }
    if (arg === "--recursive") {
      args.recursive = true;
      continue;
    }
    if (arg === "--no-recursive") {
      args.recursive = false;
      continue;
    }
    const depth = arg.match(/^--maxDepth=(\d+)$/);
    if (depth) {
      args.maxDepth = Number.parseInt(depth[1], 10);
      continue;
    }
    const out = arg.match(/^--out=(.+)$/);
    if (out) args.outPath = out[1].trim();
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.parentCode) {
    console.error("[nomus-product-import-preview] --parentCode é obrigatório.");
    process.exitCode = 1;
    return;
  }

  console.warn(
    `[nomus-product-import-preview] parentCode=${args.parentCode} recursive=${args.recursive} maxDepth=${args.maxDepth}`
  );

  const report = await buildNomusProductImportSimulationPreview({
    parentCode: args.parentCode,
    recursive: args.recursive,
    maxDepth: args.maxDepth,
  });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);

  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, json, "utf8");
    console.warn(`[nomus-product-import-preview] gravado em ${args.outPath}`);
  }
}

main()
  .catch((err) => {
    console.error(
      "[nomus-product-import-preview] erro:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
