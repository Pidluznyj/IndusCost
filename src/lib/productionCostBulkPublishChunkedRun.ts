/**
 * Orquestração (cliente) da publicação em lote de custos de produção em blocos HTTP.
 *
 * HTTP CHUNK ≠ PUBLICATION TRANSACTION:
 * - chunks `validate`: revalidam patches (≤25) sem publicar;
 * - chunk `finalize` (último): envia TODOS os elegíveis e materializa/publica
 *   UMA ProductionCostTableVersion completa no backend.
 *
 * O backend (executeProductionCostBulkPublish) permanece a autoridade de
 * elegibilidade, revalidação, materialização, idempotência e auditoria.
 */

import {
  chunkIds,
  summarizeBulkPublishResult,
  type ProductionCostBulkPublishPhase,
  type ProductionCostBulkPublishPreview,
  type ProductionCostBulkPublishResult,
  type ProductionCostBulkPublishResultRow,
  type ProductionCostBulkPublishResultSummary,
} from "./productionCostBulkPublish.js";

/**
 * Produtos por requisição HTTP de validação. Não confundir com o chunk interno do
 * backend (PRODUCTION_COST_BULK_PUBLISH_CHUNK_SIZE): este limita a duração de cada
 * request para não estourar o timeout do proxy (Cloudflare 524).
 */
export const BULK_PUBLISH_HTTP_CHUNK_SIZE = 25;

export type ProductionCostBulkPublishChunkRequest = {
  confirm: true;
  batchRunId: string;
  productIds: string[];
  draftVersionIdsByProduct: Record<string, string>;
  phase: ProductionCostBulkPublishPhase;
  chunkIndex: number;
  chunkTotal: number;
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
  completePublishedVersionId?: string | null;
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
  const allIds = [...draftByProduct.keys()];
  const allDraftMap = Object.fromEntries(allIds.map((id) => [id, draftByProduct.get(id)!]));
  const idChunks = chunkIds(allIds, chunkSize);
  const chunkTotal = idChunks.length;

  return idChunks.map((productIds, index) => {
    const chunkIndex = index + 1;
    const isFinal = chunkIndex === chunkTotal;
    if (isFinal) {
      // Finalize carrega o patch completo do lote — uma única publicação.
      return {
        confirm: true as const,
        batchRunId: preview.batchRunId,
        productIds: allIds,
        draftVersionIdsByProduct: allDraftMap,
        phase: "finalize" as const,
        chunkIndex,
        chunkTotal,
      };
    }
    return {
      confirm: true as const,
      batchRunId: preview.batchRunId,
      productIds,
      draftVersionIdsByProduct: Object.fromEntries(
        productIds.map((productId) => [productId, draftByProduct.get(productId)!])
      ),
      phase: "validate" as const,
      chunkIndex,
      chunkTotal,
    };
  });
}

/**
 * Publica os elegíveis da prévia um bloco por vez, com o mesmo batchRunId.
 * Falha HTTP/rede em um bloco interrompe a operação (os seguintes não são enviados)
 * e preserva o que já foi confirmado. Retomada = nova prévia + nova execução.
 *
 * Até o finalize, nada é PUBLISHED; interrupção em validate não deixa versão oficial.
 */
export async function runProductionCostBulkPublishInChunks(input: {
  preview: Pick<ProductionCostBulkPublishPreview, "batchRunId" | "rows">;
  publishChunk: (
    request: ProductionCostBulkPublishChunkRequest,
    chunk: { index: number; total: number }
  ) => Promise<
    Pick<ProductionCostBulkPublishResult, "rows"> &
      Partial<
        Pick<
          ProductionCostBulkPublishResult,
          "completePublishedVersionId" | "summary" | "phase"
        >
      >
  >;
  onProgress?: (progress: ProductionCostBulkPublishRunProgress) => void;
  chunkSize?: number;
}): Promise<ProductionCostBulkPublishRun> {
  const requests = buildBulkPublishChunkRequests(input.preview, input.chunkSize);
  const total = requests.length
    ? new Set(requests.flatMap((r) => (r.phase === "finalize" ? r.productIds : r.productIds)))
        .size
    : 0;
  // Contagem estável: elegíveis da prévia (finalize reenvia todos).
  const eligibleTotal = (() => {
    const ids = new Set<string>();
    for (const row of input.preview.rows) {
      if (row.eligible && row.draftVersionId) ids.add(row.productId);
    }
    return ids.size;
  })();
  const rows: ProductionCostBulkPublishResultRow[] = [];
  let processed = 0;
  let confirmedChunks = 0;
  let completePublishedVersionId: string | null = null;

  const snapshot = (): ProductionCostBulkPublishRunProgress => ({
    batchRunId: input.preview.batchRunId,
    total: eligibleTotal,
    processed,
    pending: eligibleTotal - processed,
    chunkTotal: requests.length,
    confirmedChunks,
    summary: summarizeBulkPublishResult(rows),
  });

  input.onProgress?.(snapshot());

  for (let i = 0; i < requests.length; i += 1) {
    const request = requests[i]!;
    try {
      const response = await input.publishChunk(request, {
        index: i + 1,
        total: requests.length,
      });
      if (!response || !Array.isArray(response.rows)) {
        throw new Error("Resposta inválida do servidor na publicação em lote.");
      }
      if (request.phase === "finalize") {
        // Finalize é a fonte de verdade do lote (substitui VALIDATED acumulados).
        rows.length = 0;
        rows.push(...response.rows);
        completePublishedVersionId = response.completePublishedVersionId ?? null;
        processed = eligibleTotal;
      } else {
        rows.push(...response.rows);
        processed += request.productIds.length;
      }
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
        completePublishedVersionId,
      };
    }
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
    completePublishedVersionId,
  };
}
