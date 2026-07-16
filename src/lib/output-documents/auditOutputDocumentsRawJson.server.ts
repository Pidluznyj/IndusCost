/**
 * Loader read-only: amostragem paginada de rawJson de Documentos de Saída (DS-02.4).
 * Não carrega a tabela inteira; não exporta payloads completos.
 */
import { Prisma } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENT_TIPO_SAIDA } from "./auditOutputDocumentsDb.js";
import {
  RAW_JSON_ANALYSIS_DEFAULTS,
  accumulateRawJsonKeysFromPayload,
  buildPaymentTermsEvidence,
  buildRawJsonKeysSection,
  createRawJsonKeyAccumulatorMap,
  finalizeRawJsonKeyMatrix,
  type PaymentTermsEvidence,
  type RawJsonKeysSection,
} from "./auditOutputDocumentsRawJson.js";

export type RawJsonSamplePrisma = {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
};

export type RawJsonSampleLoad = {
  rawJsonKeys: RawJsonKeysSection;
  paymentTermsEvidence: PaymentTermsEvidence;
};

function parseJsonPayload(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * Lê até `sampleLimit` documentos DocumentoSaida (paginado) e analisa rawJson
 * do cabeçalho + itens associados (também limitados).
 */
export async function loadRawJsonSampleAnalysis(
  prisma: RawJsonSamplePrisma,
  options: { sampleLimit: number }
): Promise<RawJsonSampleLoad> {
  const sampleLimit = Math.max(0, Math.trunc(options.sampleLimit));
  const pageSize = RAW_JSON_ANALYSIS_DEFAULTS.pageSize;
  const maxDepth = RAW_JSON_ANALYSIS_DEFAULTS.maxDepth;
  const acc = createRawJsonKeyAccumulatorMap();

  let documentsScanned = 0;
  let itemsScanned = 0;
  let cursorId: string | null = null;
  const sampledDocumentIds: string[] = [];

  while (documentsScanned < sampleLimit) {
    const take = Math.min(pageSize, sampleLimit - documentsScanned);
    const rows = cursorId
      ? await prisma.$queryRaw<
          Array<{ id: string; externalId: number; rawJson: unknown }>
        >(Prisma.sql`
          SELECT d.id, d."externalId", d."rawJson"
          FROM "NomusStockDocument" d
          WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
            AND d.id > ${cursorId}
          ORDER BY d.id ASC
          LIMIT ${take}
        `)
      : await prisma.$queryRaw<
          Array<{ id: string; externalId: number; rawJson: unknown }>
        >(Prisma.sql`
          SELECT d.id, d."externalId", d."rawJson"
          FROM "NomusStockDocument" d
          WHERE d."tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
          ORDER BY d.id ASC
          LIMIT ${take}
        `);

    if (rows.length === 0) break;

    for (const row of rows) {
      documentsScanned += 1;
      sampledDocumentIds.push(row.id);
      cursorId = row.id;
      const payload = parseJsonPayload(row.rawJson);
      if (payload != null) {
        accumulateRawJsonKeysFromPayload(acc, payload, { maxDepth });
      }
      if (documentsScanned >= sampleLimit) break;
    }

    if (rows.length < take) break;
  }

  // Itens dos documentos amostrados — chunks de IDs + cursor, até sampleLimit itens.
  if (sampledDocumentIds.length > 0) {
    const chunkSize = 100;
    for (
      let offset = 0;
      offset < sampledDocumentIds.length && itemsScanned < sampleLimit;
      offset += chunkSize
    ) {
      const idChunk = sampledDocumentIds.slice(offset, offset + chunkSize);
      let itemCursor: string | null = null;
      let chunkExhausted = false;
      while (!chunkExhausted && itemsScanned < sampleLimit) {
        const take = Math.min(pageSize, sampleLimit - itemsScanned);
        const rows = itemCursor
          ? await prisma.$queryRaw<Array<{ id: string; rawJson: unknown }>>(
              Prisma.sql`
                SELECT i.id, i."rawJson"
                FROM "NomusStockDocumentItem" i
                WHERE i."stockDocumentId" IN (${Prisma.join(idChunk)})
                  AND i.id > ${itemCursor}
                ORDER BY i.id ASC
                LIMIT ${take}
              `
            )
          : await prisma.$queryRaw<Array<{ id: string; rawJson: unknown }>>(
              Prisma.sql`
                SELECT i.id, i."rawJson"
                FROM "NomusStockDocumentItem" i
                WHERE i."stockDocumentId" IN (${Prisma.join(idChunk)})
                ORDER BY i.id ASC
                LIMIT ${take}
              `
            );

        if (rows.length === 0) {
          chunkExhausted = true;
          break;
        }
        for (const row of rows) {
          itemsScanned += 1;
          itemCursor = row.id;
          const payload = parseJsonPayload(row.rawJson);
          if (payload != null) {
            accumulateRawJsonKeysFromPayload(acc, payload, { maxDepth });
          }
          if (itemsScanned >= sampleLimit) break;
        }
        if (rows.length < take) chunkExhausted = true;
      }
    }
  }

  const sampleSize = documentsScanned + itemsScanned;
  const matrixRows = finalizeRawJsonKeyMatrix(acc, Math.max(sampleSize, 1));

  const rawJsonKeys = buildRawJsonKeysSection({
    sampleSize,
    documentsScanned,
    itemsScanned,
    maxDepth,
    rows: matrixRows,
  });

  return {
    rawJsonKeys,
    paymentTermsEvidence: buildPaymentTermsEvidence(matrixRows, sampleSize),
  };
}
