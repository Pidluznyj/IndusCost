/**
 * Cliente browser-safe — GET /api/materials/stock-tablet/search.
 * Debounce/abort ficam no page hook; este módulo é puro + fetch tipado.
 */
import { fetchJsonOk } from "@/src/lib/http.js";
import type { MaterialStockStatus } from "./materialStockLevelRules.js";
import { MATERIAL_STOCK_TABLET_FORBIDDEN_KEYS } from "./materialStockTabletSerialization.js";
import {
  MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE,
  MATERIAL_STOCK_TABLET_DEFAULT_STALE_DAYS,
  MATERIAL_STOCK_TABLET_SEARCH_PATH,
  type MaterialStockTabletListItem,
  type MaterialStockTabletSearchResponse,
} from "./materialStockTabletTypes.js";

export type MaterialStockListFilterId =
  | "ALL"
  | "ATENCAO"
  | "CRITICO"
  | "EMERGENCIA"
  | "SEM_ESTOQUE"
  | "MISSING_LEVELS"
  | "STALE_CONFERENCE";

export type MaterialStockListFilterDef = {
  id: MaterialStockListFilterId;
  label: string;
};

export const MATERIAL_STOCK_LIST_FILTERS: readonly MaterialStockListFilterDef[] = [
  { id: "ALL", label: "Todos" },
  { id: "ATENCAO", label: "Atenção" },
  { id: "CRITICO", label: "Críticos" },
  { id: "EMERGENCIA", label: "Emergência" },
  { id: "SEM_ESTOQUE", label: "Sem estoque" },
  { id: "MISSING_LEVELS", label: "Sem parâmetros" },
  { id: "STALE_CONFERENCE", label: "Sem conferência recente" },
] as const;

export const MATERIAL_STOCK_LIST_PAGE_SIZE = MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE;
export const MATERIAL_STOCK_LIST_SEARCH_DEBOUNCE_MS = 300;

export type MaterialStockTabletSearchParams = {
  page?: number;
  pageSize?: number;
  q?: string;
  filter?: MaterialStockListFilterId;
  staleDays?: number;
  signal?: AbortSignal;
};

export function buildMaterialStockTabletSearchUrl(
  params: MaterialStockTabletSearchParams = {}
): string {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page ?? 1));
  qs.set(
    "pageSize",
    String(params.pageSize ?? MATERIAL_STOCK_LIST_PAGE_SIZE)
  );
  // Ativos por padrão — inativos não entram na lista operacional.
  qs.set("materialStatus", "ACTIVE");

  const q = params.q?.trim() ?? "";
  if (q) qs.set("q", q);

  const filter = params.filter ?? "ALL";
  if (
    filter === "ATENCAO" ||
    filter === "CRITICO" ||
    filter === "EMERGENCIA" ||
    filter === "SEM_ESTOQUE"
  ) {
    qs.set("stockStatus", filter as MaterialStockStatus);
  } else if (filter === "MISSING_LEVELS") {
    qs.set("missingLevels", "true");
  } else if (filter === "STALE_CONFERENCE") {
    qs.set("staleConference", "true");
    qs.set(
      "staleDays",
      String(params.staleDays ?? MATERIAL_STOCK_TABLET_DEFAULT_STALE_DAYS)
    );
  }

  return `${MATERIAL_STOCK_TABLET_SEARCH_PATH}?${qs.toString()}`;
}

export async function fetchMaterialStockTabletSearch(
  params: MaterialStockTabletSearchParams = {}
): Promise<MaterialStockTabletSearchResponse> {
  return fetchJsonOk<MaterialStockTabletSearchResponse>(
    buildMaterialStockTabletSearchUrl(params),
    { credentials: "include", signal: params.signal }
  );
}

export function isMaterialStockSearchAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "AbortError";
}

/** Auto-seleciona o 1º item só em split e sem deep link — evita abrir detalhe fullscreen sem intenção. */
export function shouldAutoSelectFirstStockItem(input: {
  layoutMode: "split" | "stacked";
  routeMaterialId: string | null | undefined;
  rows: ReadonlyArray<{ id: string }>;
  alreadyAutoSelected: boolean;
}): string | null {
  if (input.alreadyAutoSelected) return null;
  if (input.layoutMode !== "split") return null;
  if (input.routeMaterialId) return null;
  return input.rows[0]?.id ?? null;
}

/** Mantém seleção se o id ainda estiver na lista carregada. */
export function resolvePreservedStockSelection(
  selectedId: string | null | undefined,
  rows: ReadonlyArray<{ id: string }>
): string | null {
  if (!selectedId) return null;
  return rows.some((r) => r.id === selectedId) ? selectedId : null;
}

export function appendStockTabletSearchPages(
  previous: MaterialStockTabletListItem[],
  nextPage: MaterialStockTabletListItem[]
): MaterialStockTabletListItem[] {
  if (previous.length === 0) return [...nextPage];
  const seen = new Set(previous.map((r) => r.id));
  const merged = [...previous];
  for (const row of nextPage) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

export function hasMoreStockTabletPages(input: {
  page: number;
  totalPages: number;
  loadedCount: number;
  total: number;
}): boolean {
  if (input.total <= 0) return false;
  if (input.loadedCount >= input.total) return false;
  return input.page < input.totalPages;
}

export function summarizeStockListDescription(
  description: string,
  maxChars = 72
): string {
  const text = description.trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function assertStockTabletListItemHasNoCostFields(
  row: Record<string, unknown>
): string[] {
  const forbidden = new Set<string>([
    ...MATERIAL_STOCK_TABLET_FORBIDDEN_KEYS,
    "landedCost",
    "effectiveCost",
    "totalMaterialValue",
  ]);
  return Object.keys(row).filter((key) => forbidden.has(key));
}
