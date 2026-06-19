#!/usr/bin/env tsx
/**
 * Lista produtos prontos para aplicar na ProductBOM (sem bloqueio, diff não aplicado).
 *
 * Uso: npm run debug:nomus-ready-to-apply
 */
import { buildNomusAutoApplyBomDashboard } from "@/src/lib/nomusAutoApplyBomDashboard";
import { filterDashboardProducts } from "@/src/lib/nomusAutoApplyBomDashboardShared";

const SAMPLE_LIMIT = 40;

function resolveReasonBucket(primaryReason: string, pendingType: string): string {
  if (/metadata|Nomus/i.test(primaryReason)) return "Metadado corrigido";
  if (/opcional/i.test(primaryReason)) return "Opcionais resolvidos";
  if (/local/i.test(primaryReason) || /local/i.test(pendingType)) return "Itens locais resolvidos";
  if (/quantidade|diverg/i.test(primaryReason)) return "Quantidade corrigida";
  return "Outros";
}

async function main(): Promise<void> {
  const dashboard = await buildNomusAutoApplyBomDashboard({ revalidateBlocked: true });
  const ready = filterDashboardProducts(dashboard.products, { filter: "READY_TO_APPLY" });

  console.log(`\nTotal prontos para aplicar: ${ready.length}\n`);

  if (ready.length === 0) {
    console.log("Nenhum produto na fila ready_to_apply.");
    if (!dashboard.hasProductList) {
      console.log("\nRelatório sem lista de produtos — executar no servidor com relatório completo.");
    }
    return;
  }

  const bucketCounts = new Map<string, number>();
  for (const row of ready) {
    const bucket = resolveReasonBucket(row.primaryReason, row.pendingTypeLabel);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }

  console.log("Produto | Motivo resolvido | Diferenças de BOM | Última decisão engenharia | Recomendação");
  console.log("-".repeat(100));

  const sample = ready.slice(0, SAMPLE_LIMIT);
  for (const row of sample) {
    const motivo = resolveReasonBucket(row.primaryReason, row.pendingTypeLabel);
    console.log(
      `${row.parentCode} | ${motivo} | ${row.diffSummary} | ${row.pendingTypeLabel} | ${row.recommendedAction}`
    );
  }

  if (ready.length > SAMPLE_LIMIT) {
    console.log(`\n… e mais ${ready.length - SAMPLE_LIMIT} produto(s) (amostra limitada a ${SAMPLE_LIMIT}).`);
  }

  console.log("\nResumo por motivo:");
  for (const [label, count] of [...bucketCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label}: ${count}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
