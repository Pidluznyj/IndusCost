#!/usr/bin/env npx tsx
/**
 * Importação da cobertura legada do Nomus (relatório de comissões pagas/fechadas).
 *
 * Padrão = PREVIEW (somente leitura): associa cada linha do relatório a um
 * recebimento (CR → NF+valor+cliente → recebimentos) e mostra o resultado.
 * Nada é gravado sem --apply --confirm="IMPORTAR COBERTURA NOMUS".
 *
 * Idempotente: o mesmo arquivo (hash) não gera nova importação e um recebimento
 * já coberto nunca é coberto de novo. Associação ambígua NÃO gera cobertura.
 *
 * Uso:
 *   npm run commission:coverage:legacy-import -- --file=relatorio-nomus-2026-08.xlsx --year=2026 --month=8
 *   npm run commission:coverage:legacy-import -- --file=relatorio.csv --year=2026 --month=9 --json
 *   npm run commission:coverage:legacy-import -- --file=relatorio.xlsx --year=2026 --month=8 --apply --confirm="IMPORTAR COBERTURA NOMUS" --user=fulano
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  LEGACY_COVERAGE_IMPORT_CONFIRM,
  applyLegacyCoverageImport,
  previewLegacyCoverageImport,
} from "../src/lib/commissions/commissionLegacyCoverageImport.server.ts";
import { csvLine, fmtBrl, hasFlag, parseArgValue, requireDatabaseUrl } from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  const file = parseArgValue("file");
  if (!file) throw new Error("Informe --file=<relatório do Nomus .xlsx/.csv>.");
  const year = Number.parseInt(parseArgValue("year") ?? "", 10);
  const month = Number.parseInt(parseArgValue("month") ?? "", 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("Informe a competência do relatório: --year=AAAA --month=M.");
  }
  const isApply = hasFlag("apply");
  const confirm = parseArgValue("confirm");
  const userId = parseArgValue("user") ?? parseArgValue("userId") ?? "cli-script";
  const notes = parseArgValue("notes") ?? null;
  if (isApply && confirm !== LEGACY_COVERAGE_IMPORT_CONFIRM) {
    throw new Error(`--apply exige --confirm="${LEGACY_COVERAGE_IMPORT_CONFIRM}".`);
  }

  const buffer = readFileSync(file);
  const plan = await previewLegacyCoverageImport(prisma, {
    buffer,
    filename: basename(file),
    reference: { year, month },
  });

  const outputBase = `commission-legacy-coverage-${year}-${String(month).padStart(2, "0")}`;
  if (!isApply) {
    if (hasFlag("json")) {
      const payload = { mode: "preview-read-only", ...plan };
      writeFileSync(`${outputBase}-preview.json`, JSON.stringify(payload, null, 2), "utf8");
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log("=== Cobertura legada do Nomus — PRÉVIA (nada gravado) ===");
    console.log(`Arquivo: ${plan.filename} (sha256 ${plan.fileHash.slice(0, 12)}…)`);
    console.log(`Competência do relatório: ${String(month).padStart(2, "0")}/${year}`);
    if (plan.existingImportId) {
      console.log(`Arquivo já importado (${plan.existingImportId}) — apply não gravaria nada.`);
    }
    for (const error of plan.parseErrors) console.log(`ERRO: ${error}`);
    console.log();
    console.log(csvLine(["linha", "status", "CR", "NF", "cliente", "valor", "recebimentos", "método", "mensagem"]));
    for (const result of plan.results) {
      console.log(
        csvLine([
          result.rowNumber,
          result.status,
          result.receivableExternalId ?? result.input.cr ?? "",
          result.input.nf ?? "",
          result.input.customer ?? "",
          result.input.amount ?? "",
          [...result.receiptExternalIds, ...result.alreadyCoveredReceiptIds].join(" "),
          result.associationMethod ?? "",
          result.message,
        ])
      );
    }
    const c = plan.counts;
    console.log();
    console.log(`Linhas: ${c.rowCount}`);
    console.log(`Associadas: ${c.matchedCount}`);
    console.log(`Já cobertas (idempotente): ${c.alreadyCoveredCount}`);
    console.log(`Ambíguas (sem cobertura, revisão manual): ${c.ambiguousCount}`);
    console.log(`Não encontradas: ${c.unmatchedCount}`);
    console.log(`Inválidas: ${c.invalidCount}`);
    const covered = plan.coverageRows.reduce((sum, row) => sum + row.coveredReceivedAmount, 0);
    console.log(`Recebimentos que seriam cobertos: ${plan.coverageRows.length} (${fmtBrl(covered)})`);
    console.log(`\nPara gravar: --apply --confirm="${LEGACY_COVERAGE_IMPORT_CONFIRM}"`);
    return;
  }

  const result = await applyLegacyCoverageImport(prisma, plan, {
    importedBy: userId,
    confirm: confirm ?? "",
    notes,
  });
  const payload = { mode: "apply", result, counts: plan.counts };
  if (hasFlag("json")) {
    writeFileSync(`${outputBase}-apply.json`, JSON.stringify(payload, null, 2), "utf8");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log("=== Cobertura legada do Nomus — aplicada ===");
  console.log(`Importação: ${result.importId}${result.created ? "" : " (já existia — nada gravado)"}`);
  console.log(`Recebimentos cobertos: ${result.coverageCount}`);
}

main()
  .catch((error) => {
    console.error(
      "[commission-legacy-coverage-import] falhou:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
