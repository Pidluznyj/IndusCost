/**
 * Helpers puros do contrato tipado (P01).
 * Validação estrutural de recursos, ações, hierarquia, aliases e mega-keys.
 * Não conecta ao runtime de autorização.
 */

import {
  detectCrossResourceLegacyKeys,
  isHardMegaKey,
  isKnownMegaOrBleedKey,
  listPermissionMegaKeyRecords,
} from "./megaKeys.ts";
import { PERMISSION_CONTRACT_RESOURCES } from "./resources.ts";
import type {
  PermissionAliasMigrationStatus,
  PermissionContractAction,
  PermissionContractCatalogEntry,
  PermissionContractLegacyAlias,
  PermissionContractResource,
  PermissionContractUiMetadata,
  PermissionResourceMigrationStatus,
} from "./types.ts";
import { PERMISSION_CONTRACT_ACTIONS } from "./types.ts";

function byKeyMap(
  resources: readonly PermissionContractResource[]
): Map<string, PermissionContractResource> {
  return new Map(resources.map((r) => [r.resourceKey, r]));
}

/** Recurso existe no contrato? */
export function isKnownPermissionResource(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  return resources.some((r) => r.resourceKey === resourceKey);
}

/** Ação canônica conhecida? */
export function isKnownPermissionAction(action: string): action is PermissionContractAction {
  return (PERMISSION_CONTRACT_ACTIONS as readonly string[]).includes(action);
}

