/**
 * Reordena a árvore de permissões para espelhar o menu lateral.
 *
 * Só apresentação: cada nó mantém `id` e `resourceKey`, nenhum recurso é
 * criado ou removido e a herança de runtime continua vindo do catálogo
 * canônico (ver `mapPermissionTreeEffectives` sobre a árvore original).
 *
 * Grupos da sidebar sem recurso próprio (ex.: "Cadeia de Suprimentos") entram
 * como seções estruturais — `resourceKey` vazio, sem decisão individual.
 */

import type { AppModuleId } from "@/src/lib/modulePermissions.js";
import {
  buildGroupedNavigationStructure,
  type NavigationGroupedItem,
  type NavigationGroupId,
} from "@/src/lib/navigationGroups.js";
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/index.js";
import type { PermissionTreeNode } from "@/src/lib/security/permissionsTreeUi/index.ts";

/** Prefixo dos nós de seção (grupo da sidebar sem recurso 1:1 no catálogo). */
export const SIDEBAR_SECTION_NODE_PREFIX = "sidebar-section:";

export function sidebarSectionNodeId(groupId: string): string {
  return `${SIDEBAR_SECTION_NODE_PREFIX}${groupId}`;
}

/** Alias legado (PT) → chave canônica do contrato. */
const CANONICAL_BY_LEGACY_KEY: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const resource of PERMISSION_CONTRACT_RESOURCES) {
    for (const alias of resource.relationalResourceKeys ?? []) {
      const key = alias.trim();
      if (!key || key === resource.resourceKey || map.has(key)) continue;
      map.set(key, resource.resourceKey);
    }
  }
  return map;
})();

/** AppModuleId → recurso do contrato que aparece na sidebar. */
const SIDEBAR_RESOURCE_KEY_BY_MODULE_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const resource of PERMISSION_CONTRACT_RESOURCES) {
    const moduleId = resource.moduleId?.trim();
    if (!moduleId || !resource.appearsInSidebar || map.has(moduleId)) continue;
    map.set(moduleId, resource.resourceKey);
  }
  return map;
})();

type TreeIndexEntry = {
  node: PermissionTreeNode;
  /** Filhos que são ações do próprio recurso (mesma resourceKey). */
  actions: PermissionTreeNode[];
  /** resourceKeys dos filhos que são outros recursos, na ordem do catálogo. */
  childKeys: string[];
};

function indexTreeByResourceKey(
  nodes: readonly PermissionTreeNode[]
): Map<string, TreeIndexEntry> {
  const index = new Map<string, TreeIndexEntry>();

  const visit = (node: PermissionTreeNode) => {
    const actions: PermissionTreeNode[] = [];
    const childKeys: string[] = [];
    for (const child of node.children ?? []) {
      if (child.resourceKey === node.resourceKey) {
        actions.push(child);
        continue;
      }
      childKeys.push(child.resourceKey);
      visit(child);
    }
    if (node.resourceKey && !index.has(node.resourceKey)) {
      index.set(node.resourceKey, { node, actions, childKeys });
    }
  };

  for (const node of nodes) visit(node);
  return index;
}

function resolveModuleResourceKey(
  moduleId: AppModuleId,
  index: ReadonlyMap<string, TreeIndexEntry>
): string | null {
  const candidates: string[] = [];
  const mapped = resolveSidebarModuleResourceKey(moduleId);
  if (mapped) {
    candidates.push(mapped);
    const canonical = CANONICAL_BY_LEGACY_KEY.get(mapped);
    if (canonical) candidates.push(canonical);
  }
  const byModuleId = SIDEBAR_RESOURCE_KEY_BY_MODULE_ID.get(moduleId);
  if (byModuleId) candidates.push(byModuleId);

  for (const key of candidates) {
    if (index.has(key)) return key;
  }
  return null;
}

export type SidebarPermissionTreeLayout = {
  nodes: PermissionTreeNode[];
  /** Itens do menu sem recurso correspondente na árvore (auditoria). */
  unresolvedModuleIds: AppModuleId[];
  /** Raízes do catálogo que nenhum grupo do menu reivindicou (auditoria). */
  orphanResourceKeys: string[];
};

/**
 * Monta a árvore no arranjo do menu lateral:
 * itens diretos (Dashboard, Objetivos e Metas) → grupos na ordem da sidebar →
 * itens de cada grupo na ordem da sidebar → abas/detalhes/ações do catálogo.
 */
