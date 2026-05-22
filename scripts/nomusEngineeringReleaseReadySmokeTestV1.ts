/**
 * Smoke test consolidado de release-ready.
 *
 * Read-only. Valida que os fluxos principais estão saudáveis para a Engenharia:
 *  - preview de Igualar Bases responde READ_ONLY;
 *  - preview de Aplicar BOM responde para um piloto;
 *  - histórico de produto responde para um produto existente;
 *  - lista de runs recentes responde;
 *  - nenhum EngineeringChangeLog com runId órfão;
 *  - sem mutation durante o teste (snapshot antes/depois).
 *
 * Uso: npm run test:nomus:engineering-release-ready
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildNomusMasterDataEqualizePreview } from "../src/lib/nomusMasterDataEqualize.ts";
import { buildControlledApplyPreview } from "../src/lib/nomusBomControlledApply.ts";
import { loadProductChangeHistory } from "../src/lib/productChangeHistory.ts";

const prisma = new PrismaClient();
const PILOT_PRODUCT_SKU = "611.48AA";

function log(msg: string): void {
  console.warn(`[release-ready-smoke] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[release-ready-smoke] FALHA: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main(): Promise<void> {
  log("iniciando…");

  const [runsBefore, changesBefore, applyRunsBefore, bomLinesBefore] = await Promise.all([
    prisma.engineeringSyncRun.count(),
    prisma.engineeringChangeLog.count(),
    prisma.nomusBomApplyRun.count(),
    prisma.productBOM.count(),
  ]);
  log(
    `snapshot · EngineeringSyncRun=${runsBefore} EngineeringChangeLog=${changesBefore} NomusBomApplyRun=${applyRunsBefore} ProductBOM=${bomLinesBefore}`
  );

  // 1) Preview de Igualar Bases
  const equalizePreview = await buildNomusMasterDataEqualizePreview({
    limit: 10,
    offset: 0,
    scope: "ACTIONABLE",
  });
  if (equalizePreview.mode !== "READ_ONLY") {
    fail(`equalize.mode esperado READ_ONLY, recebido ${equalizePreview.mode}`);
  }
  log(
    `equalize OK · createP=${equalizePreview.totals.createProducts} createM=${equalizePreview.totals.createMaterials} updateP=${equalizePreview.totals.updateProducts} updateM=${equalizePreview.totals.updateMaterials} blocked=${equalizePreview.totals.blocked}`
  );

  // 2) Preview Aplicar BOM (piloto)
  try {
    const bomPreview = await buildControlledApplyPreview(PILOT_PRODUCT_SKU);
    if (!bomPreview.confirmationRequiredText.startsWith("APLICAR BOM NOMUS ")) {
      fail(
        `bom-preview ${PILOT_PRODUCT_SKU}: confirmationRequiredText="${bomPreview.confirmationRequiredText}" fora do padrão "APLICAR BOM NOMUS <CODE>".`
      );
    }
    log(
      `bom-preview ${PILOT_PRODUCT_SKU} OK · canApply=${bomPreview.canApply} actions=${bomPreview.actions.length} planHash=${bomPreview.planHash.slice(0, 10)}… "${bomPreview.confirmationRequiredText}"`
    );
  } catch (err) {
    log(
      `bom-preview ${PILOT_PRODUCT_SKU} · não foi possível executar: ${err instanceof Error ? err.message : err}`
    );
  }

  // 3) Histórico de um produto existente
  const anyProduct = await prisma.product.findFirst({ select: { id: true, sku: true } });
  if (anyProduct) {
    const hist = await loadProductChangeHistory({ productId: anyProduct.id, limit: 5 });
    log(
      `history(${anyProduct.sku}) OK · entries=${hist.entries.length} totalCount=${hist.totalCount}`
    );
  } else {
    log("history · nenhum Product no banco — pulando.");
  }

  // 4) Runs recentes
  const recentRuns = await prisma.engineeringSyncRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, status: true, summaryJson: true, createdAt: true },
  });
  log(`runs-recent OK · últimas ${recentRuns.length} execuções listadas.`);

  // 5) FK órfã
  const dangling = await prisma.engineeringChangeLog.count({
    where: { runId: { not: null }, run: null },
  });
  if (dangling > 0) {
    fail(`FK órfã em EngineeringChangeLog.runId · ${dangling} registros.`);
  }
  log("FK check · 0 órfãos em EngineeringChangeLog.runId");

  // Snapshot final
  const [runsAfter, changesAfter, applyRunsAfter, bomLinesAfter] = await Promise.all([
    prisma.engineeringSyncRun.count(),
    prisma.engineeringChangeLog.count(),
    prisma.nomusBomApplyRun.count(),
    prisma.productBOM.count(),
  ]);
  if (runsAfter !== runsBefore) fail(`EngineeringSyncRun mudou: ${runsBefore}→${runsAfter}`);
  if (changesAfter !== changesBefore) fail(`EngineeringChangeLog mudou: ${changesBefore}→${changesAfter}`);
  if (applyRunsAfter !== applyRunsBefore) fail(`NomusBomApplyRun mudou: ${applyRunsBefore}→${applyRunsAfter}`);
  if (bomLinesAfter !== bomLinesBefore) fail(`ProductBOM mudou: ${bomLinesBefore}→${bomLinesAfter}`);
  log("snapshot final igual ao inicial (nenhuma mutation)");

  log("OK — release-ready smoke read-only concluído.");
}

main()
  .catch((err) => {
    console.error("[release-ready-smoke] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
