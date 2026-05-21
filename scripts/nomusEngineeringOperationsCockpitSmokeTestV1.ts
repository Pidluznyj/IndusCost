/**
 * Smoke test read-only da Central de Atualização Nomus.
 *
 * Não altera ProductBOM, Product, Material, preço, propostas ou pedidos.
 *
 * Uso: npm run test:nomus:engineering-cockpit-smoke
 */
import "dotenv/config";
import { buildNomusEngineeringOperationsCockpit } from "../src/lib/nomusEngineeringOperationsCockpit.ts";

const SMOKE_LIMIT = 20;

async function main(): Promise<void> {
  console.warn("[nomus-engineering-cockpit-smoke] iniciando…");

  const result = await buildNomusEngineeringOperationsCockpit({
    scope: "CHANGED_ONLY",
    limit: SMOKE_LIMIT,
    offset: 0,
    includeCostImpact: false,
  });

  if (result.mode !== "READ_ONLY") {
    throw new Error(`mode esperado READ_ONLY, recebido ${result.mode}`);
  }
  if (!Array.isArray(result.rows)) {
    throw new Error("rows deve ser um array");
  }
  if (!result.totals || typeof result.totals.total !== "number") {
    throw new Error("totals ausente ou inválido");
  }

  console.warn(`[nomus-engineering-cockpit-smoke] mode=${result.mode}`);
  console.warn(`[nomus-engineering-cockpit-smoke] generatedAt=${result.generatedAt}`);
  console.warn(`[nomus-engineering-cockpit-smoke] scope=${result.scope}`);
  console.warn(
    `[nomus-engineering-cockpit-smoke] totalParentsInStage=${result.totalParentsInStage} comparedCount=${result.comparedCount} limitApplied=${result.limitApplied} offsetApplied=${result.offsetApplied} hasMore=${result.hasMore}`
  );
  console.warn(
    `[nomus-engineering-cockpit-smoke] totals=${JSON.stringify(result.totals)}`
  );

  const preview = result.rows.slice(0, 10);
  for (const row of preview) {
    console.warn(
      `[nomus-engineering-cockpit-smoke] ${row.parentCode} | ${row.operatorStatusLabel} | severity=${row.severity} | ${row.nextRecommendedAction}`
    );
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`[nomus-engineering-cockpit-smoke] aviso: ${w}`);
    }
  }

  console.warn("[nomus-engineering-cockpit-smoke] OK");
}

main()
  .catch((err) => {
    console.error(
      "[nomus-engineering-cockpit-smoke] erro:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  });
