/**
 * Catálogo central de recursos hierárquicos (chaves oficiais PT).
 * Fonte: seed `permissionResourceSeedData` + docs/security/permissions-model-plan.md
 */

import {
  PERMISSION_RESOURCE_SEEDS,
  type PermissionResourceSeed,
} from "@/src/lib/permissionResourceSeedData.js";
import type {
  PermissionResourceNode,
  PermissionResourceType,
} from "@/src/lib/security/permissionTypes.js";

/** Chaves canônicas — evitar strings soltas no backend. */
export const PermissionResourceKeys = {
  DASHBOARD: "dashboard",
  FINANCEIRO: "financeiro",
  FINANCEIRO_CONCILIACAO_CARTEIRA: "financeiro.conciliacao_carteira",
  FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO:
    "financeiro.conciliacao_carteira.tab.conciliacao",
  FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA:
    "financeiro.conciliacao_carteira.tab.inteligencia",
  FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA:
    "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa",
  FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS:
    "financeiro.conciliacao_carteira.tab.status_pedidos",
  FINANCEIRO_CONTAS_RECEBER: "financeiro.contas_receber",
  FINANCEIRO_CONTAS_PAGAR: "financeiro.contas_pagar",
  FINANCEIRO_FLUXO_CAIXA: "financeiro.fluxo_caixa",
  FINANCEIRO_RELATORIO_PRESIDENCIAL: "financeiro.relatorio_presidencial",
  COMERCIAL: "comercial",
  COMERCIAL_PEDIDOS_VENDA: "comercial.pedidos_venda",
  COMERCIAL_CRM: "comercial.crm",
  COMERCIAL_CRM_TAB_GESTAO_GERAL: "comercial.crm.tab.gestao_geral",
  COMERCIAL_CRM_TAB_GESTAO_VENDEDOR: "comercial.crm.tab.gestao_vendedor",
  COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES: "comercial.crm.tab.carteira_clientes",
  COMERCIAL_CRM_TAB_CLIENTE_360: "comercial.crm.tab.cliente_360",
  COMISSOES: "comissoes",
  COMISSOES_TAB_FECHAMENTO_MES: "comissoes.tab.fechamento_mes",
  COMISSOES_TAB_FECHAMENTOS: "comissoes.tab.fechamentos",
  COMISSOES_TAB_EXCECOES_CLIENTE: "comissoes.tab.excecoes_cliente",
  COMISSOES_TAB_RELATORIOS: "comissoes.tab.relatorios",
  COMISSOES_TAB_REPROCESSAR: "comissoes.tab.reprocessar",
  COMISSOES_TAB_DASHBOARD: "comissoes.tab.dashboard",
  COMISSOES_TAB_PREVISTAS: "comissoes.tab.previstas",
  COMISSOES_TAB_CONFIRMADAS: "comissoes.tab.confirmadas",
  COMISSOES_TAB_LIBERACAO: "comissoes.tab.liberacao",
  COMISSOES_TAB_PAGAMENTOS: "comissoes.tab.pagamentos",
  COMISSOES_TAB_PESSOAS: "comissoes.tab.pessoas",
  COMISSOES_TAB_REGRAS: "comissoes.tab.regras",
  COMISSOES_TAB_AUDITORIA: "comissoes.tab.auditoria",
  COMISSOES_TAB_CONFIGURACOES: "comissoes.tab.configuracoes",
  OPERATIONS: "operations",
  OPERATIONS_INVENTORY: "operations.inventory",
  OPERATIONS_INVENTORY_ITEMS: "operations.inventory.items",
  OPERATIONS_INVENTORY_WAREHOUSES: "operations.inventory.warehouses",
  OPERATIONS_INVENTORY_MOVEMENTS: "operations.inventory.movements",
  OPERATIONS_INVENTORY_COUNTS: "operations.inventory.counts",
  OPERATIONS_PURCHASES: "operations.purchases",
  OPERATIONS_MACHINES: "operations.machines",
  OPERATIONS_PERFORMANCE: "operations.performance",
  OPERATIONS_MAINTENANCE: "operations.maintenance",
  OPERATIONS_FLEET: "operations.fleet",
  SUPRIMENTOS: "suprimentos",
  SUPRIMENTOS_TAB_CATALOGO: "suprimentos.tab.catalogo",
  SUPRIMENTOS_INTELIGENCIA_MERCADO: "suprimentos.inteligencia_mercado",
  SUPRIMENTOS_MI_TAB_HOME: "suprimentos.inteligencia_mercado.tab.home",
  SUPRIMENTOS_MI_TAB_MATERIA_PRIMA_360: "suprimentos.inteligencia_mercado.tab.materia_prima_360",
  SUPRIMENTOS_MI_TAB_FORNECEDORES: "suprimentos.inteligencia_mercado.tab.fornecedores",
  SUPRIMENTOS_MI_TAB_ALERTAS: "suprimentos.inteligencia_mercado.tab.alertas",
  SUPRIMENTOS_MI_TAB_CONFIGURACOES: "suprimentos.inteligencia_mercado.tab.configuracoes",
  ADMIN: "admin",
  ADMIN_USUARIOS: "admin.usuarios",
  ADMIN_PERMISSOES: "admin.permissoes",
  ADMIN_PERMISSOES_ACTION_MANAGE: "admin.permissoes.action.manage",
} as const;

export type PermissionResourceKey =
  (typeof PermissionResourceKeys)[keyof typeof PermissionResourceKeys];

export const PORTFOLIO_RECONCILIATION_TAB_KEYS = [
  PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
  PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
  PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
  PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS,
] as const;

function seedToNode(seed: PermissionResourceSeed): PermissionResourceNode {
  return {
    key: seed.key,
    label: seed.label,
    description: seed.description,
    type: seed.type as PermissionResourceType,
    parentKey: seed.parentKey,
    module: seed.module,
    sortOrder: seed.sortOrder,
    isSystem: seed.isSystem,
    isActive: true,
  };
}

/** Catálogo em memória (sempre disponível; DB é overlay opcional no loader). */
export function getPermissionCatalog(
  resources?: readonly PermissionResourceNode[]
): PermissionResourceNode[] {
  if (resources && resources.length > 0) {
    return [...resources].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)
    );
  }
  return PERMISSION_RESOURCE_SEEDS.map(seedToNode).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)
  );
}

export function getPermissionCatalogMap(
  resources?: readonly PermissionResourceNode[]
): Map<string, PermissionResourceNode> {
  return new Map(getPermissionCatalog(resources).map((r) => [r.key, r]));
}

export function isKnownPermissionResourceKey(
  resourceKey: string,
  resources?: readonly PermissionResourceNode[]
): boolean {
  return getPermissionCatalogMap(resources).has(resourceKey);
}

export function listAncestorKeys(
  resourceKey: string,
  resources?: readonly PermissionResourceNode[]
): string[] {
  const byKey = getPermissionCatalogMap(resources);
  const ancestors: string[] = [];
  let current = byKey.get(resourceKey)?.parentKey ?? null;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    ancestors.push(current);
    current = byKey.get(current)?.parentKey ?? null;
  }
  return ancestors;
}

export function listChildResources(
  parentResourceKey: string,
  type?: PermissionResourceType,
  resources?: readonly PermissionResourceNode[]
): PermissionResourceNode[] {
  return getPermissionCatalog(resources).filter(
    (r) =>
      r.parentKey === parentResourceKey && (type ? r.type === type : true)
  );
}
