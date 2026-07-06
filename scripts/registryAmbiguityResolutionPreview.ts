/**
 * Preview da resolução controlada Product/Material ambíguo.
 *
 * Uso:
 *   npm run sync:nomus:registry-ambiguity-resolution-preview -- --code=420.01A- --prefer=MATERIAL
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { buildAmbiguityResolutionPlan } from "../src/lib/nomusRegistryAmbiguityResolution.ts";

function parseArgs(): {
  code: string | null;
  prefer: "MATERIAL" | "PRODUCT" | null;
  out: string | null;
  allowLocalException: boolean;
} {
  let code: string | null = null;
  let prefer: "MATERIAL" | "PRODUCT" | null = null;
  let out: string | null = null;
  let allowLocalException = false;

  for (const arg of process.argv.slice(2)) {
    const mCode = arg.match(/^--code=(.+)$/);
    if (mCode) code = mCode[1].trim();
    const mPrefer = arg.match(/^--prefer=(MATERIAL|PRODUCT)$/i);
    if (mPrefer) prefer = mPrefer[1].toUpperCase() as "MATERIAL" | "PRODUCT";
    const mOut = arg.match(/^--out=(.+)$/);
    if (mOut) out = mOut[1].trim();
    if (arg === "--allow-local-exception") allowLocalException = true;
  }
  return { code, prefer, out, allowLocalException };
}

async function main(): Promise<void> {
  const { code, prefer, out, allowLocalException } = parseArgs();
  if (!code || !prefer) {
    console.error("Uso: --code=420.01A- --prefer=MATERIAL|PRODUCT");
    process.exit(1);
  }

  const plan = await buildAmbiguityResolutionPlan({
    code,
    prefer,
    allowLocalException,
  });
  const json = JSON.stringify(plan, null, 2);

  if (out) {
    writeFileSync(out, json, "utf8");
    console.warn(`[registry-ambiguity-preview] gravado em ${out}`);
  }
  console.log(json);
  console.warn(`[registry-ambiguity-preview] planHash=${plan.planHash} · canApply=${plan.canApply}`);
  console.warn(`[registry-ambiguity-preview] confirmação apply: "${plan.confirmationRequiredText}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
