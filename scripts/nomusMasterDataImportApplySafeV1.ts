/**
 * Importação segura de cadastro mestre Nomus (Product/Material).
 *
 * Sem --confirm=..., roda dry-run (preview). Para aplicar, é obrigatório:
 *
 *   npm run sync:nomus:master-data-apply-safe -- --confirm="IMPORTAR CADASTRO MESTRE NOMUS"
 *
 * Pode receber também --codes=110.03--,210.05-- (lista separada por vírgula).
 *
 * Garantias:
 *  - cria apenas SAFE_PRODUCT_CANDIDATE / SAFE_MATERIAL_CANDIDATE;
 *  - NÃO cria ProductBOM;
 *  - NÃO altera preço, proposta, pedido, ProductCostingMode;
 *  - idempotente (skip de existentes);
 *  - lote máximo controlado dentro da própria lib.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  applyNomusMasterDataImport,
  buildNomusMasterDataImportPreview,
} from "../src/lib/nomusMasterDataImport.ts";
import { MASTER_DATA_CONFIRMATION_TEXT } from "../src/lib/nomusMasterDataImportTypes.ts";

const prisma = new PrismaClient();

function log(msg: string): void {
  console.warn(`[master-data-apply-safe] ${msg}`);
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
      `dry-run (sem --confirm). Para aplicar, rode novamente com --confirm="${MASTER_DATA_CONFIRMATION_TEXT}".`
    );
    const preview = await buildNomusMasterDataImportPreview({
      classification: "ALL_SAFE",
      codes,
    });
    log(`totais=${JSON.stringify(preview.totals)}`);
    log(`amostra (até 10):`);
    for (const item of preview.toCreate.slice(0, 10)) {
      log(`  + ${item.payload?.kind ?? "?"} ${item.code} | ${item.description ?? "—"}`);
    }
    log("OK (dry-run)");
    return;
  }

  if (confirm !== MASTER_DATA_CONFIRMATION_TEXT) {
    log(
      `Confirmação inválida. Esperado exatamente: "${MASTER_DATA_CONFIRMATION_TEXT}". Nada será feito.`
    );
    process.exitCode = 1;
    return;
  }

  log("aplicando importação segura…");
  const result = await applyNomusMasterDataImport({
    mode: "SAFE_ONLY",
    codes,
    confirmationText: confirm,
    requestedBy: "cli",
  });

  log(`status=${result.status} · ${result.message}`);
  log(
    `criados · Product=${result.createdProducts} Material=${result.createdMaterials} · ignorados=${result.skippedExisting} · bloqueados=${result.blocked} · erros=${result.errors}`
  );

  for (const item of result.report.slice(0, 50)) {
    log(`  ${item.outcome} · ${item.kind} ${item.code} · ${item.message}`);
  }

  if (result.status === "FAILED") {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[master-data-apply-safe] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
