import { buildControlledApplyPreview } from "@/src/lib/nomusBomControlledApply";
import type { NomusBomAutoApplyProductResult } from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";
import {
  mapControlledApplyPreviewToAutoApplyProduct,
  shouldRevalidateAutoApplyProductStatus,
} from "@/src/lib/nomusAutoApplyPreviewProductStatus";
import { buildNomusUniverseCodeSet, type NomusUniverseCodeSet } from "@/src/lib/nomusBomUniverse";
import {
  countDistinctParentCodesInStage,
  listDistinctParentCodesFromStage,
} from "@/src/lib/nomusBomComparisonLoad";
import { isOperationalAutoApplyBlockMessage } from "@/src/lib/nomusBomAutoApplyOutcome";

const DEFAULT_LIVE_BUILD_PAGE_SIZE = 200;

export const DEFAULT_REVALIDATION_CONCURRENCY = 2;
export const DEFAULT_REVALIDATION_BATCH_SIZE = 15;

export type RevalidateAutoApplyProgress = {
  totalProducts: number;
  eligibleProducts: number;
  processedProducts: number;
  revalidatedProductCount: number;
  revalidationErrorCount: number;
  currentParentCode: string | null;
  progressPercent: number;
};

export type RevalidateAutoApplyDashboardOptions = {
  concurrency?: number;
  batchSize?: number;
  nomusUniverse?: NomusUniverseCodeSet;
  onProgress?: (progress: RevalidateAutoApplyProgress) => void | Promise<void>;
  shouldContinue?: () => boolean;
};

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return results;
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export type RevalidateAutoApplyDashboardResult = {
  products: NomusBomAutoApplyProductResult[];
  revalidatedCount: number;
  revalidationErrors: number;
};

/**
 * Revalida status read-only (preview controlado) para produtos bloqueados/ignorados.
 * Não altera ProductBOM nem executa apply.
 */
export async function revalidateAutoApplyDashboardProducts(
  batchProducts: NomusBomAutoApplyProductResult[],
  options?: RevalidateAutoApplyDashboardOptions
): Promise<RevalidateAutoApplyDashboardResult> {
  const concurrency = options?.concurrency ?? DEFAULT_REVALIDATION_CONCURRENCY;
  const batchSize = options?.batchSize ?? DEFAULT_REVALIDATION_BATCH_SIZE;
  const nomusUniverse = options?.nomusUniverse ?? (await buildNomusUniverseCodeSet());
  const shouldContinue = options?.shouldContinue ?? (() => true);

  const indicesToRevalidate: number[] = [];
  for (let i = 0; i < batchProducts.length; i++) {
    if (shouldRevalidateAutoApplyProductStatus(batchProducts[i])) {
      indicesToRevalidate.push(i);
    }
  }

  if (indicesToRevalidate.length === 0) {
    return { products: batchProducts, revalidatedCount: 0, revalidationErrors: 0 };
  }

  const merged = batchProducts.map((p) => ({ ...p }));
  let revalidationErrors = 0;
  let processedProducts = 0;

  const emitProgress = async (currentParentCode: string | null) => {
    if (!options?.onProgress) return;
    const eligible = indicesToRevalidate.length;
    const progressPercent =
      eligible > 0 ? Math.min(100, Math.round((processedProducts / eligible) * 100)) : 100;
    await options.onProgress({
      totalProducts: batchProducts.length,
      eligibleProducts: eligible,
      processedProducts,
      revalidatedProductCount: eligible,
      revalidationErrorCount: revalidationErrors,
      currentParentCode,
      progressPercent,
    });
  };

  for (let batchStart = 0; batchStart < indicesToRevalidate.length; batchStart += batchSize) {
    if (!shouldContinue()) break;

    const batchIndices = indicesToRevalidate.slice(batchStart, batchStart + batchSize);

    await runWithConcurrency(batchIndices, concurrency, async (index) => {
      const previous = batchProducts[index];
      try {
        const preview = await buildControlledApplyPreview(previous.parentCode, { nomusUniverse });
        merged[index] = {
          ...mapControlledApplyPreviewToAutoApplyProduct(preview),
          errorMessage: undefined,
          planHash: preview.planHash,
          effectiveBomHash: preview.effectiveBomHash,
          confirmationRequiredText: preview.confirmationRequiredText,
        };
      } catch {
        revalidationErrors += 1;
        merged[index] = {
          ...previous,
          errorMessage:
            previous.errorMessage ??
            "Não foi possível revalidar o status (preview read-only). Exibindo snapshot do último relatório batch.",
        };
      }
      processedProducts += 1;
      await emitProgress(previous.parentCode);
    });

    await yieldEventLoop();
  }

  return {
    products: merged,
    revalidatedCount: indicesToRevalidate.length,
    revalidationErrors,
  };
}

