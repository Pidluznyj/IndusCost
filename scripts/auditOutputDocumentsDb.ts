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
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  AUDIT_OUTPUT_DOCUMENTS_DB_LOG_PREFIX,
  buildAuditResult,
  buildEmptyAuditSections,
  disconnectPrismaSafe,
  formatDatabaseUnavailableMessage,
  isDatabaseUnavailableError,
  parseAuditOutputDocumentsDbArgs,
  probeDatabaseConnectivity,
  readDatabaseUrlSafe,
  resolveAuditProcessExitCode,
  sanitizeDatabaseUrl,
  type AuditOutputDocumentsDbResult,
} from "../src/lib/output-documents/auditOutputDocumentsDb.ts";
import { loadStageInventoryAndCoverage } from "../src/lib/output-documents/auditOutputDocumentsDbInventory.server.ts";
import { loadRawJsonSampleAnalysis } from "../src/lib/output-documents/auditOutputDocumentsRawJson.server.ts";
import { loadDocumentLinkAudit } from "../src/lib/output-documents/auditOutputDocumentsLinks.server.ts";
import { loadDocumentFinancialAudit } from "../src/lib/output-documents/auditOutputDocumentsFinancial.server.ts";
import { loadParameterizedExamplesAudit } from "../src/lib/output-documents/auditOutputDocumentsExamples.server.ts";
import { writeAuditReports } from "../src/lib/output-documents/auditOutputDocumentsReports.io.ts";

const LOG = AUDIT_OUTPUT_DOCUMENTS_DB_LOG_PREFIX;

function writeOutputs(
  result: AuditOutputDocumentsDbResult,
  jsonOutput: string,
  markdownOutput: string
): ReturnType<typeof writeAuditReports> {
  return writeAuditReports({
    result,
    jsonOutput: resolve(jsonOutput),
    markdownOutput: resolve(markdownOutput),
  });
}

