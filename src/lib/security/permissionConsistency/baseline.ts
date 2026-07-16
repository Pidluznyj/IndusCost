/**
 * Baseline temporário P02 — gaps históricos conhecidos (frozen 2026-07-16).
 * Strict falha apenas em findings cujo (code, subject) NÃO está aqui.
 *
 * Ao corrigir um gap: remova a entrada correspondente.
 * Ao introduzir gap novo: o CI deve falhar — NÃO adicione aqui sem revisão em
 * docs/security/permissions-consistency.md.
 */

import type {
  PermissionConsistencyBaselineEntry,
  PermissionConsistencyCode,
} from "./types.ts";

export const PERMISSION_CONSISTENCY_BASELINE: readonly PermissionConsistencyBaselineEntry[] = [
  {"code":"FE_BE_KEY_MISMATCH","subject":"configuracoes|admin.settings","reason":"Frontend usa resourceKey `configuracoes`; contrato canônico usa `admin.settings`."},
  {"code":"ALIAS_WIDE","subject":"accessProfiles.view","reason":"Alias amplo no FE: accessProfiles.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.audit.view","reason":"Alias amplo no FE: commissions.audit.view → 4 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.dashboard.view","reason":"Alias amplo no FE: commissions.dashboard.view → 4 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.payments.view","reason":"Alias amplo no FE: commissions.payments.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.release.view","reason":"Alias amplo no FE: commissions.release.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.rules.view","reason":"Alias amplo no FE: commissions.rules.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.view","reason":"Alias amplo no FE: commissions.view → 15 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.general.view","reason":"Alias amplo no FE: crm.general.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.seller.all","reason":"Alias amplo no FE: crm.seller.all → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.seller.own","reason":"Alias amplo no FE: crm.seller.own → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.seller.view","reason":"Alias amplo no FE: crm.seller.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.view","reason":"Alias amplo no FE: crm.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"customers.view","reason":"Alias amplo no FE: customers.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"employees.edit","reason":"Alias amplo no FE: employees.edit → 7 recursos"},
  {"code":"ALIAS_WIDE","subject":"employees.view","reason":"Alias amplo no FE: employees.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"finance.portfolioReconciliation.conciliation.view","reason":"Alias amplo no FE: finance.portfolioReconciliation.conciliation.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"finance.portfolioReconciliation.intelligence.view","reason":"Alias amplo no FE: finance.portfolioReconciliation.intelligence.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"finance.portfolioReconciliation.orderStatusPedidos.view","reason":"Alias amplo no FE: finance.portfolioReconciliation.orderStatusPedidos.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"finance.portfolioReconciliation.orderToCashAudit.view","reason":"Alias amplo no FE: finance.portfolioReconciliation.orderToCashAudit.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"finance.view","reason":"Alias amplo no FE: finance.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"fleet.view","reason":"Alias amplo no FE: fleet.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"inventory.view","reason":"Alias amplo no FE: inventory.view → 6 recursos"},
  {"code":"ALIAS_WIDE","subject":"machines.view","reason":"Alias amplo no FE: machines.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"maintenance.view","reason":"Alias amplo no FE: maintenance.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"materials.market_quote.approve","reason":"Alias amplo no FE: materials.market_quote.approve → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"materials.market_quote.manual_exchange","reason":"Alias amplo no FE: materials.market_quote.manual_exchange → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"materials.view","reason":"Alias amplo no FE: materials.view → 9 recursos"},
  {"code":"ALIAS_WIDE","subject":"products.view","reason":"Alias amplo no FE: products.view → 4 recursos"},
  {"code":"ALIAS_WIDE","subject":"projects.view","reason":"Alias amplo no FE: projects.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"purchases.view","reason":"Alias amplo no FE: purchases.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"reports.view","reason":"Alias amplo no FE: reports.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"sales_orders.view","reason":"Alias amplo no FE: sales_orders.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"settings.view","reason":"Alias amplo no FE: settings.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"simulations.view","reason":"Alias amplo no FE: simulations.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"users.manage","reason":"Alias amplo no FE: users.manage → 5 recursos"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:products.view","reason":"Alias legado em múltiplos recursos do contrato: products.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:simulations.view","reason":"Alias legado em múltiplos recursos do contrato: simulations.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:materials.view","reason":"Alias legado em múltiplos recursos do contrato: materials.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:materials.edit","reason":"Alias legado em múltiplos recursos do contrato: materials.edit"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:projects.view","reason":"Alias legado em múltiplos recursos do contrato: projects.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:projects.manage","reason":"Alias legado em múltiplos recursos do contrato: projects.manage"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:crm.view","reason":"Alias legado em múltiplos recursos do contrato: crm.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:sales_orders.view","reason":"Alias legado em múltiplos recursos do contrato: sales_orders.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:proposals.view","reason":"Alias legado em múltiplos recursos do contrato: proposals.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:customers.view","reason":"Alias legado em múltiplos recursos do contrato: customers.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:commissions.view","reason":"Alias legado em múltiplos recursos do contrato: commissions.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:pricing.view","reason":"Alias legado em múltiplos recursos do contrato: pricing.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:crm.general.view","reason":"Alias legado em múltiplos recursos do contrato: crm.general.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:crm.seller.view","reason":"Alias legado em múltiplos recursos do contrato: crm.seller.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:crm.seller.own","reason":"Alias legado em múltiplos recursos do contrato: crm.seller.own"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:crm.seller.all","reason":"Alias legado em múltiplos recursos do contrato: crm.seller.all"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:pricing.publish_tables","reason":"Alias legado em múltiplos recursos do contrato: pricing.publish_tables"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:commissions.payments.manage","reason":"Alias legado em múltiplos recursos do contrato: commissions.payments.manage"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:commissions.rules.manage","reason":"Alias legado em múltiplos recursos do contrato: commissions.rules.manage"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:finance.view","reason":"Alias legado em múltiplos recursos do contrato: finance.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:reports.view","reason":"Alias legado em múltiplos recursos do contrato: reports.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:settings.nomus.sync","reason":"Alias legado em múltiplos recursos do contrato: settings.nomus.sync"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:inventory.view","reason":"Alias legado em múltiplos recursos do contrato: inventory.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:purchases.view","reason":"Alias legado em múltiplos recursos do contrato: purchases.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:machines.view","reason":"Alias legado em múltiplos recursos do contrato: machines.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:fleet.view","reason":"Alias legado em múltiplos recursos do contrato: fleet.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:maintenance.view","reason":"Alias legado em múltiplos recursos do contrato: maintenance.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:inventory.manage","reason":"Alias legado em múltiplos recursos do contrato: inventory.manage"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:settings.view","reason":"Alias legado em múltiplos recursos do contrato: settings.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:employees.view","reason":"Alias legado em múltiplos recursos do contrato: employees.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:guide.view","reason":"Alias legado em múltiplos recursos do contrato: guide.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:users.manage","reason":"Alias legado em múltiplos recursos do contrato: users.manage"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:employees.edit","reason":"Alias legado em múltiplos recursos do contrato: employees.edit"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:taxes.view","reason":"Alias legado em multiplos recursos do contrato: taxes.view (finance.taxes + finance.tax_apuration / T05)."},
  {"code":"ALIAS_DUPLICATE","subject":"contract:finance.tax_apuration.view","reason":"Alias legado em multiplos recursos do contrato: finance.tax_apuration.view (finance.taxes + finance.tax_apuration / T05)."},
  {"code":"ALIAS_DUPLICATE","subject":"contract:finance.tax_apuration.manage","reason":"Alias legado em multiplos recursos do contrato: finance.tax_apuration.manage (finance.taxes + finance.tax_apuration / T05)."},
  {"code":"ALIAS_DUPLICATE","subject":"contract:products.edit","reason":"PERM-32: products.edit também em engineering.products.tab.bom/tree para preservar OR legado das APIs BOM."},
  {"code":"ALIAS_DUPLICATE","subject":"contract:products.tab.bom","reason":"PERM-32: products.tab.bom também em engineering.products.tab.tree para preservar OR legado da árvore."},
  {"code":"ALIAS_DUPLICATE","subject":"contract:costs.view","reason":"PERM-32: costs.view também em engineering.products.tab.cost para /api/sales-orders/results."},
  {"code":"ALIAS_DUPLICATE","subject":"contract:finance.suppliers.view","reason":"PERM-32: finance.suppliers.view também em service_termination para preservar OR legado."},
  {"code":"ALIAS_DUPLICATE","subject":"contract:finance.suppliers.manage","reason":"PERM-32: finance.suppliers.manage também em service_termination para preservar OR legado."},
];

export function baselineKey(
  code: PermissionConsistencyCode | string,
  subject: string
): string {
  return `${code}::${subject}`;
}

export function buildBaselineIndex(
  entries: readonly PermissionConsistencyBaselineEntry[] = PERMISSION_CONSISTENCY_BASELINE
): ReadonlySet<string> {
  return new Set(entries.map((e) => baselineKey(e.code, e.subject)));
}

let cachedIndex: ReadonlySet<string> | null = null;

export function isBaselinedFinding(
  code: PermissionConsistencyCode,
  subject: string,
  entries: readonly PermissionConsistencyBaselineEntry[] = PERMISSION_CONSISTENCY_BASELINE
): boolean {
  if (entries === PERMISSION_CONSISTENCY_BASELINE) {
    if (!cachedIndex) cachedIndex = buildBaselineIndex(entries);
    return cachedIndex.has(baselineKey(code, subject));
  }
  return buildBaselineIndex(entries).has(baselineKey(code, subject));
}

export function listStaleBaselineEntries(
  current: readonly { code: PermissionConsistencyCode; subject: string }[],
  entries: readonly PermissionConsistencyBaselineEntry[] = PERMISSION_CONSISTENCY_BASELINE
): PermissionConsistencyBaselineEntry[] {
  const live = new Set(current.map((f) => baselineKey(f.code, f.subject)));
  return entries.filter((e) => !live.has(baselineKey(e.code, e.subject)));
}
