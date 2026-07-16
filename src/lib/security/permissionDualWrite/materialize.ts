/**
 * Materialização estruturado ↔ legado (P06).
 * Estruturado = fonte; bag = materialização temporária.
 * Aliases de emissão/projeção padrão = 1:1 canônicos (mega-keys permanecem no runtime).
 */

import type { PermissionFlags } from "@/src/lib/security/permissionTypes.js";
import {
  flagAllowsAlias,
  getDualWriteAliasIndex,
  type DualWriteAliasIndex,
} from "./aliasIndex.ts";
import type {
  DualWriteUnmappedEntry,
  MaterializeToLegacyInput,
  MaterializeToLegacyResult,
  ProjectFromLegacyInput,
  ProjectFromLegacyResult,
  StructuredGrantMap,
} from "./types.ts";

function sortUnique(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort();
}

function emptyFlags(): PermissionFlags {
  return { canView: false, canExecute: false, canManage: false };
}

/**
 * Grants estruturados → bag legado.
 * - Deny / flags falsas: não emite o alias 1:1 correspondente (remove da bag mapeada).
 * - Preserva chaves de catálogo sem alias estrutural (relatório separado).
 * - Fora do catálogo: drop default; opcional preserveOutsideCatalog.
 */
export function materializeStructuredToLegacy(
  input: MaterializeToLegacyInput,
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): MaterializeToLegacyResult {
  const oneToOne = input.oneToOneAliases !== false;
  const mapped = new Set<string>();
  const unmappedReport: DualWriteUnmappedEntry[] = [];

  if (oneToOne) {
    for (const [legacyKey, binding] of index.canonicalByLegacy) {
      const flags =
        input.effectiveByResourceKey[binding.resourceKey] ?? emptyFlags();
      if (flagAllowsAlias(flags, binding.axis)) {
        mapped.add(legacyKey);
      }
    }
  } else {
    for (const [resourceKey, flags] of Object.entries(input.effectiveByResourceKey)) {
      const bindings = index.byResource.get(resourceKey) ?? [];
      if (bindings.length === 0) {
        unmappedReport.push({
          key: resourceKey,
          reason: "alias_without_resource_flag",
          detail: "resource sem legacyAliasKeys no índice",
        });
        continue;
      }
      for (const b of bindings) {
        if (flagAllowsAlias(flags, b.axis)) {
          mapped.add(b.legacyKey);
        }
      }
    }
  }

  // Recursos do mapa sem binding 1:1 (somente relatório)
  if (oneToOne) {
    for (const resourceKey of Object.keys(input.effectiveByResourceKey)) {
      if ((index.oneToOneByResource.get(resourceKey) ?? []).length > 0) continue;
      if ((index.byResource.get(resourceKey) ?? []).length === 0) {
        unmappedReport.push({
          key: resourceKey,
          reason: "alias_without_resource_flag",
          detail: "resource sem legacyAliasKeys no índice",
        });
      }
    }
  }

  const previous = input.previousLegacyPermissions ?? [];
  const preservedUnmapped: string[] = [];
  const droppedOutsideCatalog: string[] = [];
  const preserveOutside = input.preserveOutsideCatalog === true;

  for (const raw of previous) {
    const key = raw.trim();
    if (!key) continue;
    if (index.mappedLegacyKeys.has(key)) {
      // mapeada: structured decide (deny remove)
      continue;
    }
    if (!index.catalogKeys.has(key)) {
      if (preserveOutside) {
        preservedUnmapped.push(key);
        unmappedReport.push({ key, reason: "outside_catalog" });
      } else {
        droppedOutsideCatalog.push(key);
        unmappedReport.push({ key, reason: "outside_catalog", detail: "dropped" });
      }
      continue;
    }
    preservedUnmapped.push(key);
    unmappedReport.push({ key, reason: "no_structural_alias" });
  }

  let mappedKeys = [...mapped];
  if (input.compatibleMappedClamp) {
    const clamp = new Set(
      [...input.compatibleMappedClamp].map((k) => k.trim()).filter(Boolean)
    );
    mappedKeys = mappedKeys.filter((k) => clamp.has(k));
  }

  const legacyPermissions = sortUnique([...mappedKeys, ...preservedUnmapped]);

  return {
    legacyPermissions,
    mappedLegacyKeys: sortUnique(mappedKeys),
    preservedUnmappedKeys: sortUnique(preservedUnmapped),
    droppedOutsideCatalogKeys: sortUnique(droppedOutsideCatalog),
    unmappedReport,
  };
}

/**
 * Legado → flags estruturadas (projeção). Não escreve DB.
 * Com 1:1 (default), cada chave legada mapeia só ao recurso canônico.
 */
