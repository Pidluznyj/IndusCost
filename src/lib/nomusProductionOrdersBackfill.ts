/**
 * Lógica pura do backfill de Ordens de Produção Nomus (OP-08).
 * Sem I/O — CLI, checkpoint, limites defensivos e resumo.
 */

export const NOMUS_PRODUCTION_ORDERS_BACKFILL_DEFAULT_PAGE_SIZE = 50;
export const NOMUS_PRODUCTION_ORDERS_BACKFILL_DEFAULT_MAX_PAGES = 40;
/** Teto absoluto por execução (defensivo). */
export const NOMUS_PRODUCTION_ORDERS_BACKFILL_HARD_MAX_PAGES = 2000;
export const NOMUS_PRODUCTION_ORDERS_BACKFILL_DEFAULT_CURSOR_ENV =
  "NOMUS_PRODUCTION_ORDERS_PAGE_CURSOR_FILE";

export type ProductionOrdersBackfillMode = "preview" | "apply";

export type ProductionOrdersBackfillCliOptions = {
  mode: ProductionOrdersBackfillMode;
  pageSize: number;
  maxPages: number;
  hardMaxPages: number;
  startPage: number;
  /** Se true, ignora cursor e usa startPage (reprocessar páginas). */
  reprocess: boolean;
  cursorFile: string | null;
};

export type ProductionOrdersBackfillCheckpoint = {
  nextPage: number;
  pagesCompleted: number;
  lastExternalId: number | null;
  updatedAt: string;
};

export type ProductionOrdersBackfillErrorItem = {
  page: number | null;
  externalId: number | null;
  stage: "fetch" | "map" | "persist" | "checkpoint" | "interrupt";
  message: string;
};

export type ProductionOrdersBackfillSummary = {
  mode: ProductionOrdersBackfillMode;
  strategy: "backfill";
  pagesRead: number;
  recordsReceived: number;
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
  linkedRows: number;
  linksCreated: number;
  linksUpdated: number;
  linksReactivated: number;
  linksMarkedAbsent: number;
  locallyResolved: number;
  unresolved: number;
  pendingLinksReconciled: number;
  rateLimitCount: number;
  errors: number;
  errorReport: ProductionOrdersBackfillErrorItem[];
  interrupted: boolean;
  completedCatalog: boolean;
  checkpoint: ProductionOrdersBackfillCheckpoint | null;
  startPage: number;
  maxPages: number;
  hardMaxPages: number;
  cursorFile: string | null;
  duration: number;
  /** OP-11: execução bloqueada por lock (sem API). */
  lockBlocked?: boolean;
  /** OP-11: auditoria/métricas finais. */
  audit?: import("@/src/lib/nomusProductionOrdersSyncAudit.js").ProductionOrdersSyncAuditRecord;
  exitCode?: number;
};

