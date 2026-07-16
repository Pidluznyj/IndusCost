/**
 * Lógica pura do sync incremental de Ordens de Produção Nomus (OP-09).
 *
 * Avaliação de seletores (docs + fixture OP 05800 + api-contract):
 * - dataAlteracao     → ACEITO (presente no payload real; mapper → nomusUpdatedAt)
 * - dataAbertura      → ACEITO como alternativo (menos ideal para edições)
 * - dataHoraEdicao    → REJEITADO (campo AR/AP; não consta no contrato /rest/ordens)
 * - dataHoraCriacao   → REJEITADO (idem)
 * - id / nome         → REJEITADOS para janela incremental (só consulta pontual)
 *
 * Fallback de seletor rejeitado: janela paginada LIMITADA + auditada (nunca full scan ilimitado).
 */

import { isoDateToNomusBrDate } from "@/src/lib/nomusProductionOrdersSyncLogic.js";

export const NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_OVERLAP_HOURS = 72;
export const NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_PAGE_SIZE = 50;
export const NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_MAX_PAGES = 20;
export const NOMUS_PRODUCTION_ORDERS_INCREMENTAL_FALLBACK_MAX_PAGES = 20;
export const NOMUS_PRODUCTION_ORDERS_INCREMENTAL_STATE_ENV =
  "NOMUS_PRODUCTION_ORDERS_INCREMENTAL_STATE_FILE";

export const NOMUS_PRODUCTION_ORDERS_INCREMENTAL_PREFERRED_SELECTOR = "dataAlteracao" as const;

export type ProductionOrdersIncrementalSelector =
  | "dataAlteracao"
  | "dataAbertura"
  | "dataHoraEdicao"
  | "dataHoraCriacao"
  | "id"
  | "nome";

export type ProductionOrdersIncrementalMode = "preview" | "apply";

export type ProductionOrdersIncrementalSelectorDecision =
  | {
      ok: true;
      selector: "dataAlteracao" | "dataAbertura";
      source: "requested" | "default";
    }
  | {
      ok: false;
      requested: ProductionOrdersIncrementalSelector;
      reason: string;
      fallback: "limited_page_window";
      fallbackMaxPages: number;
    };

export type ProductionOrdersIncrementalState = {
  version: 1;
  lastSuccessAt: string;
  cutoffUsed: string;
  filterField: string | null;
  filterRsql: string | null;
  overlapHours: number;
  strategy: "date_filter" | "limited_page_window";
  pagesRead: number;
  recordsReceived: number;
};

export type ProductionOrdersIncrementalCliOptions = {
  mode: ProductionOrdersIncrementalMode;
  selector: ProductionOrdersIncrementalSelector | null;
  overlapHours: number;
  pageSize: number;
  maxPages: number;
  fallbackMaxPages: number;
  stateFile: string | null;
  /** Se true, seletor rejeitado aborta (sem fallback). */
  strictSelector: boolean;
};

export type ProductionOrdersIncrementalPlan = {
  strategy: "date_filter" | "limited_page_window";
  selectorDecision: ProductionOrdersIncrementalSelectorDecision;
  overlapHours: number;
  cutoffIso: string;
  filterRsql: string | null;
  maxPages: number;
  pageSize: number;
  hadPriorState: boolean;
  priorLastSuccessAt: string | null;
  bootstrap: boolean;
};

export type ProductionOrdersIncrementalSummary = {
  mode: ProductionOrdersIncrementalMode;
  strategy: "incremental";
  plan: ProductionOrdersIncrementalPlan;
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
  errors: number;
  errorReport: Array<{ externalId: number | null; message: string }>;
  stateAdvanced: boolean;
  stateFile: string | null;
  filterUsed: string | null;
  cutoffUsed: string;
  duration: number;
};

const ALLOWED_DATE_SELECTORS = new Set(["dataAlteracao", "dataAbertura"]);

