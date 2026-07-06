/**
 * Apply controlado da resolução Product/Material ambíguo.
 *
 * Uso:
 *   npm run sync:nomus:registry-ambiguity-resolution-preview -- --code=420.01A- --prefer=MATERIAL
 *   npm run sync:nomus:registry-ambiguity-resolution-apply -- \
 *     --code=420.01A- \
 *     --prefer=MATERIAL \
 *     --planHash=<hash> \
 *     --confirm="RESOLVER AMBIGUIDADE 420.01A- MATERIAL" \
 *     --backup=/tmp/ambiguity_420.01A-.sql
 *
 * Sem --confirm: dry-run (valida planHash e mostra resumo).
 */
import "dotenv/config";
import {
  applyAmbiguityResolutionPlan,
  buildAmbiguityResolutionPlan,
} from "../src/lib/nomusRegistryAmbiguityResolution.ts";

function parseArgs(): {
  code: string | null;
  prefer: "MATERIAL" | "PRODUCT" | null;
  planHash: string | null;
  confirm: string | null;
  backup: string | null;
  allowLocalException: boolean;
} {
  let code: string | null = null;
  let prefer: "MATERIAL" | "PRODUCT" | null = null;
  let planHash: string | null = null;
  let confirm: string | null = null;
  let backup: string | null = null;
  let allowLocalException = false;

  for (const arg of process.argv.slice(2)) {
    const mCode = arg.match(/^--code=(.+)$/);
    if (mCode) code = mCode[1].trim();
    const mPrefer = arg.match(/^--prefer=(MATERIAL|PRODUCT)$/i);
    if (mPrefer) prefer = mPrefer[1].toUpperCase() as "MATERIAL" | "PRODUCT";
    const mHash = arg.match(/^--planHash=(.+)$/);
    if (mHash) planHash = mHash[1].trim();
    const mConfirm = arg.match(/^--confirm=(.+)$/);
    if (mConfirm) confirm = mConfirm[1];
    const mBackup = arg.match(/^--backup=(.+)$/);
    if (mBackup) backup = mBackup[1].trim();
    if (arg === "--allow-local-exception") allowLocalException = true;
  }
  return { code, prefer, planHash, confirm, backup, allowLocalException };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.code || !args.prefer) {
    console.error(
      "Uso: --code=420.01A- --prefer=MATERIAL [--planHash=] [--confirm=] [--backup=]"
    );
    process.exit(1);
  }

  const preview = await buildAmbiguityResolutionPlan({
    code: args.code,
    prefer: args.prefer,
    allowLocalException: args.allowLocalException,
  });

  console.warn(`[registry-ambiguity-apply] planHash=${preview.planHash}`);
  console.warn(`[registry-ambiguity-apply] canApply=${preview.canApply}`);
  console.warn(`[registry-ambiguity-apply] relinks=${preview.linesToRelink.filter((l) => l.action === "RELINK_TO_MATERIAL").length}`);
  console.warn(`[registry-ambiguity-apply] reactivateMaterial=${preview.reactivateMaterial}`);
  console.warn(`[registry-ambiguity-apply] confirmação: "${preview.confirmationRequiredText}"`);

  if (!args.confirm) {
    console.warn("[registry-ambiguity-apply] dry-run (sem --confirm). Nenhuma alteração.");
    return;
  }

  if (!args.planHash) {
    console.error("Apply exige --planHash do preview.");
    process.exit(1);
  }

  const result = await applyAmbiguityResolutionPlan({
    code: args.code,
    prefer: args.prefer,
    planHash: args.planHash,
    confirmationText: args.confirm,
    backupFilePath: args.backup ?? `/tmp/registry_ambiguity_${args.code}_${Date.now()}.sql`,
    allowLocalException: args.allowLocalException,
    approvedBy: "registry-ambiguity-cli",
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.resultStatus !== "APPLIED") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
