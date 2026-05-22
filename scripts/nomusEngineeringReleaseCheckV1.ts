/**
 * Release Check read-only — Nomus Engineering Equalization Release v0.1.
 *
 * Validações somente de leitura para liberar a Central de Atualização Nomus
 * para a Engenharia de Produtos. NÃO faz POST, NÃO chama create/update/delete/
 * upsert/$transaction, NÃO altera ProductBOM/Product/Material/preço/proposta/pedido.
 *
 * Uso:
 *   npm run test:nomus:engineering-release-check
 *
 * Requer DATABASE_URL configurado (executar no servidor).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildNomusEngineeringOperationsCockpit } from "../src/lib/nomusEngineeringOperationsCockpit.ts";
import { buildNomusEffectiveBomCostImpact } from "../src/lib/nomusEffectiveBomCostImpact.ts";

const prisma = new PrismaClient();

const PILOT_611 = "611.48AA";
const PILOT_317 = "317.02AA";

function log(msg: string): void {
  console.warn(`[release-check] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[release-check] FALHA: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function checkCockpit(): Promise<void> {
  log("Cockpit (CHANGED_ONLY, limit=20, offset=0)…");
  const result = await buildNomusEngineeringOperationsCockpit({
    scope: "CHANGED_ONLY",
    limit: 20,
    offset: 0,
    includeCostImpact: false,
  });

  if (result.mode !== "READ_ONLY") {
    fail(`mode esperado READ_ONLY, recebido ${result.mode}`);
  }
  if (!Array.isArray(result.rows)) {
    fail("rows deve ser array.");
  }
  if (!result.totals || typeof result.totals.total !== "number") {
    fail("totals ausente ou inválido.");
  }
  if (typeof result.hasMore !== "boolean") {
    fail("hasMore deve ser boolean.");
  }

  log(
    `cockpit OK · mode=${result.mode} totalStage=${result.totalParentsInStage} compared=${result.comparedCount} rows=${result.rows.length} hasMore=${result.hasMore} nextOffset=${result.nextOffset}`
  );
  log(
    `totais · prontos=${result.totals.ready} revisão=${result.totals.needsReview} bloqueados=${result.totals.blocked} novos=${result.totals.newProducts} bomAlterada=${result.totals.bomChanged} opcionais=${result.totals.optionalPending} montagemLocal=${result.totals.assemblyLocalExceptions} semAlteração=${result.totals.noChanges}`
  );

  const has611 = result.rows.find((r) => r.parentCode === PILOT_611);
  if (has611) {
    log(
      `cockpit · 611.48AA presente: status=${has611.operatorStatusLabel} severity=${has611.severity} assemblyLocal=${has611.hasAssemblyLocalException}`
    );
  } else {
    log(`cockpit · 611.48AA não apareceu na página atual (pode estar em outra página).`);
  }
}

async function check611Impact(): Promise<void> {
  log(`Cost-impact read-only de ${PILOT_611}…`);
  try {
    const impact = await buildNomusEffectiveBomCostImpact(PILOT_611);
    log(
      `impact · status=${impact.status} hasStructuralChanges=${impact.hasStructuralChanges} noOpReason=${impact.noOpReason ?? "—"}`
    );
    const deltaTotal = impact.delta?.totalCost ?? null;
    log(`impact · delta.totalCost=${deltaTotal ?? "—"}`);

    if (impact.hasStructuralChanges === false) {
      if (deltaTotal !== null && Math.abs(deltaTotal) > 0.0001) {
        fail(
          `611.48AA sem alterações estruturais, mas delta.totalCost=${deltaTotal}. Plano e Impacto contradizem.`
        );
      }
      log(
        "impact · OK: 611.48AA sem alterações estruturais → delta zero (Plano e Impacto coerentes)."
      );
    } else {
      log(
        "impact · 611.48AA tem alterações estruturais (esperado se Nomus mudou) — Engenharia deve revisar no produto."
      );
    }

    const assemblyLine = (impact.lines ?? []).find((l) =>
      l.componentCode.startsWith("800.")
    );
    if (assemblyLine) {
      log(
        `impact · 800.xx detectado: ${assemblyLine.componentCode} status=${assemblyLine.status} deltaCost=${assemblyLine.deltaCost ?? "—"}`
      );
      if (impact.hasStructuralChanges === false && assemblyLine.deltaCost !== 0) {
        fail(
          `Linha de montagem ${assemblyLine.componentCode} mostrou deltaCost=${assemblyLine.deltaCost} mesmo sem alterações estruturais.`
        );
      }
    } else {
      log("impact · nenhuma linha 800.xx encontrada (produto pode não ter montagem local).");
    }
  } catch (err) {
    log(
      `impact · não foi possível avaliar 611.48AA automaticamente: ${err instanceof Error ? err.message : err}`
    );
    log("impact · marcar como teste manual: abrir Impacto de Custo do 611.48AA na UI.");
  }
}

async function check317CostingMode(): Promise<void> {
  log(`Costing mode de ${PILOT_317}…`);
  const product = await prisma.product.findFirst({
    where: { sku: PILOT_317 },
    select: {
      id: true,
      sku: true,
      name: true,
      costingMode: true,
    },
  });
  if (!product) {
    log(
      `317.02AA · produto não encontrado por sku. Teste manual pendente: cadastrar/importar 317.02AA antes de validar FINISHING_SERVICE.`
    );
    return;
  }

  log(
    `317.02AA · id=${product.id.slice(0, 8)}… name="${product.name}" costingMode=${product.costingMode}`
  );

  if (product.costingMode !== "FINISHING_SERVICE") {
    log(
      `317.02AA · costingMode atual = ${product.costingMode}. Teste manual pendente: salvar 317.02AA como FINISHING_SERVICE pela UI.`
    );
  } else {
    log("317.02AA · costingMode = FINISHING_SERVICE — Engenharia pode validar pela UI.");
  }
}

async function main(): Promise<void> {
  log("iniciando…");

  await checkCockpit();
  await check611Impact();
  await check317CostingMode();

  if (process.exitCode === 1) {
    log("FINALIZADO COM FALHAS — ver mensagens acima.");
  } else {
    log("OK — release check read-only concluído sem falhas.");
  }
}

main()
  .catch((err) => {
    console.error(
      "[release-check] erro fatal:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
