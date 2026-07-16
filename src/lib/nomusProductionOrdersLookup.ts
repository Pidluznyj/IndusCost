/**
 * Consulta pontual e reconciliação operacional de Ordens de Produção Nomus (OP-10).
 *
 * Filtros pontuais (não percorrem toda a base):
 * - --name / nome=="..."
 * - --external-id / id==N (endpoint confirma suporte)
 * - --sales-order-external-id / itensPedido.idPedido==N (tentativa; pode cair em ids locais)
 * - --sales-order-item-external-id / itensPedido.id==N (idem)
 *
 * --reconcile-unresolved: só banco (sem API) — resolve FKs de vínculos já armazenados.
 */

import { escapeNomusRsqlQuotedValue } from "@/src/lib/nomusProductionOrdersSyncLogic.js";

export const NOMUS_PRODUCTION_ORDERS_LOOKUP_DEFAULT_PAGE_SIZE = 50;
export const NOMUS_PRODUCTION_ORDERS_LOOKUP_DEFAULT_MAX_PAGES = 5;
export const NOMUS_PRODUCTION_ORDERS_LOOKUP_DEFAULT_RECONCILE_LIMIT = 500;

export type ProductionOrdersLookupMode = "preview" | "apply";

export type ProductionOrdersLookupCliOptions = {
  mode: ProductionOrdersLookupMode;
  names: string[];
  externalIds: number[];
  salesOrderExternalIds: number[];
  salesOrderItemExternalIds: number[];
  reconcileUnresolved: boolean;
  pageSize: number;
  maxPages: number;
  reconcileLimit: number;
};

