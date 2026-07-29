/**
 * Recálculo idempotente da margem comercial de Propostas existentes.
 *
 * Uso:
 *   npx tsx scripts/recalculateProposalCommercialMargins.ts --dry-run
 *   npx tsx scripts/recalculateProposalCommercialMargins.ts --dry-run --source=IMPORTED --limit=50
 *   npx tsx scripts/recalculateProposalCommercialMargins.ts --apply --confirm-apply=RECALCULATE_PROPOSAL_MARGINS --limit=10
 *
 * Segurança:
 * - Default = dry-run (somente leitura).
 * - --apply exige --confirm-apply=RECALCULATE_PROPOSAL_MARGINS.
 * - Não altera preço/desconto/quantidade/cliente/vendedor/status/vínculo Pedido.
 * - Não importa server.ts. Não chama Nomus. Não executa migration.
 * - Não consultar Pedido como fonte.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  assertProposalCommercialRecalcApplyConfirmation,
  formatProposalCommercialRecalcPreview,
  parseProposalCommercialRecalcCliArgs,
  PROPOSAL_COMMERCIAL_RECALC_CONFIRM,
} from "../src/lib/proposalCommercialMarginRecalc.ts";
import { runProposalCommercialMarginRecalc } from "../src/lib/proposalCommercialMarginRecalc.server.ts";

async function main() {
  const args = parseProposalCommercialRecalcCliArgs(process.argv.slice(2));
  assertProposalCommercialRecalcApplyConfirmation(args);

  if (args.apply) {
    console.error(
      `[apply] Confirmação recebida (${PROPOSAL_COMMERCIAL_RECALC_CONFIRM}). Atualizando somente snapshots comerciais derivados.`
    );
  } else {
    console.error("[dry-run] Nenhuma escrita será realizada.");
  }

  const preview = await runProposalCommercialMarginRecalc(prisma, args, {
    performedBy: "script:recalculateProposalCommercialMargins",
  });

  const mode = args.apply ? "apply" : "dry-run";
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          mode,
          proposalsAnalyzed: preview.proposalsAnalyzed,
          itemsAnalyzed: preview.itemsAnalyzed,
          itemsComplete: preview.itemsComplete,
          itemsPartialProposal: preview.itemsPartialProposal,
          itemsUnavailable: preview.itemsUnavailable,
          itemsChanged: preview.itemsChanged,
          coveredNetValue: preview.coveredNetValue,
          totalNetValue: preview.totalNetValue,
          coveragePercent: preview.coveragePercent,
          bySource: preview.bySource,
          byReasonCode: preview.byReasonCode,
          marginBandCounts: preview.marginBandCounts,
          negativeMarginItems: preview.negativeMarginItems,
          totalConcession: preview.totalConcession,
          totalExplicitDiscount: preview.totalExplicitDiscount,
        },
        null,
        2
      )
    );
  } else {
    console.log(formatProposalCommercialRecalcPreview(preview, mode));
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
