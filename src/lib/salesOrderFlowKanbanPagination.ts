/**
 * OP-68 — Estado puro de paginação incremental por coluna do Kanban.
 * Sem I/O. Reutiliza o cursor oficial da lista.
 * Browser-safe: não importa módulos de contrato que puxam Prisma/server.
 */
import type {
  SalesOrderFlowListCard,
  SalesOrderFlowListColumn,
  SalesOrderFlowListColumnTotals,
} from "@/src/lib/sales/salesOrderFlowList.js";
import type { SalesOrderFlowStage } from "@/src/lib/sales/salesOrderFlowCatalog.js";
import type { SalesOrderFlowIndicatorList } from "@/src/lib/salesOrderFlowUi.js";

/** Alinhado a `SALES_ORDER_FLOW_LIST_DEFAULT_LIMIT` (contrato da lista). */
export const SALES_ORDER_FLOW_COLUMN_PAGE_SIZE = 20;

/** Colunas operacionais do quadro (sem Cancelado por padrão). */
export const SALES_ORDER_FLOW_KANBAN_STAGES: readonly SalesOrderFlowStage[] = [
  "WAITING_RELEASE",
  "WAITING_PRODUCTION_ORDER",
  "IN_PRODUCTION",
  "WAITING_OUTPUT_DOCUMENT",
  "WAITING_NFE",
  "SHIPPED_COMPLETED",
];

export type SalesOrderFlowColumnLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export type SalesOrderFlowColumnPageState = {
  stage: SalesOrderFlowStage;
  status: SalesOrderFlowColumnLoadStatus;
  cards: SalesOrderFlowListCard[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  totals: SalesOrderFlowListColumnTotals;
  loadingMore: boolean;
  errorMessage: string | null;
  /** Geração dos filtros que originou este estado. */
  generation: number;
};

export type SalesOrderFlowColumnPageInput = Pick<
  SalesOrderFlowListColumn,
  "stage" | "cards" | "total" | "hasMore" | "nextCursor" | "totals"
>;

const EMPTY_TOTALS: SalesOrderFlowListColumnTotals = {
  overdueCount: 0,
  blockedCount: 0,
  inconsistentCount: 0,
  partiallyShippedCount: 0,
  withCutCount: 0,
};

/**
 * Etapas efetivamente carregadas: filtro de etapa, senão as seis operacionais.
 * Não carrega Cancelado a menos que o filtro o peça explicitamente.
 */
export function resolveSalesOrderFlowVisibleKanbanStages(
  filterStages: readonly SalesOrderFlowStage[]
): SalesOrderFlowStage[] {
  if (filterStages.length === 0) {
    return [...SALES_ORDER_FLOW_KANBAN_STAGES];
  }
  const allowed = new Set<SalesOrderFlowStage>([
    ...SALES_ORDER_FLOW_KANBAN_STAGES,
    "CANCELED",
  ]);
  const seen = new Set<SalesOrderFlowStage>();
  const out: SalesOrderFlowStage[] = [];
  for (const stage of filterStages) {
    if (!allowed.has(stage) || seen.has(stage)) continue;
    seen.add(stage);
    out.push(stage);
  }
  return out.length > 0 ? out : [...SALES_ORDER_FLOW_KANBAN_STAGES];
}

export function createSalesOrderFlowColumnLoadingState(
  stage: SalesOrderFlowStage,
  generation: number
): SalesOrderFlowColumnPageState {
  return {
    stage,
    status: "loading",
    cards: [],
    total: 0,
    hasMore: false,
    nextCursor: null,
    totals: { ...EMPTY_TOTALS },
    loadingMore: false,
    errorMessage: null,
    generation,
  };
}

export function createSalesOrderFlowColumnStates(
  stages: readonly SalesOrderFlowStage[],
  generation: number
): Record<string, SalesOrderFlowColumnPageState> {
  const next: Record<string, SalesOrderFlowColumnPageState> = {};
  for (const stage of stages) {
    next[stage] = createSalesOrderFlowColumnLoadingState(stage, generation);
  }
  return next;
}

/** Preserva ordem da API e remove duplicatas por orderId. */
export function appendSalesOrderFlowColumnCards(
  existing: readonly SalesOrderFlowListCard[],
  incoming: readonly SalesOrderFlowListCard[]
): SalesOrderFlowListCard[] {
  if (incoming.length === 0) return [...existing];
  const seen = new Set(existing.map((card) => card.orderId));
  const merged = [...existing];
  for (const card of incoming) {
    if (seen.has(card.orderId)) continue;
    seen.add(card.orderId);
    merged.push(card);
  }
  return merged;
}

/**
 * Aplica página inicial ou append. Respostas tardias (generation ≠ esperado)
 * são ignoradas para não sobrescrever filtros novos.
 */
export function applySalesOrderFlowColumnPage(input: {
  state: SalesOrderFlowColumnPageState;
  page: SalesOrderFlowColumnPageInput;
  expectedGeneration: number;
  mode: "replace" | "append";
}): SalesOrderFlowColumnPageState | null {
  if (input.state.generation !== input.expectedGeneration) return null;
  if (input.page.stage !== input.state.stage) return null;

  const cards =
    input.mode === "append"
      ? appendSalesOrderFlowColumnCards(input.state.cards, input.page.cards)
      : [...input.page.cards];

  return {
    ...input.state,
    status: "ready",
    cards,
    total: input.page.total,
    hasMore: input.page.hasMore,
    nextCursor: input.page.nextCursor,
    totals: { ...input.page.totals },
    loadingMore: false,
    errorMessage: null,
  };
}

export function applySalesOrderFlowColumnError(input: {
  state: SalesOrderFlowColumnPageState;
  expectedGeneration: number;
  message: string;
  keepCards?: boolean;
}): SalesOrderFlowColumnPageState | null {
  if (input.state.generation !== input.expectedGeneration) return null;
  return {
    ...input.state,
    status: input.keepCards && input.state.cards.length > 0 ? "ready" : "error",
    loadingMore: false,
    errorMessage: input.message,
  };
}

export function markSalesOrderFlowColumnLoadingMore(
  state: SalesOrderFlowColumnPageState,
  expectedGeneration: number
): SalesOrderFlowColumnPageState | null {
  if (state.generation !== expectedGeneration) return null;
  if (!state.hasMore || !state.nextCursor || state.loadingMore) return null;
  return {
    ...state,
    loadingMore: true,
    errorMessage: null,
  };
}

export function buildSalesOrderFlowIndicatorListFromColumns(input: {
  stages: readonly SalesOrderFlowStage[];
  columns: Readonly<Record<string, SalesOrderFlowColumnPageState>>;
  inconsistenciesVisible: boolean;
}): SalesOrderFlowIndicatorList {
  return {
    inconsistenciesVisible: input.inconsistenciesVisible,
    columns: input.stages.map((stage) => {
      const column = input.columns[stage];
      const totals = column?.totals ?? {
        ...EMPTY_TOTALS,
        inconsistentCount: input.inconsistenciesVisible ? 0 : null,
      };
      return {
        stage,
        total: column?.total ?? 0,
        totals: {
          ...totals,
          inconsistentCount: input.inconsistenciesVisible
            ? (totals.inconsistentCount ?? 0)
            : null,
        },
      };
    }),
  };
}

export function salesOrderFlowColumnStatesHaveCards(
  columns: Readonly<Record<string, SalesOrderFlowColumnPageState>>
): boolean {
  return Object.values(columns).some((column) => column.cards.length > 0);
}

/**
 * Atualiza priority/bloqueio do card no quadro após PATCH de gestão.
 * Não altera a coluna automática (currentStage).
 */
export function patchSalesOrderFlowKanbanCard(
  columns: Readonly<Record<string, SalesOrderFlowColumnPageState>>,
  salesOrderId: string,
  patch: Partial<
    Pick<SalesOrderFlowListCard, "priority" | "isBlocked" | "blockReason">
  >
): Record<string, SalesOrderFlowColumnPageState> {
  const next: Record<string, SalesOrderFlowColumnPageState> = { ...columns };
  for (const [stage, state] of Object.entries(columns)) {
    const index = state.cards.findIndex((card) => card.orderId === salesOrderId);
    if (index < 0) continue;
    const cards = state.cards.slice();
    const previous = cards[index]!;
    const wasBlocked = previous.isBlocked === true;
    const nextBlocked =
      patch.isBlocked !== undefined ? patch.isBlocked === true : wasBlocked;
    cards[index] = {
      ...previous,
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.isBlocked !== undefined ? { isBlocked: patch.isBlocked } : {}),
      ...(patch.blockReason !== undefined
        ? { blockReason: patch.blockReason }
        : {}),
    };
    let totals = state.totals;
    if (wasBlocked !== nextBlocked) {
      const blockedCount = Math.max(
        0,
        (totals.blockedCount ?? 0) + (nextBlocked ? 1 : -1)
      );
      totals = { ...totals, blockedCount };
    }
    next[stage] = { ...state, cards, totals };
  }
  return next;
}

export function salesOrderFlowColumnStatesAllSettled(
  stages: readonly SalesOrderFlowStage[],
  columns: Readonly<Record<string, SalesOrderFlowColumnPageState>>
): boolean {
  return stages.every((stage) => {
    const column = columns[stage];
    return column != null && column.status !== "loading";
  });
}