function printCompactSummary(summary: string): void {
  for (const line of summary.split("\n")) {
    console.warn(`${LOG} ${line}`);
  }
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
    process.exitCode = resolveAuditProcessExitCode("args_invalid");
    return;
  }

  const dbUrl = readDatabaseUrlSafe(process.env);
  if (dbUrl.ok === false) {
    console.error(`${LOG} ${dbUrl.error}`);
    process.exitCode = resolveAuditProcessExitCode("error");
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

    console.warn(`${LOG} auditando vínculos NF-e / Pedidos…`);
    const links = await loadDocumentLinkAudit(prisma, {
      sampleLimit: options.sampleLimit,
    });

    console.warn(`${LOG} auditando alocação financeira e Contas a Receber…`);
    const financial = await loadDocumentFinancialAudit(prisma, {
      sampleLimit: options.sampleLimit,
    });

    console.warn(
      `${LOG} investigando exemplos document=${options.document} order=${options.order} nfe=${options.nfe}…`
    );
    const examples = await loadParameterizedExamplesAudit(prisma, {
      document: options.document,
      order: options.order,
      nfe: options.nfe,
    });

    const sections = buildEmptyAuditSections();
    sections.inventory = loaded.inventory;
    sections.fieldCoverage = loaded.fieldCoverage;
    sections.itemCoverage = loaded.itemCoverage;
    sections.rawJsonKeys = rawSample.rawJsonKeys;
    sections.paymentTermsEvidence = rawSample.paymentTermsEvidence;
    sections.nfeLinks = links.nfeLinks;
    sections.salesOrderLinks = links.salesOrderLinks;
    sections.allocations = financial.allocations;
    sections.accountsReceivableLinks = financial.accountsReceivableLinks;
    sections.financialEvidence = financial.financialEvidence;
    sections.examples = examples;
    sections.documentFocus = examples.outputDocument;
    sections.orderFocus = examples.salesOrder;
    sections.nfeFocus = examples.nfe;
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
      documentsWithIdNfe: links.nfeLinks.metrics.documentsWithIdNfe,
      documentsWithoutIdNfe: links.nfeLinks.metrics.documentsWithoutIdNfe,
      nfeMissingLocally: links.nfeLinks.metrics.nfeMissingLocally,
      nfeCancelled: links.nfeLinks.metrics.nfeCancelled,
      documentsWithZeroOrders:
        links.salesOrderLinks.metrics.documentsWithZeroOrders,
      documentsWithMultipleOrders:
        links.salesOrderLinks.metrics.documentsWithMultipleOrders,
      linkConflicts: links.salesOrderLinks.metrics.conflictsBetweenSources,
      unallocatedDocuments: financial.allocations.metrics.unallocated,
      partialAllocations: financial.allocations.metrics.partial,
      overAllocatedDocuments: financial.allocations.metrics.overAllocated,
      documentsWithReceivables:
        financial.accountsReceivableLinks.metrics.documentsWithReceivables,
      titlesOverdue: financial.accountsReceivableLinks.metrics.titlesOverdue,
      doubleCountPrevented:
        financial.financialEvidence.metrics.doubleCountPrevented,
      exampleDocumentFound: examples.outputDocument.found,
      exampleOrderFound: examples.salesOrder.found,
      exampleNfeFound: examples.nfe.found,
    };
    sections.samples = {
      documentsWithoutItemsExternalIds:
        loaded.inventory.samples.documentsWithoutItemsExternalIds,
      orphanItemIds: loaded.inventory.samples.orphanItemIds,
      rawJsonDocumentsScanned: rawSample.rawJsonKeys.documentsScanned,
      rawJsonItemsScanned: rawSample.rawJsonKeys.itemsScanned,
      missingNfeExternalIds: links.nfeLinks.samples.missingNfeExternalIds,
      multiDocumentNfeIds: links.nfeLinks.samples.multiDocumentNfeIds,
      multiOrderDocumentExternalIds:
        links.salesOrderLinks.samples.multiOrderDocumentExternalIds,
      unallocatedDocumentExternalIds:
        financial.allocations.samples.unallocatedDocumentExternalIds,
      overAllocatedDocumentExternalIds:
        financial.allocations.samples.overAllocatedDocumentExternalIds,
      divergentNfeIds:
        financial.accountsReceivableLinks.samples.divergentNfeIds,
    };
    sections.notes = [
      "DS-02.3: inventário e cobertura do stage NomusStockDocument / NomusStockDocumentItem.",
      "DS-02.4: matriz amostral de rawJson + evidências hipotéticas de pagamento/parcelas.",
      "DS-02.5: vínculos Documento↔NF-e↔Pedido classificados (persistido/derivado/inferido/conflitante/nao_resolvido).",
      "DS-02.6: alocação financeira, Contas a Receber e evidência sem dupla contagem (CR > Documento > Pedido).",
      "DS-02.7: exemplos parametrizados (document/order/nfe); ausência → found=false, sem erro técnico.",
      "DS-02.8: relatório JSON/Markdown sanitizado com escrita atômica (sem dump completo no terminal).",
      "Este auditor não cria nem corrige vínculos; O2C/SalesOrderNfeLink/NF/Pedido/CR não são modificados.",
      "Este auditor é estritamente read-only — não executa create, update, upsert ou delete.",
    ];

    const finishedAt = new Date();
    const result = buildAuditResult({
      startedAt,
      finishedAt,
      options,
      database,
      status: "ok",
      mode: "examples-audit",
      sections,
    });

    const written = writeOutputs(
      result,
      options.jsonOutput,
      options.markdownOutput
    );
    printCompactSummary(written.compactSummary);
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
        mode: "examples-audit",
      });
      try {
        const written = writeOutputs(
          result,
          options.jsonOutput,
          options.markdownOutput
        );
        printCompactSummary(written.compactSummary);
      } catch (writeError) {
        console.error(
          `${LOG} falha ao gravar relatório de indisponibilidade:`,
          writeError instanceof Error ? writeError.message : writeError
        );
      }
      console.error(`${LOG} ${message}`);
      process.exitCode = resolveAuditProcessExitCode("unavailable");
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
      mode: "examples-audit",
    });
    try {
      const written = writeOutputs(
        result,
        options.jsonOutput,
        options.markdownOutput
      );
      printCompactSummary(written.compactSummary);
    } catch (writeError) {
      console.error(
        `${LOG} falha ao gravar relatório de erro:`,
        writeError instanceof Error ? writeError.message : writeError
      );
    }
    console.error(`${LOG} falha técnica:`, message);
    process.exitCode = resolveAuditProcessExitCode("error");
  } finally {
    await disconnectPrismaSafe(prisma);
  }
}

main().catch(async (error) => {
  console.error(
    `${LOG} falha não tratada:`,
    error instanceof Error ? error.message : error
  );
  process.exitCode = resolveAuditProcessExitCode("error");
});
