import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildEffectivePricingBomForParentCode } from "../src/lib/nomusEffectivePricingBom.ts";

const prisma = new PrismaClient();

type CliArgs = {
  parentCode?: string;
  recursive: boolean;
  maxDepth: number;
  outPath?: string;
};

function parseArgs(): CliArgs {
  const args: CliArgs = { recursive: false, maxDepth: 10 };
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
    console.error("[nomus-effective-pricing-bom] --parentCode é obrigatório.");
    process.exitCode = 1;
    return;
  }

  console.warn(
    `[nomus-effective-pricing-bom] parentCode=${args.parentCode} recursive=${args.recursive} maxDepth=${args.maxDepth}`
  );

  const report = await buildEffectivePricingBomForParentCode(args.parentCode, {
    recursive: args.recursive,
    maxDepth: args.maxDepth,
  });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);

  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, json, "utf8");
    console.warn(`[nomus-effective-pricing-bom] gravado em ${args.outPath}`);
  }
}

main()
  .catch((err) => {
    console.error(
      "[nomus-effective-pricing-bom] erro:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
