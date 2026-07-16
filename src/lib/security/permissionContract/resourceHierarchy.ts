/**
 * PERM-26 — Hierarquia oficial de recursos (MODULE → PAGE → TAB → ACTION).
 *
 * Fonte única: `PERMISSION_CONTRACT_RESOURCES` (mesmo catálogo do contrato).
 * Não cria segundo registro. Persistência/seed ainda pode usar aliases
 * MENU↔MODULE e SUBMENU↔PAGE até cutover do enum Prisma.
 */

import {
  inferPermissionHierarchyType,
  toLegacyResourceStorageType,
  type LegacyPermissionResourceType,
  type PermissionHierarchyType,
} from "./hierarchyTypes.ts";
import { PERMISSION_CONTRACT_RESOURCES } from "./resources.ts";
import {
  getPermissionContractResource,
  listPermissionChildren,
  listSupportedActions,
  toPermissionContractCatalogEntry,
} from "./helpers.ts";
import {
  canPerformPermissionTruth,
  canRevealPermissionNavigation,
  resolvePermissionTruth,
} from "./truthTable.ts";
import type {
  PermissionContractAction,
  PermissionContractResource,
  PermissionTruthSubject,
} from "./types.ts";

export {
  PERMISSION_HIERARCHY_TYPES,
  LEGACY_PERMISSION_RESOURCE_TYPES,
  isPermissionHierarchyType,
  isLegacyPermissionResourceType,
  toOfficialHierarchyType,
  toLegacyResourceStorageType,
  inferPermissionHierarchyType,
  type PermissionHierarchyType,
  type LegacyPermissionResourceType,
} from "./hierarchyTypes.ts";

/** Nó normalizado da hierarquia (visão única sobre o catálogo). */
export type PermissionHierarchyNode = {
  key: string;
  label: string;
  type: PermissionHierarchyType;
  parentKey: string | null;
  route: string | null;
  order: number;
  description: string;
  isActive: boolean;
  /** Ação canônica quando type=ACTION; senão null. */
  associatedAction: PermissionContractAction | null;
  /** Ações suportadas no recurso (CRUD e afins). */
  supportedActions: readonly PermissionContractAction[];
  groupId: string;
  /** Alias legado de persistência (MENU/SUBMENU/…). */
  legacyStorageType: LegacyPermissionResourceType;
};

function buildDescription(resource: PermissionContractResource): string {
  const parts: string[] = [];
  if (resource.notes?.trim()) parts.push(resource.notes.trim());
  if (resource.isDetailScreen) parts.push("Tela de detalhe.");
  if (resource.appearsInSidebar) parts.push("Item de menu lateral.");
  if (resource.isTab) parts.push("Aba interna.");
  if (resource.isInternalAction) parts.push("Ação interna.");
  if (parts.length === 0) {
    parts.push(`Recurso ${inferPermissionHierarchyType(resource).toLowerCase()}.`);
  }
  return parts.join(" ");
}

function inferAssociatedAction(
  resource: PermissionContractResource,
  type: PermissionHierarchyType
): PermissionContractAction | null {
  if (type !== "ACTION") return null;
  const actions = resource.actions.map((a) => a.action);
  if (actions.length === 1) return actions[0]!;
  const nonView = actions.find((a) => a !== "view");
  return nonView ?? actions[0] ?? null;
}

/** Projeta um recurso do contrato para nó de hierarquia oficial. */
export function toPermissionHierarchyNode(
  resource: PermissionContractResource
): PermissionHierarchyNode {
  const type = inferPermissionHierarchyType(resource);
  return {
    key: resource.resourceKey,
    label: resource.label,
    type,
    parentKey: resource.parentKey,
    route: resource.route,
    order: resource.sortOrder,
    description: buildDescription(resource),
    isActive: !resource.deprecated,
    associatedAction: inferAssociatedAction(resource, type),
    supportedActions: resource.actions.map((a) => a.action),
    groupId: resource.groupId,
    legacyStorageType: toLegacyResourceStorageType(type),
  };
}