export function projectLegacyToStructured(
  input: ProjectFromLegacyInput & {
    elevateAncestors?: boolean;
    oneToOneAliases?: boolean;
  },
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): ProjectFromLegacyResult {
  void input.role;
  const oneToOne = input.oneToOneAliases !== false;
  const projectedFlags: StructuredGrantMap = {};
  const mappedLegacyKeys: string[] = [];
  const unmappedLegacyKeys: string[] = [];
  const unmappedReport: DualWriteUnmappedEntry[] = [];
  const shouldElevate = input.elevateAncestors !== false;

  const ensure = (resourceKey: string): PermissionFlags => {
    if (!projectedFlags[resourceKey]) {
      projectedFlags[resourceKey] = emptyFlags();
    }
    return projectedFlags[resourceKey];
  };

  const elevateAncestors = (resourceKey: string) => {
    let parent = index.parentByResource.get(resourceKey) ?? null;
    while (parent) {
      ensure(parent).canView = true;
      parent = index.parentByResource.get(parent) ?? null;
    }
  };

  for (const raw of input.legacyPermissions) {
    const key = raw.trim();
    if (!key) continue;

    if (oneToOne) {
      const binding = index.canonicalByLegacy.get(key);
      if (!binding) {
        unmappedLegacyKeys.push(key);
        unmappedReport.push({
          key,
          reason: index.catalogKeys.has(key) ? "no_structural_alias" : "outside_catalog",
        });
        continue;
      }
      mappedLegacyKeys.push(key);
      const flags = ensure(binding.resourceKey);
      flags.canView = true;
      if (binding.axis === "execute") flags.canExecute = true;
      if (binding.axis === "manage") flags.canManage = true;
      if (shouldElevate) elevateAncestors(binding.resourceKey);
      continue;
    }

    const bindings = index.byLegacy.get(key);
    if (!bindings || bindings.length === 0) {
      unmappedLegacyKeys.push(key);
      unmappedReport.push({
        key,
        reason: index.catalogKeys.has(key) ? "no_structural_alias" : "outside_catalog",
      });
      continue;
    }
    mappedLegacyKeys.push(key);
    for (const b of bindings) {
      const flags = ensure(b.resourceKey);
      flags.canView = true;
      if (b.axis === "execute") flags.canExecute = true;
      if (b.axis === "manage") flags.canManage = true;
      if (shouldElevate) elevateAncestors(b.resourceKey);
    }
  }

  const projectedOverrides = Object.entries(projectedFlags).map(([resourceKey, f]) => ({
    resourceKey,
    canView: f.canView ? true : null,
    canExecute: f.canExecute ? true : null,
    canManage: f.canManage ? true : null,
    reason: "legacy-alias",
  }));

  return {
    projectedFlags,
    projectedOverrides,
    mappedLegacyKeys: sortUnique(mappedLegacyKeys),
    unmappedLegacyKeys: sortUnique(unmappedLegacyKeys),
    unmappedReport,
  };
}

/** Round-trip structured → legacy → structured (somente chaves mapeadas 1:1). */
export function roundTripStructured(
  flags: StructuredGrantMap,
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): {
  legacy: string[];
  back: StructuredGrantMap;
  compatible: boolean;
  asymmetries: DualWriteUnmappedEntry[];
} {
  const toLegacy = materializeStructuredToLegacy(
    { effectiveByResourceKey: flags, previousLegacyPermissions: [] },
    index
  );
  const back = projectLegacyToStructured(
    {
      role: "VIEWER",
      legacyPermissions: toLegacy.legacyPermissions,
      elevateAncestors: false,
    },
    index
  );

  const asymmetries: DualWriteUnmappedEntry[] = [];
  for (const [key, before] of Object.entries(flags)) {
    const after = back.projectedFlags[key] ?? emptyFlags();
    const bindings = index.oneToOneByResource.get(key) ?? [];
    const hasManageAlias = bindings.some((b) => b.axis === "manage");
    const hasExecuteAlias = bindings.some((b) => b.axis === "execute");
    const hasViewAlias = bindings.some((b) => b.axis === "view");

    if (before.canManage && hasManageAlias && !after.canManage) {
      asymmetries.push({ key, reason: "round_trip_asymmetry", detail: "lost canManage" });
    }
    if (
      before.canExecute &&
      hasExecuteAlias &&
      !(after.canExecute || after.canManage)
    ) {
      asymmetries.push({ key, reason: "round_trip_asymmetry", detail: "lost canExecute" });
    }
    if (before.canView && hasViewAlias && !after.canView) {
      asymmetries.push({ key, reason: "round_trip_asymmetry", detail: "lost canView" });
    }
  }

  return {
    legacy: toLegacy.legacyPermissions,
    back: back.projectedFlags,
    compatible: asymmetries.length === 0,
    asymmetries,
  };
}

/**
 * Round-trip legacy → structured → legacy preservando unmapped.
 */
export function roundTripLegacy(
  legacy: readonly string[],
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): {
  structured: StructuredGrantMap;
  backLegacy: string[];
  compatible: boolean;
  lostMapped: string[];
  gainedMapped: string[];
  preservedUnmapped: string[];
} {
  const projected = projectLegacyToStructured(
    { role: "VIEWER", legacyPermissions: legacy, elevateAncestors: false },
    index
  );
  const back = materializeStructuredToLegacy(
    {
      effectiveByResourceKey: projected.projectedFlags,
      previousLegacyPermissions: legacy,
      compatibleMappedClamp: legacy,
    },
    index
  );

  const beforeSorted = sortUnique(legacy);
  const afterSet = new Set(back.legacyPermissions);
  const beforeSet = new Set(beforeSorted);
  const lostMapped = beforeSorted.filter(
    (k) => index.mappedLegacyKeys.has(k) && !afterSet.has(k)
  );
  const gainedMapped = back.legacyPermissions.filter(
    (k) => index.mappedLegacyKeys.has(k) && !beforeSet.has(k)
  );
  const lostUnmapped = beforeSorted.filter(
    (k) => !index.mappedLegacyKeys.has(k) && index.catalogKeys.has(k) && !afterSet.has(k)
  );

  return {
    structured: projected.projectedFlags,
    backLegacy: back.legacyPermissions,
    compatible: lostMapped.length === 0 && gainedMapped.length === 0 && lostUnmapped.length === 0,
    lostMapped,
    gainedMapped,
    preservedUnmapped: back.preservedUnmappedKeys,
  };
}
