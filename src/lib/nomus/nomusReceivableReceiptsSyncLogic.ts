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
  /**
   * Exige PROVA de varredura completa: sem ela, a execução termina em exit 1.
   * É o que a rotina automática diária usa — uma carga truncada em silêncio
   * seria pior que nenhuma carga, porque pareceria bem-sucedida.
   * Ausente por padrão: execução manual com `--page`/`--since` segue igual.
   */
  requireFullScan: boolean;
  /**
   * Escala a auditoria de ausência de aviso para falha operacional.
   * Desligado por padrão de propósito — ver `resolveReceiptsRunStatus`.
   */
  failOnMissing: boolean;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

export function parseReceiptsSyncCli(argv: string[]): ReceiptsSyncCliOptions {
  const mode = argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";
  const json = argv.includes("--json");
  const requireFullScan = argv.includes("--require-full-scan");
  const failOnMissing = argv.includes("--fail-on-missing");

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

  return {
    mode,
    startPage,
    maxPages,
    singlePage,
    sinceCivilDate,
    json,
    requireFullScan,
    failOnMissing,
  };
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

/* ------------------------------------------------------------------ *
 * Prova de varredura completa
 * ------------------------------------------------------------------ */

/**
 * Por que a varredura NÃO pode ser considerada completa.
 *
 * Existe porque "li algumas páginas sem erro" não é a mesma coisa que
 * "percorri a origem inteira". Para uma fonte de competência de comissão,
 * confundir as duas é o pior defeito possível: a carga fica truncada e o
 * relatório diz sucesso.
 */
export type ReceiptsFullScanBlocker =
  | "STARTED_AFTER_FIRST_PAGE"
  | "SINGLE_PAGE"
  | "STOPPED_BY_MAX_PAGES"
  | "SINCE_WINDOW_APPLIED"
  | "STOPPED_BY_SINCE"
  | "NO_TERMINAL_PAGE";

export type ReceiptsFullScanAssessment = {
  complete: boolean;
  blockers: ReceiptsFullScanBlocker[];
};

/**
 * Uma varredura só é completa quando começou na página 1, não foi limitada por
 * nenhum recorte e terminou no fim REAL da paginação — página vazia ou ausência
 * de próxima página. Parar por `maxPages` significa que ainda havia origem.
 *
 * `--since` desqualifica mesmo que não tenha chegado a disparar: a intenção do
 * chamador foi recortar a janela, então a execução não prova cobertura total.
 */
export function assessReceiptsFullScan(input: {
  startPage: number;
  singlePage: number | null;
  sinceCivilDate: string | null;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  stoppedBecauseSince: boolean;
}): ReceiptsFullScanAssessment {
  const blockers: ReceiptsFullScanBlocker[] = [];

  if (input.startPage !== 1) blockers.push("STARTED_AFTER_FIRST_PAGE");
  if (input.singlePage != null) blockers.push("SINGLE_PAGE");
  if (input.stoppedBecauseMaxPages) blockers.push("STOPPED_BY_MAX_PAGES");
  if (input.sinceCivilDate != null) blockers.push("SINCE_WINDOW_APPLIED");
  if (input.stoppedBecauseSince) blockers.push("STOPPED_BY_SINCE");
  if (!input.stoppedBecauseEmpty && !input.stoppedBecauseNoNext) {
    blockers.push("NO_TERMINAL_PAGE");
  }

  return { complete: blockers.length === 0, blockers: [...new Set(blockers)] };
}

/* ------------------------------------------------------------------ *
 * Status operacional da execução
 * ------------------------------------------------------------------ */

export type ReceiptsRunStatus =
  | "SUCCESS"
  | "SUCCESS_WITH_WARNINGS"
  | "INCOMPLETE"
  | "FAILED";

export type ReceiptsRunOutcome = {
  status: ReceiptsRunStatus;
  exitCode: 0 | 1;
  reasons: string[];
};

/**
 * Decide o veredito da execução.
 *
 * Três regras, em ordem de gravidade:
 *
 *  1. Falha de gravação NUNCA é sucesso, em modo nenhum. Antes desta função o
 *     script contava os erros por linha e ainda assim saía com 0 — um cron em
 *     cima disso reportaria carga saudável com o banco pela metade.
 *
 *  2. Varredura incompleta só derruba a execução quando o chamador declarou que
 *     queria varredura completa (`--require-full-scan`). Sem isso, `--page 3` e
 *     `--since` continuam sendo usos manuais legítimos que terminam em 0.
 *
 *  3. Ausência na origem é AVISO, não falha, por padrão. O endpoint não expõe
 *     `deleted`/`cancelled`/estorno, então não existe contrato que prove
 *     semântica de exclusão — e um cron que falha todas as noites por uma
 *     condição permanente vira alerta ignorado e acaba desligado. Quem quiser
 *     escalar usa `--fail-on-missing`. Em nenhum caso se apaga nada.
 */
export function resolveReceiptsRunStatus(input: {
  requireFullScan: boolean;
  failOnMissing: boolean;
  fullScanComplete: boolean;
  blockers: readonly ReceiptsFullScanBlocker[];
  writeErrors: number;
  missingInSource: number;
}): ReceiptsRunOutcome {
  if (input.writeErrors > 0) {
    return {
      status: "FAILED",
      exitCode: 1,
      reasons: [`erros_gravacao=${input.writeErrors}`],
    };
  }

  if (input.requireFullScan && !input.fullScanComplete) {
    return {
      status: "INCOMPLETE",
      exitCode: 1,
      reasons: input.blockers.map((blocker) => `varredura_incompleta:${blocker}`),
    };
  }

  if (input.missingInSource > 0) {
    return {
      status: "SUCCESS_WITH_WARNINGS",
      exitCode: input.failOnMissing ? 1 : 0,
      reasons: [`ausentes_na_origem=${input.missingInSource}`],
    };
  }

  return { status: "SUCCESS", exitCode: 0, reasons: [] };
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
