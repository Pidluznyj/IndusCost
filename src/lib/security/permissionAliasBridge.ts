/**
 * Ponte PT legado ↔ resourceKey canônico para admin de permissões.
 * Garante que baseline, overrides e resumo usem a mesma identidade efetiva
 * que o resolvedor de runtime (relationalResourceKeys).
 */

import type { AppUserRole } from "@prisma/client";
import {
  getOfficialRolePermissionFlags,
  type RolePermissionFlags,
} from "@/src/lib/permissionResourceSeedData.js";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/index.js";
import type { PermissionFlags } from "@/src/lib/security/permissionTypes.js";

const EMPTY: PermissionFlags = {
  canView: false,
  canExecute: false,
  canManage: false,
};

function emptyFlags(): PermissionFlags {
  return { ...EMPTY };
}

function orFlags(a: PermissionFlags, b: PermissionFlags): PermissionFlags {
  return {
    canView: a.canView || b.canView,
    canExecute: a.canExecute || b.canExecute,
    canManage: a.canManage || b.canManage,
  };
}

/**
 * Chaves equivalentes a `resourceKey` para projeção de flags/overrides.
 *
 * - Canônico → ele + seus `relationalResourceKeys`
 * - Alias legado → ele + o canônico (NÃO inclui aliases irmãos)
 *
 * Evita clique falso (ex.: `admin.usuarios` ≉ `admin.permissoes.action.manage`
 * só porque ambos estão em `admin.settings.security.relationalResourceKeys`).
 */
export function listEquivalentPermissionKeys(resourceKey: string): string[] {
  const key = resourceKey.trim();
  if (!key) return [];
  const keys = new Set<string>([key]);
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    const rels = (r.relationalResourceKeys ?? [])
      .map((rel) => rel.trim())
      .filter(Boolean);
    if (r.resourceKey === key) {
      for (const rel of rels) keys.add(rel);
      continue;
    }
    if (rels.includes(key)) {
      keys.add(r.resourceKey);
    }
  }
  return [...keys].sort();
}

/** Aliases distintos da chave (projeção de flags / resolve de override). */
export function listPermissionAliasKeys(resourceKey: string): string[] {
  return listEquivalentPermissionKeys(resourceKey).filter((k) => k !== resourceKey);
}

/**
 * Dual-write só em pares 1:1 (ex.: commercial ↔ comercial).
 * Bundles multi-alias (admin.settings.security → 3 PT) não expandem —
 * evita bleed de override entre irmãos.
 */
export function listDualWriteAliasKeys(resourceKey: string): string[] {
  const key = resourceKey.trim();
  if (!key) return [];
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    const rels = (r.relationalResourceKeys ?? [])
      .map((rel) => rel.trim())
      .filter(Boolean);
    if (r.resourceKey === key) {
      return rels.length === 1 ? [rels[0]!] : [];
    }
    if (rels.includes(key)) {
      return rels.length === 1 ? [r.resourceKey] : [];
    }
  }
  return [];
}

/**
 * Flags oficiais da role projetadas pela ponte PT↔canônico
 * (mesmo critério de `buildRoleBaselineFromSeed`).
 */
export function getBridgedOfficialRolePermissionFlags(
  role: AppUserRole,
  resourceKey: string
): RolePermissionFlags {
  if (role === "SUPER_ADMIN") {
    return { canView: true, canExecute: true, canManage: true };
  }
  let merged = emptyFlags();
  for (const key of listEquivalentPermissionKeys(resourceKey)) {
    merged = orFlags(merged, getOfficialRolePermissionFlags(role, key));
  }
  return merged;
}

type AxisOverride = {
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
};

/**
 * Resolve override efetivo para uma chave: considera aliases e DENY vence ALLOW.
 */
export function resolveBridgedOverride(
  overrides: readonly AxisOverride[],
  resourceKey: string
): AxisOverride | null {
  const equivalents = new Set(listEquivalentPermissionKeys(resourceKey));
  const matches = overrides.filter((o) => equivalents.has(o.resourceKey));
  if (matches.length === 0) return null;

  const pick = (axis: "canView" | "canExecute" | "canManage"): boolean | null => {
    let sawAllow = false;
    let sawNull = false;
    for (const m of matches) {
      const v = m[axis];
      if (v === false) return false;
      if (v === true) sawAllow = true;
      if (v === null || v === undefined) sawNull = true;
    }
    if (sawAllow) return true;
    if (sawNull) return null;
    return null;
  };

  return {
    resourceKey,
    canView: pick("canView"),
    canExecute: pick("canExecute"),
    canManage: pick("canManage"),
  };
}

/**
 * Lê flags de um mapa considerando aliases (OR).
 * Se nenhum alias existir no mapa, retorna `fallback`.
 */
export function projectBridgedFlagsFromMap(
  flagsByKey: Readonly<Record<string, PermissionFlags>>,
  resourceKey: string,
  fallback: PermissionFlags = EMPTY
): PermissionFlags {
  let merged = emptyFlags();
  let sawAny = false;
  for (const key of listEquivalentPermissionKeys(resourceKey)) {
    const f = flagsByKey[key];
    if (!f) continue;
    sawAny = true;
    merged = orFlags(merged, f);
  }
  return sawAny ? merged : { ...fallback };
}

/** Expande overrides para dual-write 1:1 (PT ↔ canônico). */
export function expandOverridesToAliases<T extends AxisOverride>(
  overrides: readonly T[]
): T[] {
  const byKey = new Map<string, T>();
  const mergeAxis = (a: boolean | null, b: boolean | null): boolean | null => {
    if (a === false || b === false) return false;
    if (a === true || b === true) return true;
    return null;
  };
  const put = (key: string, ov: T) => {
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...ov, resourceKey: key });
      return;
    }
    byKey.set(key, {
      ...prev,
      resourceKey: key,
      canView: mergeAxis(prev.canView, ov.canView),
      canExecute: mergeAxis(prev.canExecute, ov.canExecute),
      canManage: mergeAxis(prev.canManage, ov.canManage),
    });
  };
  for (const ov of overrides) {
    put(ov.resourceKey, ov);
    for (const alias of listDualWriteAliasKeys(ov.resourceKey)) {
      put(alias, ov);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.resourceKey.localeCompare(b.resourceKey)
  );
}
