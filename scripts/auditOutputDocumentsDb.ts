/**
 * Auditor read-only de Documentos de Saída.
 *
 * Uso:
 *   npm run audit:output-documents:db
 *   npm run audit:output-documents:db -- --document=8451 --order=PD02590 --nfe=7208
 *   npm run audit:output-documents:db -- --sample-limit=20 --json-output=... --markdown-output=...
 *
 * Estritamente read-only: não executa create/update/upsert/delete.
 * Exit code != 0 somente para falha técnica (args inválidos, DB indisponível, I/O).
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  AUDIT_OUTPUT_DOCUMENTS_DB_LOG_PREFIX,
  buildAuditResult,
  buildEmptyAuditSections,
  disconnectPrismaSafe,
  formatAuditOutputDocumentsDbMarkdown,
  formatDatabaseUnavailableMessage,
  isDatabaseUnavailableError,
  parseAuditOutputDocumentsDbArgs,
  probeDatabaseConnectivity,
  readDatabaseUrlSafe,
  sanitizeDatabaseUrl,
  type AuditOutputDocumentsDbResult,
} from "../src/lib/output-documents/auditOutputDocumentsDb.ts";
import { loadStageInventoryAndCoverage } from "../src/lib/output-documents/auditOutputDocumentsDbInventory.server.ts";
import { loadRawJsonSampleAnalysis } from "../src/lib/output-documents/auditOutputDocumentsRawJson.server.ts";

const LOG = AUDIT_OUTPUT_DOCUMENTS_DB_LOG_PREFIX;

function writeOutputs(
  result: AuditOutputDocumentsDbResult,
  jsonOutput: string,
  markdownOutput: string
): void {
  const jsonPath = resolve(jsonOutput);
  const mdPath = resolve(markdownOutput);
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, formatAuditOutputDocumentsDbMarkdown(result), "utf8");
  console.warn(`${LOG} JSON: ${jsonPath}`);
  console.warn(`${LOG} Markdown: ${mdPath}`);
}

async function main(): Promise<void> {
  const startedAt = new Date();
  let options;
  try {
    options = parseAuditOutputDocumentsDbArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `${LOG} argumentos inválidos:`,
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
    return;
  }

  const dbUrl = readDatabaseUrlSafe(process.env);
  if (!dbUrl.ok) {
    console.error(`${LOG} ${dbUrl.error}`);
    process.exitCode = 1;
    return;
  }

  const database = sanitizeDatabaseUrl(dbUrl.url);
  console.warn(
    `${LOG} alvo sanitizado: ${database?.display ?? "(não sanitizável)"}`
  );
  console.warn(
    `${LOG} foco document=${options.document} order=${options.order} nfe=${options.nfe} sampleLimit=${options.sampleLimit}`
  );

  let prisma: PrismaClient | null = null;
  try {
    prisma = new PrismaClient();
    await probeDatabaseConnectivity(prisma);

    console.warn(`${LOG} carregando inventário e cobertura do stage…`);
    const loaded = await loadStageInventoryAndCoverage(prisma, {
      sampleLimit: options.sampleLimit,
    });

    console.warn(`${LOG} amostrando rawJson (paginado, limitado)…`);
    const rawSample = await loadRawJsonSampleAnalysis(prisma, {
      sampleLimit: options.sampleLimit,
    });

    const sections = buildEmptyAuditSections();
    sections.inventory = loaded.inventory;
    sections.fieldCoverage = loaded.fieldCoverage;
    sections.itemCoverage = loaded.itemCoverage;
    sections.rawJsonKeys = rawSample.rawJsonKeys;
    sections.paymentTermsEvidence = rawSample.paymentTermsEvidence;
    sections.counts = {
      documents: loaded.inventory.documents.total,
      documentoSaida: loaded.inventory.documents.documentoSaida,
      otherTypes: loaded.inventory.documents.otherTypes,
      items: loaded.inventory.items.total,
      documentsWithoutItems: loaded.inventory.documents.withoutItems,
      orphanItems: loaded.inventory.items.orphanCount,
      rawJsonSampleSize: rawSample.rawJsonKeys.sampleSize,
      rawJsonKeyCount: rawSample.rawJsonKeys.keys.length,
      paymentCandidateKeys: rawSample.paymentTermsEvidence.candidateKeys.length,
    };
    sections.samples = {
      documentsWithoutItemsExternalIds:
        loaded.inventory.samples.documentsWithoutItemsExternalIds,
      orphanItemIds: loaded.inventory.samples.orphanItemIds,
      rawJsonDocumentsScanned: rawSample.rawJsonKeys.documentsScanned,
      rawJsonItemsScanned: rawSample.rawJsonKeys.itemsScanned,
    };
    sections.notes = [
      "DS-02.3: inventário e cobertura do stage NomusStockDocument / NomusStockDocumentItem.",
      "DS-02.4: matriz amostral de rawJson + evidências hipotéticas de pagamento/parcelas.",
      "rawJsonKeys/paymentTermsEvidence são hipóteses por nome de chave — validar no servidor.",
      "Payloads completos não são exportados; exemplos são sanitizados e truncados.",
      "Este auditor é estritamente read-only — não executa create, update, upsert ou delete.",
    ];

    const finishedAt = new Date();
    const result = buildAuditResult({
      startedAt,
      finishedAt,
      options,
      database,
      status: "ok",
      mode: "rawjson-sample",
      sections,
    });

    writeOutputs(result, options.jsonOutput, options.markdownOutput);
    console.log(JSON.stringify(result, null, 2));
    console.warn(
      `${LOG} concluído status=${result.status} mode=${result.meta.mode} docs=${loaded.inventory.documents.total} rawKeys=${rawSample.rawJsonKeys.keys.length} durationMs=${result.meta.durationMs}`
    );
  } catch (error) {
    const finishedAt = new Date();
    if (isDatabaseUnavailableError(error)) {
      const message = formatDatabaseUnavailableMessage(database);
      const result = buildAuditResult({
        startedAt,
        finishedAt,
        options,
        database,
        status: "unavailable",
        error: message,
        mode: "rawjson-sample",
      });
      try {
        writeOutputs(result, options.jsonOutput, options.markdownOutput);
      } catch (writeError) {
        console.error(
          `${LOG} falha ao gravar relatório de indisponibilidade:`,
          writeError instanceof Error ? writeError.message : writeError
        );
      }
      console.error(`${LOG} ${message}`);
      process.exitCode = 1;
      return;
    }

    const message =
      error instanceof Error ? error.message : String(error ?? "erro desconhecido");
    const result = buildAuditResult({
      startedAt,
      finishedAt,
      options,
      database,
      status: "error",
      error: message,
      mode: "rawjson-sample",
    });
    try {
      writeOutputs(result, options.jsonOutput, options.markdownOutput);
    } catch {
      // ignore secondary write failures
    }
    console.error(`${LOG} falha técnica:`, message);
    process.exitCode = 1;
  } finally {
    await disconnectPrismaSafe(prisma);
  }
}

main().catch(async (error) => {
  console.error(
    `${LOG} falha não tratada:`,
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
