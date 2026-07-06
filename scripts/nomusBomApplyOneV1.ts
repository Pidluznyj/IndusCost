/**
 * Apply controlado de BOM Nomus para UM produto.
 *
 * Sem --confirm correto, roda dry-run (preview). Para aplicar:
 *
 *   npm run sync:nomus:bom-apply-one -- \
 *     --parentCode=304.02AA \
 *     --confirm="APLICAR BOM NOMUS 304.02AA"
 *
 * Garantias:
 *  - reaproveita applyEffectiveBomToProductBom (transação + planHash + gates);
 *  - registra histórico em EngineeringChangeLog (entityType=PRODUCT_BOM);
 *  - NÃO toca preço, proposta, pedido, custo, ProductRouting, ProductCostingMode;
 *  - NÃO aplica em lote — somente o parentCode informado.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  applyEffectiveBomToProductBom,
  buildControlledApplyPreview,
} from "../src/lib/nomusBomControlledApply.ts";

const prisma = new PrismaClient();

function log(msg: string): void {
  console.warn(`[bom-apply-one] ${msg}`);
}

function parseArgs(): { parentCode: string | null; confirm: string | null } {
  let parentCode: string | null = null;
  let confirm: string | null = null;
  for (const arg of process.argv.slice(2)) {
    const mP = arg.match(/^--parentCode=(.+)$/);
    if (mP) {
      parentCode = mP[1].trim();
      continue;
    }
    const mC = arg.match(/^--confirm=(.+)$/);
    if (mC) {
      confirm = mC[1];
    }
  }
  return { parentCode, confirm };
}

async function main(): Promise<void> {
  const { parentCode, confirm } = parseArgs();
  if (!parentCode) {
    log("uso: --parentCode=<código> [--confirm=\"APLICAR BOM NOMUS <CODIGO>\"]");
    process.exitCode = 1;
    return;
  }
  log(`carregando preview para ${parentCode}…`);
  const preview = await buildControlledApplyPreview(parentCode);
  log(`canApply=${preview.canApply} · planHash=${preview.planHash}`);
  log(`confirmação esperada: "${preview.confirmationRequiredText}"`);

  if (!confirm) {
    log("dry-run (sem --confirm). Rode novamente com:");
    log(`  --confirm="${preview.confirmationRequiredText}"`);
    if (!preview.canApply) {
      log("ATENÇÃO: preview reporta bloqueios — apply seria recusado.");
    }
    log("OK (dry-run)");
    return;
  }

  if (!preview.canApply) {
    log("preview bloqueado — apply abortado.");
    for (const r of preview.blockingReasons) log(`  ! ${r}`);
    process.exitCode = 1;
    return;
  }
  if (confirm !== preview.confirmationRequiredText) {
    log(`Confirmação inválida. Esperado exatamente: "${preview.confirmationRequiredText}"`);
    process.exitCode = 1;
    return;
  }

  log("aplicando BOM Nomus…");
  try {
    const result = await applyEffectiveBomToProductBom({
      parentCode,
      planHash: preview.planHash,
      confirmationText: confirm,
      approvedBy: "cli-bom-apply-one",
    });

    log("--- RESUMO ---");
    log(`status=${result.resultStatus}`);
    log(
      `created=${result.summary.created} updated=${result.summary.updated} kept=${result.summary.kept} removed=${result.summary.removed} skipped=${result.summary.skipped} blocked=${result.summary.blocked}`
    );
    log(`applyRunId=${result.applyRunId}`);
    log(`message: ${result.message}`);
  } catch (err) {
    log(`FALHA: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[bom-apply-one] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
