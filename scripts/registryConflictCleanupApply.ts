/**
 * Apply controlado da limpeza de cadastro divergente (Fase B).
 *
 * Uso (exemplo por pai):
 *   npm run sync:nomus:registry-conflict-cleanup-preview -- --code=420.01 --parentCode=610.04AA --out=/tmp/plan.json
 *   npm run sync:nomus:registry-conflict-cleanup-apply -- \
 *     --code=420.01 --parentCode=610.04AA \
 *     --planHash=<hash> \
 *     --confirm="LIMPAR CADASTRO DIVERGENTE 420.01 610.04AA" \
 *     --backup=/tmp/backup_productbom_420.sql
 *
 * Sem --confirm: dry-run (valida planHash e mostra resumo).
 */
import "dotenv/config";
import {
  applyRegistryCleanupPlan,
  buildRegistryCleanupPlan,
} from "../src/lib/nomusComponentRegistryCleanup.ts";

function parseArgs(): {
  code: string | null;
  parentCode: string | null;
  allParents: boolean;
  planHash: string | null;
  confirm: string | null;
  backup: string | null;
  allowLocalException: boolean;
} {
  let code: string | null = null;
  let parentCode: string | null = null;
  let allParents = false;
  let planHash: string | null = null;
  let confirm: string | null = null;
  let backup: string | null = null;
  let allowLocalException = false;

  for (const arg of process.argv.slice(2)) {
    const mCode = arg.match(/^--code=(.+)$/);
    if (mCode) code = mCode[1].trim();
    const mParent = arg.match(/^--parentCode=(.+)$/);
    if (mParent) parentCode = mParent[1].trim();
    if (arg === "--all-parents") allParents = true;
    const mHash = arg.match(/^--planHash=(.+)$/);
    if (mHash) planHash = mHash[1].trim();
    const mConfirm = arg.match(/^--confirm=(.+)$/);
    if (mConfirm) confirm = mConfirm[1];
    const mBackup = arg.match(/^--backup=(.+)$/);
    if (mBackup) backup = mBackup[1].trim();
    if (arg === "--allow-local-exception") allowLocalException = true;
  }
  return { code, parentCode, allParents, planHash, confirm, backup, allowLocalException };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.code) {
    console.error(
      "Uso: --code=420.01 (--parentCode=610.04AA | --all-parents) [--planHash=] [--confirm=] [--backup=]"
    );
    process.exit(1);
  }

  const scope = args.allParents ? "ALL_PARENTS" : "ONE_PARENT";
  const preview = await buildRegistryCleanupPlan({
    code: args.code,
    parentCode: args.parentCode,
    allParents: args.allParents,
    allowLocalException: args.allowLocalException,
  });

  console.warn(`[registry-cleanup-apply] planHash=${preview.planHash}`);
  console.warn(`[registry-cleanup-apply] allowed=${preview.summary.allowedCount} blocked=${preview.summary.blockedCount}`);
  console.warn(`[registry-cleanup-apply] confirmação: "${preview.confirmationRequiredText}"`);

  if (!args.confirm) {
    console.warn("[registry-cleanup-apply] dry-run (sem --confirm). Nenhuma alteração.");
    return;
  }

  if (!args.planHash) {
    console.error("Apply exige --planHash do preview.");
    process.exit(1);
  }

  const result = await applyRegistryCleanupPlan({
    code: args.code,
    scope,
    parentCode: args.parentCode,
    planHash: args.planHash,
    confirmationText: args.confirm,
    backupFilePath: args.backup ?? `/tmp/registry_cleanup_${args.code}_${Date.now()}.sql`,
    allowLocalException: args.allowLocalException,
    approvedBy: "registry-cleanup-cli",
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
