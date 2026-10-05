/**
 * Orquestração (cliente) da publicação em lote de custos de produção em blocos HTTP.
 * Sem regra de negócio: o backend (executeProductionCostBulkPublish) segue sendo a
 * autoridade de elegibilidade, revalidação, idempotência e auditoria.
 */

import {
  chunkIds,
  summarizeBulkPublishResult,
  type ProductionCostBulkPublishPreview,
  type ProductionCostBulkPublishResult,
  type ProductionCostBulkPublishResultRow,
  type ProductionCostBulkPublishResultSummary,
} from "./productionCostBulkPublish.js";

/**
 * Produtos por requisição HTTP de publicação. Não confundir com o chunk interno do
 * backend (PRODUCTION_COST_BULK_PUBLISH_CHUNK_SIZE): este limita a duração de cada
 * request para não estourar o timeout do proxy (Cloudflare 524).
 */
export const BULK_PUBLISH_HTTP_CHUNK_SIZE = 25;

export type ProductionCostBulkPublishChunkRequest = {
  confirm: true;
  batchRunId: string;
  productIds: string[];
  draftVersionIdsByProduct: Record<string, string>;
};

export type ProductionCostBulkPublishRunProgress = {
  batchRunId: string;
  /** Elegíveis da prévia que serão enviados. */
  total: number;
  /** Produtos de blocos já confirmados pelo backend. */
  processed: number;
  pending: number;
  chunkTotal: number;
  /** Último bloco confirmado (1-based; 0 = nenhum). */
  confirmedChunks: number;
  summary: ProductionCostBulkPublishResultSummary;
};

export type ProductionCostBulkPublishRun = ProductionCostBulkPublishRunProgress & {
  status: "COMPLETED" | "INTERRUPTED";
  rows: ProductionCostBulkPublishResultRow[];
  /** Bloco que falhou (1-based) — não conta como concluído. */
  failedChunk: number | null;
  errorMessage: string | null;
  finishedAt: string;
};

/** Monta os payloads por bloco a partir dos elegíveis da prévia (ordem da prévia). */
export function buildBulkPublishChunkRequests(
  preview: Pick<ProductionCostBulkPublishPreview, "batchRunId" | "rows">,
  chunkSize: number = BULK_PUBLISH_HTTP_CHUNK_SIZE
): ProductionCostBulkPublishChunkRequest[] {
  const draftByProduct = new Map<string, string>();
  for (const row of preview.rows) {
    if (row.eligible && row.draftVersionId && !draftByProduct.has(row.productId)) {
      draftByProduct.set(row.productId, row.draftVersionId);
    }
  }
  return chunkIds([...draftByProduct.keys()], chunkSize).map((productIds) => ({
    confirm: true,
    batchRunId: preview.batchRunId,
    productIds,
    draftVersionIdsByProduct: Object.fromEntries(
      productIds.map((productId) => [productId, draftByProduct.get(productId)!])
    ),
  }));
}

/**
 * Publica os elegíveis da prévia um bloco por vez, com o mesmo batchRunId.
 * Falha HTTP/rede em um bloco interrompe a operação (os seguintes não são enviados)
 * e preserva o que já foi confirmado. Retomada = nova prévia + nova execução.
 */
export async function runProductionCostBulkPublishInChunks(input: {
  preview: Pick<ProductionCostBulkPublishPreview, "batchRunId" | "rows">;
  publishChunk: (
    request: ProductionCostBulkPublishChunkRequest,
    chunk: { index: number; total: number }
  ) => Promise<Pick<ProductionCostBulkPublishResult, "rows">>;
  onProgress?: (progress: ProductionCostBulkPublishRunProgress) => void;
  chunkSize?: number;
}): Promise<ProductionCostBulkPublishRun> {
  const requests = buildBulkPublishChunkRequests(input.preview, input.chunkSize);
  const total = requests.reduce((sum, request) => sum + request.productIds.length, 0);
  const rows: ProductionCostBulkPublishResultRow[] = [];
  let processed = 0;
  let confirmedChunks = 0;

  const snapshot = (): ProductionCostBulkPublishRunProgress => ({
    batchRunId: input.preview.batchRunId,
    total,
    processed,
    pending: total - processed,
    chunkTotal: requests.length,
    confirmedChunks,
    summary: summarizeBulkPublishResult(rows),
  });

  input.onProgress?.(snapshot());

  for (let i = 0; i < requests.length; i += 1) {
    const request = requests[i];
    try {
      const response = await input.publishChunk(request, {
        index: i + 1,
        total: requests.length,
      });
      if (!response || !Array.isArray(response.rows)) {
        throw new Error("Resposta inválida do servidor na publicação em lote.");
      }
      rows.push(...response.rows);
    } catch (error) {
      return {
        ...snapshot(),
        status: "INTERRUPTED",
        rows,
        failedChunk: i + 1,
        errorMessage:
          error instanceof Error && error.message
            ? error.message
            : "Falha na publicação em lote.",
        finishedAt: new Date().toISOString(),
      };
    }
    processed += request.productIds.length;
    confirmedChunks = i + 1;
    input.onProgress?.(snapshot());
  }

  return {
    ...snapshot(),
    status: "COMPLETED",
    rows,
    failedChunk: null,
    errorMessage: null,
    finishedAt: new Date().toISOString(),
  };
}
