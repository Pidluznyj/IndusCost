/**
 * Tipos e classificação pura da hierarquia oficial (PERM-26).
 * Sem imports de helpers/truthTable — evita ciclo no grafo do contrato.
 */

import type { PermissionContractResource } from "./types.ts";

/** Tipos oficiais da hierarquia (PERM-26). */
export const PERMISSION_HIERARCHY_TYPES = [
  "MODULE",
  "PAGE",
  "TAB",
  "ACTION",
] as const;

export type PermissionHierarchyType =
  (typeof PERMISSION_HIERARCHY_TYPES)[number];

/**
 * Tipos persistidos no seed/Prisma hoje (`PermissionResourceType`).
 * Aliases oficiais: MENU→MODULE, SUBMENU→PAGE.
 */
export const LEGACY_PERMISSION_RESOURCE_TYPES = [
  "MENU",
  "SUBMENU",
  "TAB",
  "ACTION",
] as const;

export type LegacyPermissionResourceType =
  (typeof LEGACY_PERMISSION_RESOURCE_TYPES)[number];

const HIERARCHY_TYPE_SET = new Set<string>(PERMISSION_HIERARCHY_TYPES);
const LEGACY_TYPE_SET = new Set<string>(LEGACY_PERMISSION_RESOURCE_TYPES);

export function isPermissionHierarchyType(
  value: string
): value is PermissionHierarchyType {
  return HIERARCHY_TYPE_SET.has(value);
}

export function isLegacyPermissionResourceType(
  value: string
): value is LegacyPermissionResourceType {
  return LEGACY_TYPE_SET.has(value);
}

/** MENU→MODULE, SUBMENU→PAGE; TAB/ACTION idênticos. */
export function toOfficialHierarchyType(
  type: string
): PermissionHierarchyType | null {
  if (type === "MENU") return "MODULE";
  if (type === "SUBMENU") return "PAGE";
  if (isPermissionHierarchyType(type)) return type;
  return null;
}

/** MODULE→MENU, PAGE→SUBMENU para seed/Prisma atuais. */
export function toLegacyResourceStorageType(
  type: PermissionHierarchyType
): LegacyPermissionResourceType {
  if (type === "MODULE") return "MENU";
  if (type === "PAGE") return "SUBMENU";
  return type;
}

/**
 * Classifica um recurso do contrato na hierarquia oficial.
 *
 * Regras (ordem):
 * 1. `isInternalAction` → ACTION
 * 2. `isTab` → TAB
 * 3. `parentKey == null` → MODULE (grupo / raiz)
 * 4. demais (sidebar, seção, detail) → PAGE
 */
export function inferPermissionHierarchyType(
  resource: PermissionContractResource
): PermissionHierarchyType {
  if (resource.isInternalAction) return "ACTION";
  if (resource.isTab) return "TAB";
  if (resource.parentKey == null) return "MODULE";
  return "PAGE";
}
