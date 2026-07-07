/** Cursor rotativo da paginação de pedidos Nomus (sync sales-orders). */

export type SalesOrdersPaginationWindow = {
  startPage: number;
  maxPages: number;
  cursorFile: string | null;
};

export type SalesOrdersFetchWindowMeta = {
  startPage: number;
  maxPages: number;
  lastPageFetched: number;
  totalPedidos: number;
  stoppedBecauseEmpty: boolean;
  completedWindow: boolean;
};

export function readSalesOrdersPageCursor(input: {
  cursorFile: string | null | undefined;
  defaultStartPage: number;
  cursorContent?: string | null;
}): number {
  const defaultStart = Math.max(1, input.defaultStartPage);
  const cursorFile = (input.cursorFile ?? "").trim();
  if (!cursorFile) return defaultStart;

  const raw = (input.cursorContent ?? "").trim();
  if (!raw) return defaultStart;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultStart;
  return parsed;
}

export function resolveNextSalesOrdersPageCursor(meta: SalesOrdersFetchWindowMeta): {
  nextStart: number;
  reason: string;
} {
  const { startPage, maxPages, totalPedidos, stoppedBecauseEmpty, completedWindow } = meta;

  if (totalPedidos === 0) {
    return {
      nextStart: 1,
      reason: `janela vazia em startPage=${startPage}; cursor reiniciado`,
    };
  }

  if (stoppedBecauseEmpty) {
    return {
      nextStart: 1,
      reason: `fim do catálogo após página ${meta.lastPageFetched - 1}; cursor reiniciado`,
    };
  }

  if (completedWindow) {
    const nextStart = startPage + maxPages;
    return {
      nextStart,
      reason: `janela ${startPage}..${startPage + maxPages - 1} concluída com dados`,
    };
  }

  return {
    nextStart: 1,
    reason: `paginação encerrada antes do limite de bloco; cursor reiniciado`,
  };
}

export function formatSalesOrdersPaginationNote(window: SalesOrdersPaginationWindow): string {
  const { startPage, maxPages, cursorFile } = window;
  const lastPage = startPage + maxPages - 1;
  if (!cursorFile) {
    return `startPage=${startPage} (fixo)`;
  }
  return `cursor rotativo ${cursorFile}: janela páginas ${startPage}..${lastPage}`;
}
