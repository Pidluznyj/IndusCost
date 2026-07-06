/**
 * Smoke test read-only da regra "BOM efetiva Nomus = qtdeNecessaria" (sem somar qtdePerdaNormal).
 *
 * 1. Sempre roda asserts puros sobre `computeEffectiveLineQuantity` e
 *    `stageRowToNomusLine` — não exige DATABASE_URL.
 * 2. Se DATABASE_URL estiver definida, valida com dados reais (ex.: 311.90AA / 110.02--)
 *    e a comparação com ProductBOM (divergência esperada se Indus ainda tiver quantidade antiga
 *    com perda somada).
 * 3. Não executa apply nem mutation.
 *
 * Uso: npm run test:nomus:bom-effective-quantity
 */
import "dotenv/config";
import {
  computeEffectiveLineQuantity,
  QUANTITY_TOLERANCE,
} from "../src/lib/nomusBomComparison.ts";
import { stageRowToNomusLine } from "../src/lib/nomusBomComparisonLoad.ts";

function log(msg: string): void {
  console.warn(`[bom-effective-qty-smoke] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[bom-effective-qty-smoke] FALHA: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    fail(`${label}: esperado ${String(expected)}, recebido ${String(actual)}`);
  }
}

function runPureChecks(): void {
  log("1) Asserts puros (sem DB)");

  assertEq(
    computeEffectiveLineQuantity(0.010878, 0.001771),
    0.010878,
    "309.02AA/115.01-- effective qty"
  );
  assertEq(
    computeEffectiveLineQuantity(0.0065, 0.000616),
    0.0065,
    "311.90AA/110.02-- effective qty (ignora perda)"
  );

  // Sem perda
  assertEq(computeEffectiveLineQuantity(0.0065, null), 0.0065, "loss=null mantém qtd");
  assertEq(computeEffectiveLineQuantity(0.0065, 0), 0.0065, "loss=0 mantém qtd");
  assertEq(
    computeEffectiveLineQuantity(0.0065, undefined),
    0.0065,
    "loss=undefined mantém qtd"
  );

  // Robustez
  assertEq(computeEffectiveLineQuantity(null, 0.000616), null, "qtd=null → null");
  assertEq(computeEffectiveLineQuantity(NaN, 0.000616), null, "qtd=NaN → null");
  assertEq(
    computeEffectiveLineQuantity(0.0065, NaN),
    0.0065,
    "loss=NaN é ignorado"
  );

  // Float-safety (arredonda required, não soma loss)
  assertEq(computeEffectiveLineQuantity(0.123456789, 0.5), 0.123457, "arredonda 6 casas");

  // stageRowToNomusLine: caso piloto
  const line = stageRowToNomusLine({
    externalLineId: 1,
    parentCode: "311.90AA",
    componentCode: "110.02--",
    componentDescription: "*ABS* NATURAL GP35",
    qtdeNecessaria: 0.0065,
    qtdePerdaNormal: 0.000616,
    listaMateriaisId: 1,
    listaMateriaisNome: "PRINCIPAL",
    listaMateriaisPadrao: true,
    listaMateriaisPadraoBlocoK: false,
    listaMateriaisAtivo: true,
    opcional: false,
    alternativo: false,
    preferencial: false,
    itemDeEmbarque: false,
    posicao: 1,
  });
  assertEq(line.quantity, 0.0065, "stageRowToNomusLine.quantity (efetiva)");
  assertEq(line.requiredQuantity, 0.0065, "stageRowToNomusLine.requiredQuantity");
  assertEq(line.lossQuantity, 0.000616, "stageRowToNomusLine.lossQuantity");

  log("OK · checks puros aprovados");
}

async function runDbChecks(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    log("2) DATABASE_URL ausente — pulando validação real (read-only).");
    return;
  }
  log("2) Validação read-only com dados reais (311.90AA / 110.02--)");
  const { PrismaClient } = await import("@prisma/client");
  const { buildBomComparisonForParentCode, loadNomusStageLinesForParent } =
    await import("../src/lib/nomusBomComparisonLoad.ts");
  const prisma = new PrismaClient();
  try {
    const stageRows = await prisma.nomusBomComponentStage.findMany({
      where: { parentCode: "311.90AA", componentCode: "110.02--" },
      take: 5,
    });
    if (stageRows.length === 0) {
      log("    sem linha 311.90AA/110.02-- no stage Nomus — pulando validação real.");
    } else {
      for (const row of stageRows) {
        const qtd = row.qtdeNecessaria ? Number(row.qtdeNecessaria.toString()) : null;
        const perda = row.qtdePerdaNormal ? Number(row.qtdePerdaNormal.toString()) : null;
        const eff = computeEffectiveLineQuantity(qtd, perda);
        log(
          `    stage row externalLineId=${row.externalLineId} qtdeNecessaria=${qtd} qtdePerdaNormal=${perda} effective=${eff}`
        );
      }

      const stageLines = await loadNomusStageLinesForParent("311.90AA");
      const target = stageLines.find((l) => l.componentCode.trim() === "110.02--");
      if (!target) {
        fail("    stageLines não retornou 110.02-- como linha efetiva");
      } else {
        if (target.quantity == null) {
          fail("    stageLines retornou quantity nula para 110.02--");
        }
        log(
          `    NomusEffectiveBomLine 110.02-- · quantity=${target.quantity} requiredQuantity=${target.requiredQuantity} lossQuantity=${target.lossQuantity}`
        );
        if (target.lossQuantity != null && target.lossQuantity > 0) {
          const expected = computeEffectiveLineQuantity(
            target.requiredQuantity,
            target.lossQuantity
          );
          if (
            expected != null &&
            target.quantity != null &&
            Math.abs(target.quantity - expected) > QUANTITY_TOLERANCE
          ) {
            fail(
              `    quantity efetiva (${target.quantity}) diverge de qtdeNecessaria (${expected})`
            );
          }
        }
      }
    }

    log("3) Comparação Nomus × IndusCost para 311.90AA");
    const cmp = await buildBomComparisonForParentCode("311.90AA");
    const cmpLine = cmp.lines.find(
      (l) => l.componentCode.trim().toUpperCase() === "110.02--"
    );
    if (cmpLine) {
      log(
        `    comparação 110.02-- · status=${cmpLine.status} nomusQty=${cmpLine.nomusQuantity} indusQty=${cmpLine.indusQuantity}`
      );
      const nomusExpected = 0.0065;
      if (
        cmpLine.nomusQuantity != null &&
        Math.abs(cmpLine.nomusQuantity - nomusExpected) < 0.0000005 &&
        cmpLine.indusQuantity != null &&
        Math.abs(cmpLine.indusQuantity - 0.007116) < 0.0000005
      ) {
        if (cmpLine.status !== "QUANTITY_DIFF") {
          fail(
            `    Esperado QUANTITY_DIFF (Nomus=${nomusExpected}, Indus legado=0.007116), recebido ${cmpLine.status}.`
          );
        }
        log("    OK · divergência detectada (Indus ainda com qty antiga somando perda)");
      } else if (
        cmpLine.nomusQuantity != null &&
        cmpLine.indusQuantity != null &&
        Math.abs(cmpLine.nomusQuantity - cmpLine.indusQuantity) < 0.0000005
      ) {
        log(`    OK · MATCH nomus=${cmpLine.nomusQuantity} indus=${cmpLine.indusQuantity}`);
      } else {
        log(
          `    Info: nomusQty=${cmpLine.nomusQuantity} indusQty=${cmpLine.indusQuantity} status=${cmpLine.status}`
        );
      }
    } else {
      log("    componente 110.02-- não apareceu na comparação efetiva (ok se não havia divergência).");
    }

    log("OK · validações read-only concluídas (nenhuma mutation executada).");
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  log("iniciando…");
  runPureChecks();
  await runDbChecks();
  log("OK — smoke read-only concluído.");
}

main().catch((err) => {
  console.error("[bom-effective-qty-smoke] erro:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
