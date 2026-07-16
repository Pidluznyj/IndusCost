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
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.employees","reason":"Recurso no frontend ausente do seed relacional: admin.employees"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.employees.administrative_data","reason":"Recurso no frontend ausente do seed relacional: admin.employees.administrative_data"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.employees.epi","reason":"Recurso no frontend ausente do seed relacional: admin.employees.epi"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.employees.links","reason":"Recurso no frontend ausente do seed relacional: admin.employees.links"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.employees.personal_data","reason":"Recurso no frontend ausente do seed relacional: admin.employees.personal_data"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.employees.sensitive_data","reason":"Recurso no frontend ausente do seed relacional: admin.employees.sensitive_data"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.employees.user_link","reason":"Recurso no frontend ausente do seed relacional: admin.employees.user_link"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.guide","reason":"Recurso no frontend ausente do seed relacional: admin.guide"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"admin.settings","reason":"Recurso no frontend ausente do seed relacional: admin.settings"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"commercial.customers","reason":"Recurso no frontend ausente do seed relacional: commercial.customers"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"commercial.pricing","reason":"Recurso no frontend ausente do seed relacional: commercial.pricing"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"commercial.proposals","reason":"Recurso no frontend ausente do seed relacional: commercial.proposals"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"commercial.proposals.indicators","reason":"Recurso no frontend ausente do seed relacional: commercial.proposals.indicators"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"configuracoes","reason":"Recurso no frontend ausente do seed relacional: configuracoes"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering","reason":"Recurso no frontend ausente do seed relacional: engineering"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.products","reason":"Recurso no frontend ausente do seed relacional: engineering.products"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.products.tab.bom","reason":"Recurso no frontend ausente do seed relacional: engineering.products.tab.bom"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.products.tab.composition","reason":"Recurso no frontend ausente do seed relacional: engineering.products.tab.composition"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.products.tab.cost","reason":"Recurso no frontend ausente do seed relacional: engineering.products.tab.cost"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.products.tab.info","reason":"Recurso no frontend ausente do seed relacional: engineering.products.tab.info"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.products.tab.routing","reason":"Recurso no frontend ausente do seed relacional: engineering.products.tab.routing"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.products.tab.tree","reason":"Recurso no frontend ausente do seed relacional: engineering.products.tab.tree"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.projects","reason":"Recurso no frontend ausente do seed relacional: engineering.projects"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.simulations","reason":"Recurso no frontend ausente do seed relacional: engineering.simulations"},
  {"code":"FE_RESOURCE_MISSING_FROM_SEED","subject":"engineering.transformation_simulator","reason":"Recurso no frontend ausente do seed relacional: engineering.transformation_simulator"},
  {"code":"FE_RESOURCE_MISSING_FROM_CONTRACT","subject":"configuracoes","reason":"Recurso no frontend sem ponte no contrato nem no seed: configuracoes"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.auditoria","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.auditoria"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.configuracoes","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.configuracoes"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.confirmadas","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.confirmadas"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.dashboard","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.dashboard"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.liberacao","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.liberacao"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.pagamentos","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.pagamentos"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.pessoas","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.pessoas"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.previstas","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.previstas"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"comissoes.tab.regras","reason":"Recurso no seed sem ponte no contrato: comissoes.tab.regras"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"financeiro.conciliacao_carteira.tab.conciliacao","reason":"Recurso no seed sem ponte no contrato: financeiro.conciliacao_carteira.tab.conciliacao"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"financeiro.conciliacao_carteira.tab.inteligencia","reason":"Recurso no seed sem ponte no contrato: financeiro.conciliacao_carteira.tab.inteligencia"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"suprimentos.inteligencia_mercado.tab.alertas","reason":"Recurso no seed sem ponte no contrato: suprimentos.inteligencia_mercado.tab.alertas"},
  {"code":"SEED_RESOURCE_MISSING_FROM_CONTRACT","subject":"suprimentos.inteligencia_mercado.tab.configuracoes","reason":"Recurso no seed sem ponte no contrato: suprimentos.inteligencia_mercado.tab.configuracoes"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"settings:configuracoes","reason":"Sidebar module settings → configuracoes ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_CONTRACT","subject":"settings:configuracoes","reason":"Sidebar module settings → configuracoes ausente do contrato"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"customers:commercial.customers","reason":"Sidebar module customers → commercial.customers ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"proposals:commercial.proposals","reason":"Sidebar module proposals → commercial.proposals ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"pricing:commercial.pricing","reason":"Sidebar module pricing → commercial.pricing ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"products:engineering.products","reason":"Sidebar module products → engineering.products ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"transformation-simulator:engineering.transformation_simulator","reason":"Sidebar module transformation-simulator → engineering.transformation_simulator ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"simulations:engineering.simulations","reason":"Sidebar module simulations → engineering.simulations ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"projects:engineering.projects","reason":"Sidebar module projects → engineering.projects ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"employees:admin.employees","reason":"Sidebar module employees → admin.employees ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"guide:admin.guide","reason":"Sidebar module guide → admin.guide ausente do seed"},
  {"code":"SIDEBAR_RESOURCE_MISSING_FROM_SEED","subject":"group:engenharia:engineering","reason":"Sidebar group engenharia → engineering ausente do seed"},
  {"code":"SIDEBAR_MODULE_WITHOUT_RESOURCE","subject":"opex","reason":"Módulo sidebar sem resourceKey mapeado: opex"},
  {"code":"PRIVATE_ROUTE_WITHOUT_RESOURCE","subject":"/opex","reason":"Rota de módulo privada sem resourceKey: /opex"},
  {"code":"SIDEBAR_MODULE_WITHOUT_RESOURCE","subject":"taxes","reason":"Módulo sidebar sem resourceKey mapeado: taxes"},
  {"code":"PRIVATE_ROUTE_WITHOUT_RESOURCE","subject":"/taxes","reason":"Rota de módulo privada sem resourceKey: /taxes"},
  {"code":"SIDEBAR_MODULE_WITHOUT_RESOURCE","subject":"reports","reason":"Módulo sidebar sem resourceKey mapeado: reports"},
  {"code":"PRIVATE_ROUTE_WITHOUT_RESOURCE","subject":"/reports","reason":"Rota de módulo privada sem resourceKey: /reports"},
  {"code":"SIDEBAR_MODULE_WITHOUT_RESOURCE","subject":"suppliers","reason":"Módulo sidebar sem resourceKey mapeado: suppliers"},
  {"code":"PRIVATE_ROUTE_WITHOUT_RESOURCE","subject":"/finance/suppliers","reason":"Rota de módulo privada sem resourceKey: /finance/suppliers"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"engineering.projects.detail","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: engineering.projects.detail"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"commercial.crm.activities","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: commercial.crm.activities"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"commercial.crm.assign_seller","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: commercial.crm.assign_seller"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"commercial.sales_orders.detail","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: commercial.sales_orders.detail"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"commercial.sales_orders.invoice","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: commercial.sales_orders.invoice"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"finance.suppliers.service_termination","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: finance.suppliers.service_termination"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"admin.settings.nomus_sync","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: admin.settings.nomus_sync"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"admin.settings.branding","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: admin.settings.branding"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"admin.settings.global_params","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: admin.settings.global_params"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"admin.settings.operational","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: admin.settings.operational"},
  {"code":"RESOURCE_REGISTERED_NEVER_USED","subject":"admin.settings.price_tables","reason":"Recurso no contrato sem uso FE/seed/sidebar detectado: admin.settings.price_tables"},
  {"code":"FE_BE_KEY_MISMATCH","subject":"configuracoes|admin.settings","reason":"Frontend usa resourceKey `configuracoes`; contrato canônico usa `admin.settings`."},
  {"code":"ALIAS_WIDE","subject":"accessProfiles.view","reason":"Alias amplo no FE: accessProfiles.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.audit.view","reason":"Alias amplo no FE: commissions.audit.view → 4 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.dashboard.view","reason":"Alias amplo no FE: commissions.dashboard.view → 4 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.payments.view","reason":"Alias amplo no FE: commissions.payments.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.release.view","reason":"Alias amplo no FE: commissions.release.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.rules.view","reason":"Alias amplo no FE: commissions.rules.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"commissions.view","reason":"Alias amplo no FE: commissions.view → 15 recursos"},
  {"code":"ALIAS_WIDE","subject":"costs.view","reason":"Alias amplo no FE: costs.view → 6 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.general.view","reason":"Alias amplo no FE: crm.general.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.seller.all","reason":"Alias amplo no FE: crm.seller.all → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.seller.own","reason":"Alias amplo no FE: crm.seller.own → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.seller.view","reason":"Alias amplo no FE: crm.seller.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"crm.view","reason":"Alias amplo no FE: crm.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"customers.view","reason":"Alias amplo no FE: customers.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"dashboard.view","reason":"Alias amplo no FE: dashboard.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"employees.edit","reason":"Alias amplo no FE: employees.edit → 7 recursos"},
  {"code":"ALIAS_WIDE","subject":"employees.view","reason":"Alias amplo no FE: employees.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"finance.accountsPayable.view","reason":"Alias amplo no FE: finance.accountsPayable.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"finance.accountsReceivable.view","reason":"Alias amplo no FE: finance.accountsReceivable.view → 2 recursos"},
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
  {"code":"ALIAS_WIDE","subject":"settings.nomus.view","reason":"Alias amplo no FE: settings.nomus.view → 2 recursos"},
  {"code":"ALIAS_WIDE","subject":"settings.view","reason":"Alias amplo no FE: settings.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"simulations.view","reason":"Alias amplo no FE: simulations.view → 3 recursos"},
  {"code":"ALIAS_WIDE","subject":"users.manage","reason":"Alias amplo no FE: users.manage → 5 recursos"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:dashboard.view","reason":"Alias legado em múltiplos recursos do contrato: dashboard.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:products.view","reason":"Alias legado em múltiplos recursos do contrato: products.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:simulations.view","reason":"Alias legado em múltiplos recursos do contrato: simulations.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:costs.view","reason":"Alias legado em múltiplos recursos do contrato: costs.view"},
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
  {"code":"ALIAS_DUPLICATE","subject":"contract:finance.accountsReceivable.view","reason":"Alias legado em múltiplos recursos do contrato: finance.accountsReceivable.view"},
  {"code":"ALIAS_DUPLICATE","subject":"contract:finance.accountsPayable.view","reason":"Alias legado em múltiplos recursos do contrato: finance.accountsPayable.view"},
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
  {"code":"PERMISSIVE_FALLBACK","subject":"resourceNavigationAccess.UNMAPPED_PATH_ALLOW","reason":"resourceNavigationAccess: path sem mapeamento de módulo não bloqueia (unmapped pass-through)."},
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