/** Conta produtos elegíveis para revalidação sem executar preview. */
export function countEligibleAutoApplyRevalidationProducts(
  batchProducts: NomusBomAutoApplyProductResult[]
): number {
  let count = 0;
  for (const product of batchProducts) {
    if (shouldRevalidateAutoApplyProductStatus(product)) count += 1;
  }
  return count;
}

/** Calcula o status read-only de um único parentCode (preview controlado, sem apply). */
async function previewOneProductForDashboard(
  parentCode: string,
  nomusUniverse: NomusUniverseCodeSet
): Promise<{ product: NomusBomAutoApplyProductResult; isError: boolean }> {
  try {
    const preview = await buildControlledApplyPreview(parentCode, { nomusUniverse });
    return { product: mapControlledApplyPreviewToAutoApplyProduct(preview), isError: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Bloqueio operacional (opcional/local/componente) não é erro de processamento.
    if (isOperationalAutoApplyBlockMessage(errorMessage)) {
      return {
        product: {
          parentCode,
          productId: null,
          status: "BLOCKED",
          canApply: false,
          blockingReasons: [errorMessage],
          errorMessage,
        },
        isError: false,
      };
    }
    return {
      product: {
        parentCode,
        productId: null,
        status: "ERROR",
        canApply: false,
        blockingReasons: [],
        errorMessage,
      },
      isError: true,
    };
  }
}

export type BuildLiveAutoApplyProductsResult = {
  products: NomusBomAutoApplyProductResult[];
  evaluated: number;
  errors: number;
  parentsInNomusStage: number;
};

/**
 * Reconstrói a lista operacional da engenharia diretamente do stage Nomus (fonte viva),
 * rodando preview controlado read-only por parentCode em lotes com concorrência limitada.
 *
 * Usado pelo job em background quando não há relatório batch com lista de produtos —
 * restaura a fila de bloqueados/pendências sem depender de arquivo de relatório em disco
 * e sem rodar a consulta pesada dentro do request principal (GET lê apenas o snapshot).
 */
export async function buildAutoApplyDashboardProductsFromStage(
  options?: RevalidateAutoApplyDashboardOptions & { pageSize?: number }
): Promise<BuildLiveAutoApplyProductsResult> {
  const concurrency = options?.concurrency ?? DEFAULT_REVALIDATION_CONCURRENCY;
  const batchSize = options?.batchSize ?? DEFAULT_REVALIDATION_BATCH_SIZE;
  const pageSize = options?.pageSize ?? DEFAULT_LIVE_BUILD_PAGE_SIZE;
  const nomusUniverse = options?.nomusUniverse ?? (await buildNomusUniverseCodeSet());
  const shouldContinue = options?.shouldContinue ?? (() => true);

  const parentsInNomusStage = await countDistinctParentCodesInStage();
  const parentCodes: string[] = [];
  for (let offset = 0; offset < parentsInNomusStage; offset += pageSize) {
    const page = await listDistinctParentCodesFromStage({ limit: pageSize, offset });
    parentCodes.push(...page);
    if (page.length === 0) break;
  }

  const products = new Array<NomusBomAutoApplyProductResult>(parentCodes.length);
  let errors = 0;
  let processedProducts = 0;

  const emitProgress = async (currentParentCode: string | null) => {
    if (!options?.onProgress) return;
    const total = parentCodes.length;
    const progressPercent =
      total > 0 ? Math.min(100, Math.round((processedProducts / total) * 100)) : 100;
    await options.onProgress({
      totalProducts: total,
      eligibleProducts: total,
      processedProducts,
      revalidatedProductCount: total,
      revalidationErrorCount: errors,
      currentParentCode,
      progressPercent,
    });
  };

  for (let batchStart = 0; batchStart < parentCodes.length; batchStart += batchSize) {
    if (!shouldContinue()) break;
    const batch = parentCodes
      .slice(batchStart, batchStart + batchSize)
      .map((code, i) => ({ code, index: batchStart + i }));

    await runWithConcurrency(batch, concurrency, async ({ code, index }) => {
      const { product, isError } = await previewOneProductForDashboard(code, nomusUniverse);
      products[index] = product;
      if (isError) errors += 1;
      processedProducts += 1;
      await emitProgress(code);
    });

    await yieldEventLoop();
  }

  return {
    products: products.filter(Boolean),
    evaluated: processedProducts,
    errors,
    parentsInNomusStage,
  };
}
