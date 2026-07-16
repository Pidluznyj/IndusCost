/**
 * Planejamento puro do preview de sync de Ordens de Produção (OP-07).
 * Sem I/O — classifica create/update/unchanged/invalid e impacto de vínculos.
 */

import type { MappedNomusProductionOrder } from "@/src/lib/nomusProductionOrdersMapper.js";
import type { ProductionOrdersSyncCliOptions } from "@/src/lib/nomusProductionOrdersSyncLogic.js";

export const PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER =
  "DRY RUN — NENHUMA GRAVAÇÃO EXECUTADA" as const;

export type ProductionOrderPreviewHeaderAction = "create" | "update" | "unchanged";

export type ExistingProductionOrderSnapshot = {
  externalId: number;
  payloadHash: string;
};

export type ExistingProductionOrderLinkSnapshot = {
  productionOrderExternalId: number;
  externalSalesOrderItemId: number;
  isCurrent: boolean;
};

export type ProductionOrderPreviewLinkPlan = {
  linkedRows: number;
  locallyResolved: number;
  unresolved: number;
  linksToDeactivate: number;
};

export type ProductionOrderPreviewPlan = {
  externalId: number | null;
  action: ProductionOrderPreviewHeaderAction | "invalid";
  name: string | null;
  status: string | null;
  salesLinkCount: number;
  reasons: string[];
  links: ProductionOrderPreviewLinkPlan;
};

export type ProductionOrdersPreviewFilters = {
  strategy: string;
  names: string[];
  externalIds: number[];
  salesOrderExternalIds: number[];
  from: string | null;
  to: string | null;
  dateField: string;
  startPage: number;
  maxPages: number | null;
  pageSize: number;
  queries: Array<string | null>;
};

export type ProductionOrdersPreviewSummary = {
  mode: "preview";
  dryRunBanner: typeof PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER;
  pagesRead: number;
  recordsReceived: number;
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
  linkedRows: number;
  locallyResolved: number;
  unresolved: number;
  linksToDeactivate: number;
  rateLimitCount: number;
  errors: number;
  duration: number;
  filters: ProductionOrdersPreviewFilters;
};

export function planProductionOrderLinksPreview(args: {
  incomingItemIds: number[];
  existingCurrentItemIds: number[];
  resolvedFullyCount: number;
  unresolvedCount: number;
}): ProductionOrderPreviewLinkPlan {
  const incoming = new Set(args.incomingItemIds);
  let linksToDeactivate = 0;
  for (const id of args.existingCurrentItemIds) {
    if (!incoming.has(id)) linksToDeactivate += 1;
  }
  return {
    linkedRows: args.incomingItemIds.length,
    locallyResolved: args.resolvedFullyCount,
    unresolved: args.unresolvedCount,
    linksToDeactivate,
  };
}

export function planProductionOrderPreview(args: {
  row: MappedNomusProductionOrder | null;
  existing: ExistingProductionOrderSnapshot | null;
  mapReasons?: string[];
  links: ProductionOrderPreviewLinkPlan;
}): ProductionOrderPreviewPlan {
  if (!args.row) {
    return {
      externalId: null,
      action: "invalid",
      name: null,
      status: null,
      salesLinkCount: 0,
      reasons: args.mapReasons ?? ["INVALID_PAYLOAD"],
      links: args.links,
    };
  }

  let action: ProductionOrderPreviewHeaderAction;
  if (!args.existing) action = "create";
  else if (args.existing.payloadHash === args.row.payloadHash) action = "unchanged";
  else action = "update";

  return {
    externalId: args.row.externalId,
    action,
    name: args.row.name,
    status: args.row.status,
    salesLinkCount: args.row.salesLinks.length,
    reasons: [],
    links: args.links,
  };
}

export function summarizeProductionOrderPreviewPlans(
  plans: ProductionOrderPreviewPlan[]
): Pick<
  ProductionOrdersPreviewSummary,
  | "created"
  | "updated"
  | "unchanged"
  | "invalid"
  | "linkedRows"
  | "locallyResolved"
  | "unresolved"
  | "linksToDeactivate"
> {
  const summary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
    linkedRows: 0,
    locallyResolved: 0,
    unresolved: 0,
    linksToDeactivate: 0,
  };
  for (const plan of plans) {
    if (plan.action === "create") summary.created += 1;
    else if (plan.action === "update") summary.updated += 1;
    else if (plan.action === "unchanged") summary.unchanged += 1;
    else summary.invalid += 1;
    summary.linkedRows += plan.links.linkedRows;
    summary.locallyResolved += plan.links.locallyResolved;
    summary.unresolved += plan.links.unresolved;
    summary.linksToDeactivate += plan.links.linksToDeactivate;
  }
  return summary;
}

export function buildProductionOrdersPreviewFilters(
  options: ProductionOrdersSyncCliOptions,
  queries: Array<string | null>
): ProductionOrdersPreviewFilters {
  return {
    strategy: options.strategy,
    names: [...options.names],
    externalIds: [...options.externalIds],
    salesOrderExternalIds: [...options.salesOrderExternalIds],
    from: options.from,
    to: options.to,
    dateField: options.dateField,
    startPage: options.startPage,
    maxPages: options.maxPages,
    pageSize: options.pageSize,
    queries: [...queries],
  };
}

export function buildProductionOrdersPreviewSummary(args: {
  pagesRead: number;
  recordsReceived: number;
  plans: ProductionOrderPreviewPlan[];
  rateLimitCount: number;
  errors: number;
  durationMs: number;
  filters: ProductionOrdersPreviewFilters;
}): ProductionOrdersPreviewSummary {
  const tallies = summarizeProductionOrderPreviewPlans(args.plans);
  return {
    mode: "preview",
    dryRunBanner: PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER,
    pagesRead: args.pagesRead,
    recordsReceived: args.recordsReceived,
    ...tallies,
    rateLimitCount: args.rateLimitCount,
    errors: args.errors,
    duration: args.durationMs,
    filters: args.filters,
  };
}