export function evaluateProductionOrdersIncrementalSelector(
  requested: ProductionOrdersIncrementalSelector | null,
  fallbackMaxPages: number = NOMUS_PRODUCTION_ORDERS_INCREMENTAL_FALLBACK_MAX_PAGES
): ProductionOrdersIncrementalSelectorDecision {
  if (requested == null) {
    return {
      ok: true,
      selector: NOMUS_PRODUCTION_ORDERS_INCREMENTAL_PREFERRED_SELECTOR,
      source: "default",
    };
  }
  if (ALLOWED_DATE_SELECTORS.has(requested)) {
    return {
      ok: true,
      selector: requested as "dataAlteracao" | "dataAbertura",
      source: "requested",
    };
  }

  const reasons: Record<string, string> = {
    dataHoraEdicao:
      "dataHoraEdicao não faz parte do contrato documentado de GET /rest/ordens (campo típico de AR/AP).",
    dataHoraCriacao:
      "dataHoraCriacao não faz parte do contrato documentado de GET /rest/ordens (campo típico de AR/AP).",
    id: "id é seletor pontual, não janela temporal de incremental.",
    nome: "nome é seletor pontual, não janela temporal de incremental.",
  };

  return {
    ok: false,
    requested,
    reason: reasons[requested] ?? `Seletor não suportado para incremental: ${requested}`,
    fallback: "limited_page_window",
    fallbackMaxPages: Math.max(1, fallbackMaxPages),
  };
}

