/**
 * Preview da limpeza controlada de cadastro divergente (Fase B).
 *
 * Uso:
 *   npm run sync:nomus:registry-conflict-cleanup-preview -- --code=420.01 --parentCode=610.04AA
 *   npm run sync:nomus:registry-conflict-cleanup-preview -- --code=420.01 --all-parents
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { buildRegistryCleanupPlan } from "../src/lib/nomusComponentRegistryCleanup.ts";

function parseArgs(): {
  code: string | null;
  parentCode: string | null;
  allParents: boolean;
  out: string | null;
} {
  let code: string | null = null;
  let parentCode: string | null = null;
  let allParents = false;
  let out: string | null = null;
  for (const arg of process.argv.slice(2)) {
    const mCode = arg.match(/^--code=(.+)$/);
    if (mCode) code = mCode[1].trim();
    const mParent = arg.match(/^--parentCode=(.+)$/);
    if (mParent) parentCode = mParent[1].trim();
    if (arg === "--all-parents") allParents = true;
    const mOut = arg.match(/^--out=(.+)$/);
    if (mOut) out = mOut[1].trim();
  }
  return { code, parentCode, allParents, out };
}

async function main(): Promise<void> {
  const { code, parentCode, allParents, out } = parseArgs();
  if (!code) {
    console.error("Uso: --code=420.01 e (--parentCode=610.04AA | --all-parents)");
    process.exit(1);
  }

  const plan = await buildRegistryCleanupPlan({ code, parentCode, allParents });
  const json = JSON.stringify(plan, null, 2);

  if (out) {
    writeFileSync(out, json, "utf8");
    console.warn(`[registry-cleanup-preview] gravado em ${out}`);
  }
  console.log(json);
  console.warn(
    `[registry-cleanup-preview] planHash=${plan.planHash} · allowed=${plan.summary.allowedCount} · blocked=${plan.summary.blockedCount}`
  );
  console.warn(`[registry-cleanup-preview] confirmação apply: "${plan.confirmationRequiredText}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
