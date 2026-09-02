/**
 * Lógica pura de paginação/extração do sync de Recebimentos Nomus.
 *
 * Contrato comprovado LIVE: `GET /rest/recebimentos?pagina=N` → HTTP 200,
 * 50 registros por página nesta instalação. Nenhum outro parâmetro foi
 * comprovado, por isso nenhum outro é enviado por padrão — diferente de
 * `contasReceber`/`contasPagar`, que usam a query financeira do Power BI.
 *
 * Sem Prisma/rede — seguro para importar em scripts e testes.
 */

export type JsonObject = Record<string, unknown>;

/** Tamanho de página observado na instalação (o endpoint ignora tamanhoPagina). */
export const NOMUS_RECEIPTS_PAGE_SIZE = 50;

/** Teto de páginas por execução — backfill histórico usa `--maxPages` explícito. */
export const NOMUS_RECEIPTS_DEFAULT_MAX_PAGES = 200;

export type ReceiptsSyncCliOptions = {
  mode: "preview" | "apply";
  startPage: number;
  maxPages: number;
  singlePage: number | null;
  /** Para a paginação ao alcançar recebimentos anteriores a esta data civil (backfill). */
  sinceCivilDate: string | null;
  json: boolean;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

export function parseReceiptsSyncCli(argv: string[]): ReceiptsSyncCliOptions {
  const mode = argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";
  const json = argv.includes("--json");

  let startPage = 1;
  let maxPages = NOMUS_RECEIPTS_DEFAULT_MAX_PAGES;
  let singlePage: number | null = null;
  let sinceCivilDate: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--page" && argv[i + 1]) {
      singlePage = parsePositiveInt(argv[i + 1], 1);
      i += 1;
    } else if (arg === "--maxPages" && argv[i + 1]) {
      maxPages = parsePositiveInt(argv[i + 1], NOMUS_RECEIPTS_DEFAULT_MAX_PAGES);
      i += 1;
    } else if (arg === "--startPage" && argv[i + 1]) {
      startPage = parsePositiveInt(argv[i + 1], 1);
      i += 1;
    } else if (arg === "--since" && argv[i + 1]) {
      sinceCivilDate = normalizeSinceArgument(argv[i + 1]);
      i += 1;
    }
  }

  if (singlePage != null) {
    startPage = singlePage;
    maxPages = 1;
  }

  return { mode, startPage, maxPages, singlePage, sinceCivilDate, json };
}

/** Aceita `yyyy-MM-dd` ou `dd/MM/yyyy` e normaliza para chave civil `yyyy-MM-dd`. */
export function normalizeSinceArgument(value: string): string | null {
  const raw = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

/** Só `pagina` — único parâmetro comprovado no endpoint. */
export function buildReceiptsPageParams(page: number): Record<string, string> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.trunc(page) : 1;
  return { pagina: String(safePage) };
}

export function pickReceiptsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const nested = data.data as Record<string, unknown> | undefined;
  const candidates = [
    data.recebimentos,
    data.dados,
    data.data,
    data.results,
    data.items,
    nested?.recebimentos,
    nested?.dados,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function hasNextReceiptsPage(
  payload: unknown,
  page: number,
  currentLen: number,
  pageSize: number = NOMUS_RECEIPTS_PAGE_SIZE
): boolean {
  if (currentLen === 0 || currentLen < pageSize) return false;
  if (!payload || typeof payload !== "object") return currentLen > 0;
  const data = payload as Record<string, unknown>;
  const totalPages =
    Number(data.totalPaginas ?? data.totalPages ?? data.paginas ?? data.total_paginas) || null;
  if (totalPages != null && Number.isFinite(totalPages)) return page < totalPages;
  if (typeof data.hasMore === "boolean") return data.hasMore;
  return currentLen >= pageSize;
}

export function computeReceiptsPaginationPlan(options: ReceiptsSyncCliOptions): {
  firstPage: number;
  lastPage: number;
} {
  return {
    firstPage: options.startPage,
    lastPage: options.startPage + options.maxPages - 1,
  };
}

/**
 * Backfill histórico: a página inteira é anterior a `sinceCivilDate`.
 * Só para a varredura quando NENHUM item da página alcança a janela pedida —
 * nunca descarta itens individualmente (a ordenação da origem não é contratual).
 */
export function pageIsFullyBeforeSince(
  receiptCivilDates: Array<string | null>,
  sinceCivilDate: string | null
): boolean {
  if (!sinceCivilDate) return false;
  const known = receiptCivilDates.filter((key): key is string => key != null);
  if (known.length === 0) return false;
  return known.every((key) => key < sinceCivilDate);
}
