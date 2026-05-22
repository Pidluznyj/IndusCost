/**
 * Apply controlado do fluxo "Igualar Bases" Nomus.
 *
 * Sem --confirm correta, faz dry-run. Para aplicar, é obrigatório:
 *
 *   npm run sync:nomus:master-data-equalize-apply -- --confirm="IGUALAR BASES NOMUS"
 *
 * Pode receber --codes=110.03--,210.05--
 *
 * Garantias:
 *  - cria/atualiza/inativa apenas itens controlados pelo Nomus;
 *  - NÃO cria ProductBOM;
 *  - NÃO altera preço/proposta/pedido/custos/costingMode/roteiro;
 *  - NÃO faz delete físico;
 *  - registra histórico em EngineeringChangeLog.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  applyNomusMasterDataEqualize,
  buildNomusMasterDataEqualizePreview,
} from "../src/lib/nomusMasterDataEqualize.ts";
import { EQUALIZE_CONFIRMATION_TEXT } from "../src/lib/nomusMasterDataEqualizeTypes.ts";

const prisma = new PrismaClient();

function log(msg: string): void {
  console.warn(`[equalize-apply] ${msg}`);
}

function parseArgs(): { confirm: string | null; codes: string[] | undefined } {
  let confirm: string | null = null;
  let codes: string[] | undefined;
  for (const arg of process.argv.slice(2)) {
    const m1 = arg.match(/^--confirm=(.+)$/);
    if (m1) {
      confirm = m1[1];
      continue;
    }
    const m2 = arg.match(/^--codes=(.+)$/);
    if (m2) {
      codes = m2[1]
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
    }
  }
  return { confirm, codes };
}

async function main(): Promise<void> {
  const { confirm, codes } = parseArgs();
  if (!confirm) {
    log(
      `dry-run (sem --confirm). Para aplicar, rode novamente com --confirm="${EQUALIZE_CONFIRMATION_TEXT}".`
    );
    const preview = await buildNomusMasterDataEqualizePreview({
      limit: 200,
      offset: 0,
      scope: "ACTIONABLE",
    });
    log(`totais=${JSON.stringify(preview.totals)}`);
    log(`amostra (até 15):`);
    for (const row of preview.rows.slice(0, 15)) {
      log(`  ${row.action} · ${row.code} · ${row.description ?? "—"}`);
    }
    log("OK (dry-run)");
    return;
  }
  if (confirm !== EQUALIZE_CONFIRMATION_TEXT) {
    log(`Confirmação inválida. Esperado exatamente: "${EQUALIZE_CONFIRMATION_TEXT}".`);
    process.exitCode = 1;
    return;
  }

  log("aplicando Igualar Bases…");
  const result = await applyNomusMasterDataEqualize({
    confirmationText: confirm,
    scope: "SAFE_ONLY",
    codes,
    requestedBy: "cli",
  });
  log(`status=${result.status} · ${result.message}`);
  log(
    `runId=${result.runId} · history=${result.historyEntriesCreated} entries · errors=${result.errors}`
  );
  for (const item of result.report.slice(0, 60)) {
    log(`  ${item.outcome} · ${item.action} · ${item.code} · ${item.message}`);
  }
  if (result.status === "FAILED") process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[equalize-apply] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