export function getPermissionHierarchyNode(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionHierarchyNode | null {
  const r = getPermissionContractResource(resourceKey, resources);
  if (!r) return null;
  return toPermissionHierarchyNode(r);
}

/** Árvore plana ordenada (pais antes dos filhos por depth + order). */
export function listPermissionHierarchyNodes(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionHierarchyNode[] {
  const nodes = resources.map(toPermissionHierarchyNode);
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const depth = (key: string, seen = new Set<string>()): number => {
    if (seen.has(key)) return 0;
    seen.add(key);
    const node = byKey.get(key);
    if (!node?.parentKey) return 0;
    return 1 + depth(node.parentKey, seen);
  };
  return [...nodes].sort((a, b) => {
    const d = depth(a.key) - depth(b.key);
    if (d !== 0) return d;
    return a.order - b.order || a.key.localeCompare(b.key);
  });
}

export function listPermissionHierarchyChildren(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionHierarchyNode[] {
  return listPermissionChildren(resourceKey, resources)
    .map((key) => getPermissionHierarchyNode(key, resources))
    .filter((n): n is PermissionHierarchyNode => n != null);
}

// ─── Políticas oficiais (PERM-26) ─────────────────────────────────

/**
 * Pai visível na navegação quando possui ao menos um filho permitido
 * (ou view próprio). Não concede canPerform no pai.
 */
export function isHierarchyParentVisible(
  subject: PermissionTruthSubject,
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  return canRevealPermissionNavigation(subject, resourceKey, resources);
}

/** Recurso desconhecido → DENY. */
export function resolveUnknownResourceDeny(
  subject: PermissionTruthSubject,
  resourceKey: string,
  action: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  return (
    resolvePermissionTruth(subject, resourceKey, action, resources).reason ===
    "UNKNOWN_RESOURCE"
  );
}

/** SUPER_ADMIN mantém bypass (ações suportadas no recurso conhecido). */
export function isHierarchySuperAdminBypass(
  subject: PermissionTruthSubject,
  resourceKey: string,
  action: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  return (
    resolvePermissionTruth(subject, resourceKey, action, resources).reason ===
    "SUPER_ADMIN_BYPASS"
  );
}

/**
 * Acesso a uma aba não concede acesso às demais (irmãs).
 * Verifica que grant em `tabKey` não implica view em `siblingTabKey`.
 */
export function tabGrantDoesNotBleedToSibling(args: {
  subject: PermissionTruthSubject;
  tabKey: string;
  siblingTabKey: string;
  resources?: readonly PermissionContractResource[];
}): boolean {
  const resources = args.resources ?? PERMISSION_CONTRACT_RESOURCES;
  const tab = getPermissionHierarchyNode(args.tabKey, resources);
  const sibling = getPermissionHierarchyNode(args.siblingTabKey, resources);
  if (!tab || tab.type !== "TAB") return false;
  if (!sibling || sibling.type !== "TAB") return false;
  if (tab.parentKey !== sibling.parentKey) return false;
  const canTab = canPerformPermissionTruth(
    args.subject,
    args.tabKey,
    "view",
    resources
  );
  const canSibling = canPerformPermissionTruth(
    args.subject,
    args.siblingTabKey,
    "view",
    resources
  );
  return canTab && !canSibling;
}

/**
 * Acesso à página (view) não concede automaticamente CRUD completo.
 */
export function pageViewDoesNotGrantFullCrud(args: {
  subject: PermissionTruthSubject;
  pageKey: string;
  resources?: readonly PermissionContractResource[];
}): boolean {
  const resources = args.resources ?? PERMISSION_CONTRACT_RESOURCES;
  const page = getPermissionHierarchyNode(args.pageKey, resources);
  if (!page || (page.type !== "PAGE" && page.type !== "MODULE")) return false;
  if (!canPerformPermissionTruth(args.subject, args.pageKey, "view", resources)) {
    return false;
  }
  const mutating = (["create", "update", "delete", "manage"] as const).filter(
    (a) => listSupportedActions(args.pageKey, resources).includes(a)
  );
  if (mutating.length === 0) return true;
  return mutating.every(
    (action) =>
      !canPerformPermissionTruth(args.subject, args.pageKey, action, resources)
  );
}

/** Snapshot documental: entrada de catálogo + hierarquia. */
export function describePermissionHierarchyEntry(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): {
  hierarchy: PermissionHierarchyNode;
  catalog: ReturnType<typeof toPermissionContractCatalogEntry>;
} | null {
  const r = getPermissionContractResource(resourceKey, resources);
  if (!r) return null;
  return {
    hierarchy: toPermissionHierarchyNode(r),
    catalog: toPermissionContractCatalogEntry(r, resources),
  };
}