export function getPermissionContractResource(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionContractResource | undefined {
  return resources.find((r) => r.resourceKey === resourceKey);
}

/** Parent direto (null = raiz). Undefined se recurso inexistente. */
export function getPermissionParentKey(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string | null | undefined {
  const r = getPermissionContractResource(resourceKey, resources);
  if (!r) return undefined;
  return r.parentKey;
}

/** Ancestrais do mais próximo ao root (pai → … → raiz). */
export function listPermissionAncestors(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string[] {
  const map = byKeyMap(resources);
  if (!map.has(resourceKey)) return [];
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let current = map.get(resourceKey)?.parentKey ?? null;
  while (current) {
    if (seen.has(current)) break; // ciclo — interrompe
    seen.add(current);
    ancestors.push(current);
    current = map.get(current)?.parentKey ?? null;
  }
  return ancestors;
}

/** Filhos diretos. */
export function listPermissionChildren(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string[] {
  return resources
    .filter((r) => r.parentKey === resourceKey)
    .map((r) => r.resourceKey)
    .sort((a, b) => {
      const ra = getPermissionContractResource(a, resources)!;
      const rb = getPermissionContractResource(b, resources)!;
      return ra.sortOrder - rb.sortOrder || a.localeCompare(b);
    });
}

/** Todos os descendentes (DFS). */
export function listPermissionDescendants(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string[] {
  const out: string[] = [];
  const stack = listPermissionChildren(resourceKey, resources);
  while (stack.length) {
    const key = stack.pop()!;
    out.push(key);
    for (const child of listPermissionChildren(key, resources)) {
      stack.push(child);
    }
  }
  return out;
}

/** Detecta ciclo na cadeia de parents a partir de resourceKey. */
export function hasPermissionParentCycle(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  const map = byKeyMap(resources);
  if (!map.has(resourceKey)) return false;
  const seen = new Set<string>();
  let current: string | null = resourceKey;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = map.get(current)?.parentKey ?? null;
  }
  return false;
}

/** Qualquer ciclo no grafo de parents. */
export function listPermissionParentCycles(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string[] {
  return resources
    .filter((r) => hasPermissionParentCycle(r.resourceKey, resources))
    .map((r) => r.resourceKey)
    .sort();
}

/** Ações suportadas pelo recurso. */
export function listSupportedActions(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionContractAction[] {
  const r = getPermissionContractResource(resourceKey, resources);
  if (!r) return [];
  return r.actions.map((a) => a.action);
}

export function supportsPermissionAction(
  resourceKey: string,
  action: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  if (!isKnownPermissionAction(action)) return false;
  return listSupportedActions(resourceKey, resources).includes(action);
}

export function isDeprecatedPermissionResource(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  return Boolean(getPermissionContractResource(resourceKey, resources)?.deprecated);
}

export function listDeprecatedPermissionResources(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string[] {
  return resources.filter((r) => r.deprecated).map((r) => r.resourceKey).sort();
}

export function listReplacementKeys(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): readonly string[] {
  return getPermissionContractResource(resourceKey, resources)?.replacementKeys ?? [];
}

/** Classifica um alias legado no contexto de um resourceKey × action. */
export function classifyLegacyAliasStatus(
  legacyKey: string,
  resourceKey: string,
  indexInBinding: number,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionAliasMigrationStatus {
  if (isHardMegaKey(legacyKey)) return "mega_key_temporary";

  const cross = detectCrossResourceLegacyKeys(resources);
  const owners = cross.get(legacyKey) ?? [];

  if (owners.length >= 2) {
    if (isKnownMegaOrBleedKey(legacyKey) || owners.length >= 3) {
      return legacyKey === "finance.accountsPayable.view"
        ? "cross_resource_bleed_temporary"
        : "mega_key_temporary";
    }
    // 2 recursos: bleed se a chave “parece” dedicada a um recurso
    if (indexInBinding > 0) return "cross_resource_bleed_temporary";
    return "cross_resource_bleed_temporary";
  }

  // Uso único no contrato
  if (isKnownMegaOrBleedKey(legacyKey) && indexInBinding > 0) {
    return "cross_resource_bleed_temporary";
  }

  // finance.view / reports.view mesmo em um só recurso no contrato ainda são amplas
  if (
    legacyKey === "finance.view" ||
    legacyKey === "reports.view" ||
    legacyKey === "settings.view"
  ) {
    // Canônica só no próprio parent finance / admin.settings quando index 0
    if (
      (legacyKey === "finance.view" && resourceKey === "finance" && indexInBinding === 0) ||
      (legacyKey === "settings.view" &&
        resourceKey.startsWith("admin") &&
        indexInBinding === 0)
    ) {
      return "canonical_1_1";
    }
    return indexInBinding === 0 && resourceKey === "finance"
      ? "canonical_1_1"
      : "mega_key_temporary";
  }

  // Preferencial no binding e único owner → 1:1
  if (indexInBinding === 0) return "canonical_1_1";
  return "cross_resource_bleed_temporary";
}

export function listLegacyAliasesForResource(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionContractLegacyAlias[] {
  const r = getPermissionContractResource(resourceKey, resources);
  if (!r) return [];
  const out: PermissionContractLegacyAlias[] = [];
  for (const binding of r.actions) {
    binding.legacyPermissionKeys.forEach((legacyKey, index) => {
      out.push({
        action: binding.action,
        legacyKey,
        index,
        aliasStatus: classifyLegacyAliasStatus(legacyKey, resourceKey, index, resources),
      });
    });
  }
  return out;
}

export function listPermissionMegaKeys() {
  return listPermissionMegaKeyRecords();
}

function resolveMigrationStatus(
  r: PermissionContractResource
): PermissionResourceMigrationStatus {
  if (r.migrationStatus) return r.migrationStatus;
  if (r.deprecated) return "deprecated";
  return "active";
}

function toUiMetadata(r: PermissionContractResource): PermissionContractUiMetadata {
  return {
    route: r.route,
    appearsInSidebar: r.appearsInSidebar,
    isTab: r.isTab,
    isInternalAction: r.isInternalAction,
    isDetailScreen: r.isDetailScreen,
    relatedEndpoints: r.relatedEndpoints,
    moduleId: r.moduleId ?? null,
    relationalResourceKeys: r.relationalResourceKeys,
  };
}

/** Normaliza um recurso na forma tipada definitiva. */
export function toPermissionContractCatalogEntry(
  r: PermissionContractResource,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionContractCatalogEntry {
  return {
    resourceKey: r.resourceKey,
    label: r.label,
    group: r.groupId,
    parentKey: r.parentKey,
    order: r.sortOrder,
    supportedActions: r.actions.map((a) => a.action),
    sensitivity: r.sensitivity,
    metadata: toUiMetadata(r),
    legacyAliases: listLegacyAliasesForResource(r.resourceKey, resources),
    deprecated: Boolean(r.deprecated),
    replacementKeys: r.replacementKeys ?? [],
    migrationStatus: resolveMigrationStatus(r),
    notes: r.notes,
  };
}

/** Catálogo tipado completo (única visão normalizada). */
export function buildPermissionContractCatalog(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionContractCatalogEntry[] {
  return resources.map((r) => toPermissionContractCatalogEntry(r, resources));
}

export function getPermissionContractCatalogEntry(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionContractCatalogEntry | undefined {
  const r = getPermissionContractResource(resourceKey, resources);
  if (!r) return undefined;
  return toPermissionContractCatalogEntry(r, resources);
}

/**
 * Valida parent: existe e não forma ciclo consigo mesmo.
 * Retorna mensagem de erro ou null se ok.
 */
export function validatePermissionParentLink(
  resourceKey: string,
  parentKey: string | null,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string | null {
  if (parentKey == null) return null;
  if (parentKey === resourceKey) return "parentKey não pode ser o próprio resourceKey";
  if (!isKnownPermissionResource(parentKey, resources)) {
    return `parent inexistente: ${parentKey}`;
  }
  const probe: PermissionContractResource[] = resources.map((r) =>
    r.resourceKey === resourceKey ? { ...r, parentKey } : r
  );
  if (hasPermissionParentCycle(resourceKey, probe)) {
    return `ciclo introduzido por parent ${parentKey}`;
  }
  return null;
}

/** Alias 1:1 canônico preferencial para resource × action (primeiro não-mega se possível). */
export function getCanonicalLegacyAlias(
  resourceKey: string,
  action: PermissionContractAction,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string | null {
  const aliases = listLegacyAliasesForResource(resourceKey, resources).filter(
    (a) => a.action === action
  );
  const oneToOne = aliases.find((a) => a.aliasStatus === "canonical_1_1");
  if (oneToOne) return oneToOne.legacyKey;
  return aliases[0]?.legacyKey ?? null;
}
