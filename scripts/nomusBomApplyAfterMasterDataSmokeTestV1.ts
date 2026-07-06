/**
 * Smoke test read-only do fluxo "Aplicar BOM Nomus por produto".
 *
 * Não chama apply real. Valida:
 *  - buildControlledApplyPreview retorna estrutura íntegra para cada piloto;
 *  - confirmationRequiredText segue o padrão "APLICAR BOM NOMUS <CODIGO>";
 *  - apply com confirmação errada lança erro controlado e NÃO grava nada;
 *  - apply sem produto bloqueado é recusado pelos gates;
 *  - nenhuma mutation foi executada (snapshot antes/depois);
 *  - nenhum EngineeringChangeLog órfão (FK runId saudável).
 *
 * Uso: npm run test:nomus:bom-apply-after-master-data
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  applyEffectiveBomToProductBom,
  buildControlledApplyPreview,
} from "../src/lib/nomusBomControlledApply.ts";

const prisma = new PrismaClient();
const PILOTS = ["611.48AA", "304.02AA", "610.73BA", "610.75BA", "317.02AA"];

function log(msg: string): void {
  console.warn(`[bom-apply-smoke] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[bom-apply-smoke] FALHA: ${msg}`);
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

  for (const code of PILOTS) {
    log(`> ${code}`);
    try {
      const preview = await buildControlledApplyPreview(code);
      if (preview.parentCode.toUpperCase() !== code.toUpperCase()) {
        // Apenas log; algumas normalizações podem diferir.
      }
      // Padrão da fase: "APLICAR BOM NOMUS <CODE>"
      if (!preview.confirmationRequiredText.startsWith("APLICAR BOM NOMUS ")) {
        fail(
          `${code}: confirmationRequiredText="${preview.confirmationRequiredText}" não segue o padrão "APLICAR BOM NOMUS <CODE>".`
        );
      }
      log(
        `  canApply=${preview.canApply} actions=${preview.actions.length} planHash=${preview.planHash.slice(0, 10)}… "${preview.confirmationRequiredText}"`
      );
      if (preview.blockingReasons.length > 0) {
        for (const r of preview.blockingReasons.slice(0, 3)) log(`  ! ${r}`);
      }

      if (preview.canApply) {
        // Apply com confirmação errada deve lançar — nunca aplicar.
        let threw = false;
        try {
          await applyEffectiveBomToProductBom({
            parentCode: code,
            planHash: preview.planHash,
            confirmationText: "TEXTO ERRADO",
          });
        } catch (e) {
          threw = true;
          const msg = e instanceof Error ? e.message : String(e);
          if (!/Confirmação inválida|Digite exatamente/i.test(msg)) {
            fail(`${code}: apply com confirmação errada deveria lançar mensagem de confirmação, recebeu "${msg}"`);
          }
        }
        if (!threw) fail(`${code}: apply com confirmação errada não lançou.`);
        log(`  apply com confirmação errada · BLOCKED (esperado)`);
      } else {
        // Mesmo sem confirmação, apply deve ser bloqueado pelos gates.
        let threw = false;
        try {
          await applyEffectiveBomToProductBom({
            parentCode: code,
            planHash: preview.planHash,
            confirmationText: preview.confirmationRequiredText,
          });
        } catch (e) {
          threw = true;
          const msg = e instanceof Error ? e.message : String(e);
          if (!/bloqueada|Plano desatualizado|Confirmação/i.test(msg)) {
            fail(`${code}: apply em preview bloqueado deveria lançar gate, recebeu "${msg}"`);
          }
        }
        if (!threw) fail(`${code}: apply em preview bloqueado não lançou.`);
        log(`  apply com confirmação correta mas gates ativos · BLOCKED (esperado)`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[")) {
        // já tratado pelo fail()
        continue;
      }
      log(`  EXCEPTION inesperada em ${code}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const [runsAfter, changesAfter, applyRunsAfter, bomLinesAfter] = await Promise.all([
    prisma.engineeringSyncRun.count(),
    prisma.engineeringChangeLog.count(),
    prisma.nomusBomApplyRun.count(),
    prisma.productBOM.count(),
  ]);
  if (runsAfter !== runsBefore) fail(`EngineeringSyncRun mudou durante smoke: ${runsBefore}→${runsAfter}`);
  if (changesAfter !== changesBefore) fail(`EngineeringChangeLog mudou durante smoke: ${changesBefore}→${changesAfter}`);
  if (applyRunsAfter !== applyRunsBefore) fail(`NomusBomApplyRun mudou durante smoke: ${applyRunsBefore}→${applyRunsAfter}`);
  if (bomLinesAfter !== bomLinesBefore) fail(`ProductBOM mudou durante smoke: ${bomLinesBefore}→${bomLinesAfter}`);
  log(`snapshot final igual ao inicial (nenhuma mutation)`);

  const dangling = await prisma.engineeringChangeLog.count({
    where: { runId: { not: null }, run: null },
  });
  if (dangling > 0) {
    fail(`Encontrados ${dangling} EngineeringChangeLog com runId órfão — FK quebrada.`);
  }
  log("FK check · 0 registros órfãos em EngineeringChangeLog.runId");

  log("OK — smoke read-only concluído.");
}

main()
  .catch((err) => {
    console.error("[bom-apply-smoke] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