function parsePositiveInt(raw: string, label: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} inválido: ${raw}`);
  return n;
}

export function parseProductionOrdersBackfillCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ProductionOrdersBackfillCliOptions {
  const mode: ProductionOrdersBackfillMode =
    argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";

  let pageSize = NOMUS_PRODUCTION_ORDERS_BACKFILL_DEFAULT_PAGE_SIZE;
  let maxPages = NOMUS_PRODUCTION_ORDERS_BACKFILL_DEFAULT_MAX_PAGES;
  let hardMaxPages = NOMUS_PRODUCTION_ORDERS_BACKFILL_HARD_MAX_PAGES;
  let startPage = 1;
  let reprocess = false;
  let cursorFile: string | null =
    (env[NOMUS_PRODUCTION_ORDERS_BACKFILL_DEFAULT_CURSOR_ENV] ?? "").trim() || null;

  for (const arg of argv) {
    if (
      arg === "preview" ||
      arg === "apply" ||
      arg === "--apply" ||
      arg === "backfill" ||
      arg === "--strategy=backfill"
    ) {
      continue;
    }
    if (arg === "--reprocess" || arg.startsWith("--reprocess=")) {
      reprocess = true;
      if (arg.startsWith("--reprocess=") && arg !== "--reprocess=true") {
        const page = parsePositiveInt(arg.slice("--reprocess=".length), "--reprocess");
        startPage = page;
      }
      continue;
    }
    if (arg.startsWith("--page-size=")) {
      pageSize = parsePositiveInt(arg.slice("--page-size=".length), "--page-size");
      continue;
    }
    if (arg.startsWith("--max-pages=")) {
      maxPages = parsePositiveInt(arg.slice("--max-pages=".length), "--max-pages");
      continue;
    }
    if (arg.startsWith("--hard-max-pages=")) {
      hardMaxPages = parsePositiveInt(arg.slice("--hard-max-pages=".length), "--hard-max-pages");
      continue;
    }
    if (arg.startsWith("--start-page=")) {
      startPage = parsePositiveInt(arg.slice("--start-page=".length), "--start-page");
      continue;
    }
    if (arg.startsWith("--cursor-file=")) {
      cursorFile = arg.slice("--cursor-file=".length).trim() || null;
      continue;
    }
  }

  hardMaxPages = Math.min(
    Math.max(1, hardMaxPages),
    NOMUS_PRODUCTION_ORDERS_BACKFILL_HARD_MAX_PAGES
  );
  maxPages = Math.min(Math.max(1, maxPages), hardMaxPages);

  return {
    mode,
    pageSize,
    maxPages,
    hardMaxPages,
    startPage,
    reprocess,
    cursorFile,
  };
}

export function serializeProductionOrdersBackfillCheckpoint(
  checkpoint: ProductionOrdersBackfillCheckpoint
): string {
  // Formato simples compatível com cursor de pedidos (inteiro = próxima página).
  // Linha extra JSON para metadados de retomada.
  return `${checkpoint.nextPage}\n${JSON.stringify(checkpoint)}\n`;
}

export function parseProductionOrdersBackfillCheckpoint(raw: string | null | undefined): {
  nextPage: number | null;
  checkpoint: ProductionOrdersBackfillCheckpoint | null;
} {
  const text = (raw ?? "").trim();
  if (!text) return { nextPage: null, checkpoint: null };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = Number.parseInt(lines[0] ?? "", 10);
  const nextPage = Number.isFinite(first) && first >= 1 ? first : null;

  let checkpoint: ProductionOrdersBackfillCheckpoint | null = null;
  for (const line of lines.slice(1)) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as Partial<ProductionOrdersBackfillCheckpoint>;
      if (parsed && typeof parsed.nextPage === "number" && parsed.nextPage >= 1) {
        checkpoint = {
          nextPage: parsed.nextPage,
          pagesCompleted:
            typeof parsed.pagesCompleted === "number" ? parsed.pagesCompleted : 0,
          lastExternalId:
            typeof parsed.lastExternalId === "number" ? parsed.lastExternalId : null,
          updatedAt:
            typeof parsed.updatedAt === "string"
              ? parsed.updatedAt
              : new Date(0).toISOString(),
        };
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return { nextPage, checkpoint };
}

export function resolveProductionOrdersBackfillStartPage(args: {
  options: ProductionOrdersBackfillCliOptions;
  cursorContent: string | null;
}): number {
  if (args.options.reprocess) return Math.max(1, args.options.startPage);
  const fromCursor = parseProductionOrdersBackfillCheckpoint(args.cursorContent).nextPage;
  if (fromCursor != null) return fromCursor;
  return Math.max(1, args.options.startPage);
}

export function buildEmptyProductionOrdersBackfillSummary(
  options: ProductionOrdersBackfillCliOptions,
  startPage: number
): ProductionOrdersBackfillSummary {
  return {
    mode: options.mode,
    strategy: "backfill",
    pagesRead: 0,
    recordsReceived: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
    linkedRows: 0,
    linksCreated: 0,
    linksUpdated: 0,
    linksReactivated: 0,
    linksMarkedAbsent: 0,
    locallyResolved: 0,
    unresolved: 0,
    pendingLinksReconciled: 0,
    rateLimitCount: 0,
    errors: 0,
    errorReport: [],
    interrupted: false,
    completedCatalog: false,
    checkpoint: null,
    startPage,
    maxPages: options.maxPages,
    hardMaxPages: options.hardMaxPages,
    cursorFile: options.cursorFile,
    duration: 0,
  };
}

export function shouldStopProductionOrdersBackfill(args: {
  pagesRead: number;
  maxPages: number;
  hardMaxPages: number;
  interrupted: boolean;
  completedCatalog: boolean;
}): boolean {
  if (args.interrupted || args.completedCatalog) return true;
  if (args.pagesRead >= args.maxPages) return true;
  if (args.pagesRead >= args.hardMaxPages) return true;
  return false;
}
