import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildControlledApplyPreview } from "../src/lib/nomusBomControlledApply.ts";

const prisma = new PrismaClient();

type CliArgs = {
  parentCode?: string;
  outPath?: string;
};

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  for (const arg of process.argv.slice(2)) {
    const parent = arg.match(/^--parentCode=(.+)$/);
    if (parent) {
      args.parentCode = parent[1].trim();
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
    console.error("[nomus-bom-apply-preview] --parentCode é obrigatório.");
    process.exitCode = 1;
    return;
  }

  console.warn(`[nomus-bom-apply-preview] parentCode=${args.parentCode} (read-only)`);

  const report = await buildControlledApplyPreview(args.parentCode);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);

  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, json, "utf8");
    console.warn(`[nomus-bom-apply-preview] gravado em ${args.outPath}`);
  }
}

main()
  .catch((err) => {
    console.error(
      "[nomus-bom-apply-preview] erro:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
