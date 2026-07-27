/**
 * Chaves de recurso/ação da Central de Tesouraria (contrato canônico).
 * Bags legadas 1:1 ficam em `permissionCatalog` + `resources.ts`.
 * Sem Prisma.
 */

export const TREASURY_RESOURCE_KEY = "finance.treasury" as const;

export const TREASURY_RESOURCE_KEYS = {
  root: "finance.treasury",
  dashboard: "finance.treasury.dashboard",
  agenda: "finance.treasury.agenda",
  receivables: "finance.treasury.receivables",
  receivablesPromise: "finance.treasury.receivables.promise",
  receivablesCollection: "finance.treasury.receivables.collection",
  payables: "finance.treasury.payables",
  payablesProgram: "finance.treasury.payables.program",
  accounts: "finance.treasury.accounts",
  balances: "finance.treasury.balances",
  transfers: "finance.treasury.transfers",
  manualEntries: "finance.treasury.manual_entries",
  reconciliation: "finance.treasury.reconciliation",
  reconciliationReverse: "finance.treasury.reconciliation.reverse",
  exceptions: "finance.treasury.exceptions",
  closing: "finance.treasury.closing",
  audit: "finance.treasury.audit",
  reports: "finance.treasury.reports",
} as const;

export type TreasuryResourceKey =
  (typeof TREASURY_RESOURCE_KEYS)[keyof typeof TREASURY_RESOURCE_KEYS];

export const TREASURY_ACTIONS = {
  view: "view",
  create: "create",
  update: "update",
  execute: "execute",
  manage: "manage",
  export: "export",
  close: "close",
  reopen: "reopen",
} as const;

export type TreasuryAction = (typeof TREASURY_ACTIONS)[keyof typeof TREASURY_ACTIONS];

/** Bags legadas mínimas (catálogo) — 1:1 com o contrato. */
export const TREASURY_LEGACY_BAG_KEYS = [
  "finance.treasury.view",
  "finance.treasury.dashboard.view",
  "finance.treasury.agenda.view",
  "finance.treasury.receivables.view",
  "finance.treasury.receivables.manage",
  "finance.treasury.receivables.promise",
  "finance.treasury.receivables.collection",
  "finance.treasury.payables.view",
  "finance.treasury.payables.manage",
  "finance.treasury.payables.program",
  "finance.treasury.accounts.view",
  "finance.treasury.accounts.manage",
  "finance.treasury.balances.manage",
  "finance.treasury.transfers.view",
  "finance.treasury.transfers.manage",
  "finance.treasury.manual_entries.view",
  "finance.treasury.manual_entries.manage",
  "finance.treasury.reconciliation.view",
  "finance.treasury.reconciliation.manage",
  "finance.treasury.reconciliation.reverse",
  "finance.treasury.exceptions.view",
  "finance.treasury.exceptions.manage",
  "finance.treasury.closing.view",
  "finance.treasury.closing.close",
  "finance.treasury.closing.reopen",
  "finance.treasury.audit.view",
  "finance.treasury.reports.view",
  "finance.treasury.export",
] as const;

export type TreasuryLegacyBagKey = (typeof TREASURY_LEGACY_BAG_KEYS)[number];