function parsePositiveNumber(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} inválido: ${raw}`);
  return n;
}

export function parseProductionOrdersIncrementalCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ProductionOrdersIncrementalCliOptions {
  const mode: ProductionOrdersIncrementalMode =
    argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";

  let selector: ProductionOrdersIncrementalSelector | null = null;
  let overlapHours = NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_OVERLAP_HOURS;
  let pageSize = NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_PAGE_SIZE;
  let maxPages = NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_MAX_PAGES;
  let fallbackMaxPages = NOMUS_PRODUCTION_ORDERS_INCREMENTAL_FALLBACK_MAX_PAGES;
  let stateFile: string | null =
    (env[NOMUS_PRODUCTION_ORDERS_INCREMENTAL_STATE_ENV] ?? "").trim() || null;
  let strictSelector = false;

  for (const arg of argv) {
    if (
      arg === "preview" ||
      arg === "apply" ||
      arg === "--apply" ||
      arg === "incremental" ||
      arg === "--strategy=incremental"
    ) {
      continue;
    }
    if (arg.startsWith("--selector=")) {
      selector = arg.slice("--selector=".length).trim() as ProductionOrdersIncrementalSelector;
      continue;
    }
    if (arg.startsWith("--overlap-hours=")) {
      overlapHours = parsePositiveNumber(arg.slice("--overlap-hours=".length), "--overlap-hours");
      continue;
    }
    if (arg.startsWith("--page-size=")) {
      pageSize = Math.trunc(parsePositiveNumber(arg.slice("--page-size=".length), "--page-size"));
      continue;
    }
    if (arg.startsWith("--max-pages=")) {
      maxPages = Math.trunc(parsePositiveNumber(arg.slice("--max-pages=".length), "--max-pages"));
      continue;
    }
    if (arg.startsWith("--fallback-max-pages=")) {
      fallbackMaxPages = Math.trunc(
        parsePositiveNumber(arg.slice("--fallback-max-pages=".length), "--fallback-max-pages")
      );
      continue;
    }
    if (arg.startsWith("--state-file=")) {
      stateFile = arg.slice("--state-file=".length).trim() || null;
      continue;
    }
    if (arg === "--strict-selector") {
      strictSelector = true;
      continue;
    }
  }

  return {
    mode,
    selector,
    overlapHours,
    pageSize,
    maxPages,
    fallbackMaxPages,
    stateFile,
    strictSelector,
  };
}

export function parseProductionOrdersIncrementalState(
  raw: string | null | undefined
): ProductionOrdersIncrementalState | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ProductionOrdersIncrementalState>;
    if (parsed.version !== 1 || typeof parsed.lastSuccessAt !== "string") return null;
    if (typeof parsed.cutoffUsed !== "string") return null;
    return {
      version: 1,
      lastSuccessAt: parsed.lastSuccessAt,
      cutoffUsed: parsed.cutoffUsed,
      filterField: typeof parsed.filterField === "string" ? parsed.filterField : null,
      filterRsql: typeof parsed.filterRsql === "string" ? parsed.filterRsql : null,
      overlapHours:
        typeof parsed.overlapHours === "number"
          ? parsed.overlapHours
          : NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_OVERLAP_HOURS,
      strategy: parsed.strategy === "limited_page_window" ? "limited_page_window" : "date_filter",
      pagesRead: typeof parsed.pagesRead === "number" ? parsed.pagesRead : 0,
      recordsReceived: typeof parsed.recordsReceived === "number" ? parsed.recordsReceived : 0,
    };
  } catch {
    return null;
  }
}

export function serializeProductionOrdersIncrementalState(
  state: ProductionOrdersIncrementalState
): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** Cutoff = âncora − overlapHours (âncora = lastSuccess ou now no bootstrap). */
export function computeProductionOrdersIncrementalCutoff(args: {
  now: Date;
  lastSuccessAt: Date | null;
  overlapHours: number;
}): { cutoff: Date; bootstrap: boolean; anchor: Date } {
  const overlapMs = Math.max(1, args.overlapHours) * 60 * 60 * 1000;
  const bootstrap = args.lastSuccessAt == null;
  const anchor = args.lastSuccessAt ?? args.now;
  return {
    cutoff: new Date(anchor.getTime() - overlapMs),
    bootstrap,
    anchor,
  };
}

function toIsoDateParts(date: Date): { y: number; m: number; d: number } {
  // Usa UTC para determinismo em testes; RSQL Nomus é data civil dd/MM/yyyy.
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
}

export function formatProductionOrdersIncrementalCutoffBrDate(cutoff: Date): string {
  const { y, m, d } = toIsoDateParts(cutoff);
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isoDateToNomusBrDate(iso);
}

export function buildProductionOrdersIncrementalRsql(
  selector: "dataAlteracao" | "dataAbertura",
  cutoff: Date
): string {
  return `${selector}>=${formatProductionOrdersIncrementalCutoffBrDate(cutoff)}`;
}

export function planProductionOrdersIncremental(args: {
  options: ProductionOrdersIncrementalCliOptions;
  priorState: ProductionOrdersIncrementalState | null;
  now?: Date;
}): ProductionOrdersIncrementalPlan {
  const now = args.now ?? new Date();
  const decision = evaluateProductionOrdersIncrementalSelector(
    args.options.selector,
    args.options.fallbackMaxPages
  );

  const lastSuccessAt = args.priorState?.lastSuccessAt
    ? new Date(args.priorState.lastSuccessAt)
    : null;
  const { cutoff, bootstrap } = computeProductionOrdersIncrementalCutoff({
    now,
    lastSuccessAt:
      lastSuccessAt && !Number.isNaN(lastSuccessAt.getTime()) ? lastSuccessAt : null,
    overlapHours: args.options.overlapHours,
  });

  if (!decision.ok) {
    if (args.options.strictSelector) {
      throw new Error(
        `Seletor incremental rejeitado (${decision.requested}): ${decision.reason} Use --selector=dataAlteracao ou remova --strict-selector para fallback limitado auditado.`
      );
    }
    return {
      strategy: "limited_page_window",
      selectorDecision: decision,
      overlapHours: args.options.overlapHours,
      cutoffIso: cutoff.toISOString(),
      filterRsql: null,
      maxPages: Math.min(args.options.maxPages, decision.fallbackMaxPages),
      pageSize: args.options.pageSize,
      hadPriorState: args.priorState != null,
      priorLastSuccessAt: args.priorState?.lastSuccessAt ?? null,
      bootstrap,
    };
  }

  const filterRsql = buildProductionOrdersIncrementalRsql(decision.selector, cutoff);
  return {
    strategy: "date_filter",
    selectorDecision: decision,
    overlapHours: args.options.overlapHours,
    cutoffIso: cutoff.toISOString(),
    filterRsql,
    maxPages: args.options.maxPages,
    pageSize: args.options.pageSize,
    hadPriorState: args.priorState != null,
    priorLastSuccessAt: args.priorState?.lastSuccessAt ?? null,
    bootstrap,
  };
}

export function buildProductionOrdersIncrementalSuccessState(args: {
  plan: ProductionOrdersIncrementalPlan;
  finishedAt: Date;
  pagesRead: number;
  recordsReceived: number;
}): ProductionOrdersIncrementalState {
  const field =
    args.plan.selectorDecision.ok ? args.plan.selectorDecision.selector : null;
  return {
    version: 1,
    lastSuccessAt: args.finishedAt.toISOString(),
    cutoffUsed: args.plan.cutoffIso,
    filterField: field,
    filterRsql: args.plan.filterRsql,
    overlapHours: args.plan.overlapHours,
    strategy: args.plan.strategy,
    pagesRead: args.pagesRead,
    recordsReceived: args.recordsReceived,
  };
}