export function buildSidebarPermissionTreeLayout(
  nodes: readonly PermissionTreeNode[]
): SidebarPermissionTreeLayout {
  const index = indexTreeByResourceKey(nodes);
  if (index.size === 0) {
    return { nodes: [], unresolvedModuleIds: [], orphanResourceKeys: [] };
  }

  const structure = buildGroupedNavigationStructure();
  const groups = [
    ...structure.groups,
    ...(structure.fallbackGroup ? [structure.fallbackGroup] : []),
  ];

  // Passo 1 — resolve todos os itens do menu antes de montar: o filtro de
  // "já reivindicado por outro item" precisa da lista completa.
  const claimed = new Set<string>();
  const keyByModuleId = new Map<AppModuleId, string>();
  const unresolvedModuleIds: AppModuleId[] = [];
  const allItems: NavigationGroupedItem[] = [
    ...structure.directItems,
    ...groups.flatMap((group) => group.items),
  ];

  for (const item of allItems) {
    const key = resolveModuleResourceKey(item.itemId, index);
    if (!key) {
      unresolvedModuleIds.push(item.itemId);
      continue;
    }
    // Itens que compartilham o mesmo recurso (ex.: Organograma ↔ Pessoas / RH)
    // aparecem uma vez só — duas linhas para a mesma chave dividiriam a decisão.
    if (claimed.has(key)) continue;
    claimed.add(key);
    keyByModuleId.set(item.itemId, key);
  }

  // Passo 2 — grupos com raiz própria no catálogo (Engenharia, Comercial,
  // Operações, Administração). "Financeiro" e "Gestão de pessoas" viram seção
  // estrutural porque a chave do grupo já pertence a um item do menu.
  const rootKeys = new Set(nodes.map((node) => node.resourceKey));
  const groupKeyByGroupId = new Map<NavigationGroupId, string>();
  for (const group of groups) {
    const mapped = group.resourceKey;
    if (!mapped) continue;
    const key = index.has(mapped)
      ? mapped
      : (CANONICAL_BY_LEGACY_KEY.get(mapped) ?? null);
    if (!key || !index.has(key) || !rootKeys.has(key) || claimed.has(key)) continue;
    claimed.add(key);
    groupKeyByGroupId.set(group.id, key);
  }

  // Passo 3 — monta os nós.
  const placed = new Set<string>();

  const buildResourceNode = (
    key: string,
    label?: string
  ): PermissionTreeNode | null => {
    const entry = index.get(key);
    if (!entry || placed.has(key)) return null;
    placed.add(key);

    const children: PermissionTreeNode[] = [];
    for (const childKey of entry.childKeys) {
      // Filho que também é item do menu aparece na própria posição da sidebar.
      if (claimed.has(childKey)) continue;
      const child = buildResourceNode(childKey);
      if (child) children.push(child);
    }

    return {
      ...entry.node,
      label: label?.trim() ? label : entry.node.label,
      children: [...entry.actions, ...children],
    };
  };

  const buildItemNodes = (items: readonly NavigationGroupedItem[]) => {
    const out: PermissionTreeNode[] = [];
    for (const item of items) {
      const key = keyByModuleId.get(item.itemId);
      if (!key) continue;
      const node = buildResourceNode(key, item.label);
      if (node) out.push(node);
    }
    return out;
  };

  const out: PermissionTreeNode[] = [...buildItemNodes(structure.directItems)];

  for (const group of groups) {
    const items = buildItemNodes(group.items);
    const ownKey = groupKeyByGroupId.get(group.id);

    if (!ownKey) {
      if (items.length === 0) continue;
      out.push({
        id: sidebarSectionNodeId(group.id),
        resourceKey: "",
        label: group.label,
        kind: "module",
        originLabel: "",
        baselineEffective: "inherited",
        children: items,
      });
      continue;
    }

    const entry = index.get(ownKey);
    if (!entry) continue;
    placed.add(ownKey);
    const leftovers: PermissionTreeNode[] = [];
    for (const childKey of entry.childKeys) {
      if (claimed.has(childKey)) continue;
      const child = buildResourceNode(childKey);
      if (child) leftovers.push(child);
    }
    out.push({
      ...entry.node,
      label: group.label,
      children: [...entry.actions, ...items, ...leftovers],
    });
  }

  // Passo 4 — nada some: raiz do catálogo fora do mapa da sidebar entra no fim,
  // no formato original.
  const orphanResourceKeys: string[] = [];
  for (const node of nodes) {
    if (placed.has(node.resourceKey)) continue;
    const orphan = buildResourceNode(node.resourceKey);
    if (!orphan) continue;
    orphanResourceKeys.push(node.resourceKey);
    out.push(orphan);
  }

  return { nodes: out, unresolvedModuleIds, orphanResourceKeys };
}

/** Atalho para uso na UI. */
export function arrangePermissionTreeBySidebar(
  nodes: readonly PermissionTreeNode[]
): PermissionTreeNode[] {
  return buildSidebarPermissionTreeLayout(nodes).nodes;
}
