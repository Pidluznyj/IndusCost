import { buildControlledApplyPreview } from "@/src/lib/nomusBomControlledApply";
import type { NomusBomAutoApplyProductResult } from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";
import {
  mapControlledApplyPreviewToAutoApplyProduct,
  shouldRevalidateAutoApplyProductStatus,
} from "@/src/lib/nomusAutoApplyPreviewProductStatus";
import { buildNomusUniverseCodeSet, type NomusUniverseCodeSet } from "@/src/lib/nomusBomUniverse";

const DEFAULT_CONCURRENCY = 8;

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

export type RevalidateAutoApplyDashboardResult = {
  products: NomusBomAutoApplyProductResult[];
  revalidatedCount: number;
  revalidationErrors: number;
};

/**
 * Revalida status read-only (preview controlado) para produtos que no batch aparecem bloqueados/ignorados.
 * Não altera ProductBOM nem executa apply.
 */
export async function revalidateAutoApplyDashboardProducts(
  batchProducts: NomusBomAutoApplyProductResult[],
  options?: { concurrency?: number; nomusUniverse?: NomusUniverseCodeSet }
): Promise<RevalidateAutoApplyDashboardResult> {
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const nomusUniverse = options?.nomusUniverse ?? (await buildNomusUniverseCodeSet());

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

  await runWithConcurrency(indicesToRevalidate, concurrency, async (index) => {
    const previous = batchProducts[index];
    try {
      const preview = await buildControlledApplyPreview(previous.parentCode, { nomusUniverse });
      merged[index] = mapControlledApplyPreviewToAutoApplyProduct(preview);
    } catch {
      revalidationErrors += 1;
      merged[index] = {
        ...previous,
        errorMessage:
          previous.errorMessage ??
          "Não foi possível revalidar o status (preview read-only). Exibindo snapshot do último relatório batch.",
      };
    }
  });

  return {
    products: merged,
    revalidatedCount: indicesToRevalidate.length,
    revalidationErrors,
  };
}