function parsePositiveIntList(raw: string, label: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} inválido: ${part}`);
      return n;
    });
}

export type ProductionOrdersLookupQueryPlan = {
  queries: string[];
  /** Quando true, runner não deve chamar a API (só reconcile). */
  apiRequired: boolean;
  /** Origem de cada query para auditoria. */
  sources: Array<{
    kind: "name" | "external_id" | "sales_order" | "sales_order_item" | "local_resolved_op";
    value: string | number;
    rsql: string;
  }>;
};

export type ProductionOrdersLookupLinkAudit = {
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  localSalesOrderId: string | null;
  localSalesOrderItemId: string | null;
  pending: boolean;
  isCurrent?: boolean;
};

export type ProductionOrdersLookupOrderAudit = {
  externalId: number | null;
  name: string | null;
  status: string | null;
  outcome: "created" | "updated" | "unchanged" | "invalid" | "preview" | "error" | "not_found";
  productionOrderId: string | null;
  links: ProductionOrdersLookupLinkAudit[];
  pendingCount: number;
  reasons?: string[];
  error?: string | null;
};

export type ProductionOrdersLookupSummary = {
  mode: ProductionOrdersLookupMode;
  strategy: "lookup";
  operation: "lookup" | "reconcile" | "lookup_and_reconcile";
  filters: {
    names: string[];
    externalIds: number[];
    salesOrderExternalIds: number[];
    salesOrderItemExternalIds: number[];
    reconcileUnresolved: boolean;
  };
  queries: string[];
  apiCalled: boolean;
  pagesRead: number;
  recordsReceived: number;
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
  errors: number;
  orders: ProductionOrdersLookupOrderAudit[];
  pendingLinks: ProductionOrdersLookupLinkAudit[];
  reconcile: {
    scanned: number;
    salesOrderResolved: number;
    salesOrderItemResolved: number;
    updated: number;
  } | null;
  errorReport: Array<{ externalId: number | null; message: string }>;
  durationMs: number;
};

function parseCsvStrings(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function readIntListArg(raw: string, label: string): number[] {
  return parsePositiveIntList(raw, label);
}

/**
 * Aceita kebab-case (oficial OP-10) e aliases camelCase do sync pontual legado.
 */
export function parseProductionOrdersLookupCli(argv: string[]): ProductionOrdersLookupCliOptions {
  const mode: ProductionOrdersLookupMode =
    argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";

  const names: string[] = [];
  const externalIds: number[] = [];
  const salesOrderExternalIds: number[] = [];
  const salesOrderItemExternalIds: number[] = [];
  let reconcileUnresolved = false;
  let pageSize = NOMUS_PRODUCTION_ORDERS_LOOKUP_DEFAULT_PAGE_SIZE;
  let maxPages = NOMUS_PRODUCTION_ORDERS_LOOKUP_DEFAULT_MAX_PAGES;
  let reconcileLimit = NOMUS_PRODUCTION_ORDERS_LOOKUP_DEFAULT_RECONCILE_LIMIT;

  for (const arg of argv) {
    if (arg === "preview" || arg === "apply" || arg === "--apply") continue;
    if (arg === "--reconcile-unresolved" || arg === "--reconcileUnresolved") {
      reconcileUnresolved = true;
      continue;
    }
    if (arg.startsWith("--name=")) {
      names.push(...parseCsvStrings(arg.slice("--name=".length)));
      continue;
    }
    if (arg.startsWith("--external-id=")) {
      externalIds.push(...readIntListArg(arg.slice("--external-id=".length), "external-id"));
      continue;
    }
    if (arg.startsWith("--externalId=")) {
      externalIds.push(...readIntListArg(arg.slice("--externalId=".length), "externalId"));
      continue;
    }
    if (arg.startsWith("--sales-order-external-id=")) {
      salesOrderExternalIds.push(
        ...readIntListArg(arg.slice("--sales-order-external-id=".length), "sales-order-external-id")
      );
      continue;
    }
    if (arg.startsWith("--salesOrderExternalId=")) {
      salesOrderExternalIds.push(
        ...readIntListArg(arg.slice("--salesOrderExternalId=".length), "salesOrderExternalId")
      );
      continue;
    }
    if (arg.startsWith("--sales-order-item-external-id=")) {
      salesOrderItemExternalIds.push(
        ...readIntListArg(
          arg.slice("--sales-order-item-external-id=".length),
          "sales-order-item-external-id"
        )
      );
      continue;
    }
    if (arg.startsWith("--salesOrderItemExternalId=")) {
      salesOrderItemExternalIds.push(
        ...readIntListArg(
          arg.slice("--salesOrderItemExternalId=".length),
          "salesOrderItemExternalId"
        )
      );
      continue;
    }
    if (arg.startsWith("--page-size=")) {
      const parsed = Number.parseInt(arg.slice("--page-size=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--page-size inválido: ${arg}`);
      pageSize = parsed;
      continue;
    }
    if (arg.startsWith("--max-pages=")) {
      const parsed = Number.parseInt(arg.slice("--max-pages=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--max-pages inválido: ${arg}`);
      maxPages = parsed;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--limit inválido: ${arg}`);
      reconcileLimit = parsed;
      continue;
    }
  }

  const hasLookupFilter =
    names.length > 0 ||
    externalIds.length > 0 ||
    salesOrderExternalIds.length > 0 ||
    salesOrderItemExternalIds.length > 0;

  if (!hasLookupFilter && !reconcileUnresolved) {
    throw new Error(
      "Informe ao menos um filtro pontual (--name, --external-id, --sales-order-external-id, --sales-order-item-external-id) ou --reconcile-unresolved."
    );
  }

  return {
    mode,
    names: [...new Set(names)],
    externalIds: [...new Set(externalIds)],
    salesOrderExternalIds: [...new Set(salesOrderExternalIds)],
    salesOrderItemExternalIds: [...new Set(salesOrderItemExternalIds)],
    reconcileUnresolved,
    pageSize,
    maxPages,
    reconcileLimit,
  };
}

export function buildProductionOrderExternalIdQuery(externalId: number): string {
  if (!Number.isFinite(externalId) || externalId <= 0) {
    throw new Error(`externalId inválido para RSQL: ${externalId}`);
  }
  return `id==${Math.trunc(externalId)}`;
}

export function buildProductionOrderNameLookupQuery(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nome da OP vazio para consulta RSQL.");
  return `nome=="${escapeNomusRsqlQuotedValue(trimmed)}"`;
}

export function buildProductionOrderSalesOrderQuery(salesOrderExternalId: number): string {
  return `itensPedido.idPedido==${Math.trunc(salesOrderExternalId)}`;
}

export function buildProductionOrderSalesOrderItemQuery(
  salesOrderItemExternalId: number
): string {
  return `itensPedido.id==${Math.trunc(salesOrderItemExternalId)}`;
}

/**
 * Monta queries pontuais. `localOpExternalIds` permite resolver pedido/item via vínculos
 * já armazenados sem full scan (ids locais → id==N).
 */
export function planProductionOrdersLookupQueries(
  options: Pick<
    ProductionOrdersLookupCliOptions,
    | "names"
    | "externalIds"
    | "salesOrderExternalIds"
    | "salesOrderItemExternalIds"
    | "reconcileUnresolved"
  >,
  localOpExternalIds: number[] = []
): ProductionOrdersLookupQueryPlan {
  const sources: ProductionOrdersLookupQueryPlan["sources"] = [];
  const queries: string[] = [];
  const seen = new Set<string>();

  const push = (
    kind: ProductionOrdersLookupQueryPlan["sources"][number]["kind"],
    value: string | number,
    rsql: string
  ) => {
    if (seen.has(rsql)) return;
    seen.add(rsql);
    queries.push(rsql);
    sources.push({ kind, value, rsql });
  };

  for (const name of options.names) {
    push("name", name, buildProductionOrderNameLookupQuery(name));
  }
  for (const id of options.externalIds) {
    push("external_id", id, buildProductionOrderExternalIdQuery(id));
  }
  for (const id of options.salesOrderExternalIds) {
    push("sales_order", id, buildProductionOrderSalesOrderQuery(id));
  }
  for (const id of options.salesOrderItemExternalIds) {
    push("sales_order_item", id, buildProductionOrderSalesOrderItemQuery(id));
  }
  for (const id of localOpExternalIds) {
    push("local_resolved_op", id, buildProductionOrderExternalIdQuery(id));
  }

  const hasLookupFilter =
    options.names.length > 0 ||
    options.externalIds.length > 0 ||
    options.salesOrderExternalIds.length > 0 ||
    options.salesOrderItemExternalIds.length > 0 ||
    localOpExternalIds.length > 0;

  return {
    queries,
    apiRequired: hasLookupFilter,
    sources,
  };
}

export function resolveProductionOrdersLookupOperation(
  options: Pick<
    ProductionOrdersLookupCliOptions,
    | "names"
    | "externalIds"
    | "salesOrderExternalIds"
    | "salesOrderItemExternalIds"
    | "reconcileUnresolved"
  >
): ProductionOrdersLookupSummary["operation"] {
  const hasLookup =
    options.names.length > 0 ||
    options.externalIds.length > 0 ||
    options.salesOrderExternalIds.length > 0 ||
    options.salesOrderItemExternalIds.length > 0;
  if (hasLookup && options.reconcileUnresolved) return "lookup_and_reconcile";
  if (options.reconcileUnresolved) return "reconcile";
  return "lookup";
}

export function emptyProductionOrdersLookupSummary(
  options: ProductionOrdersLookupCliOptions,
  partial?: Partial<ProductionOrdersLookupSummary>
): ProductionOrdersLookupSummary {
  return {
    mode: options.mode,
    strategy: "lookup",
    operation: resolveProductionOrdersLookupOperation(options),
    filters: {
      names: options.names,
      externalIds: options.externalIds,
      salesOrderExternalIds: options.salesOrderExternalIds,
      salesOrderItemExternalIds: options.salesOrderItemExternalIds,
      reconcileUnresolved: options.reconcileUnresolved,
    },
    queries: [],
    apiCalled: false,
    pagesRead: 0,
    recordsReceived: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
    errors: 0,
    orders: [],
    pendingLinks: [],
    reconcile: null,
    errorReport: [],
    durationMs: 0,
    ...partial,
  };
}
