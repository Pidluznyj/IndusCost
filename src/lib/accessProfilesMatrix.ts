/**
 * Bridge Perfis de Acesso ↔ PermissionMatrix (Prompt 09).
 * Perfil permanece snapshot de permissions[]; edição NÃO propaga a usuários.
 * Frontend-safe (sem Prisma / appAuth / userPermissionAdminService).
 */

import type { AppUserRole } from "@/src/lib/appAuthClient";
import { ALL_PERMISSION_KEYS } from "@/src/lib/permissionCatalog";
import { PERMISSION_RESOURCE_SEEDS } from "@/src/lib/permissionResourceSeedData";
import {
  materializeStructuredToLegacy,
  projectLegacyToStructured,
} from "@/src/lib/security/permissionDualWrite/materialize.ts";
import type { StructuredGrantMap } from "@/src/lib/security/permissionDualWrite/types.ts";
import {
  buildPermissionMatrixRowsFromAdminTree,
  draftFromAdminTree,
  formatImpactSummaryHuman,
  isMatrixDraftDirty,
  legacyFlagsFromMatrixDraftValues,
  summarizeMatrixImpact,
  type PermissionMatrixDraft,
  type PermissionMatrixImpactSummary,
  type PermissionMatrixRow,
} from "@/src/lib/security/permissionMatrixUi/index.ts";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";

const CATALOG_SET = new Set(ALL_PERMISSION_KEYS);

export const ACCESS_PROFILE_SNAPSHOT_NOTICE =
  "Perfil é um snapshot. Alterar o perfil não atualiza automaticamente os usuários já vinculados. Use “Aplicar aos usuários” para propagar manualmente.";

export type AccessProfileMatrixModel = {
  tree: EditableTreeNodeDto[];
  rows: PermissionMatrixRow[];
  baseline: PermissionMatrixDraft;
  draft: PermissionMatrixDraft;
  /** Aliases legados do bag atual (para preview). */
  legacyAliases: string[];
  unmappedLegacyKeys: string[];
};

function emptyFlags() {
  return { canView: false, canExecute: false, canManage: false };
}

/** Esqueleto da árvore a partir do seed PT (sem role inheritance). */
function buildEmptySeedTree(): EditableTreeNodeDto[] {
  const nodes = new Map<string, EditableTreeNodeDto>();
  for (const seed of PERMISSION_RESOURCE_SEEDS) {
    nodes.set(seed.key, {
      key: seed.key,
      label: seed.label,
      description: seed.description,
      type: seed.type,
      module: seed.module,
      parentKey: seed.parentKey,
      roleFlags: emptyFlags(),
      override: null,
      effectiveFlags: emptyFlags(),
      children: [],
    });
  }
  const roots: EditableTreeNodeDto[] = [];
  for (const seed of [...PERMISSION_RESOURCE_SEEDS].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)
  )) {
    const node = nodes.get(seed.key)!;
    if (seed.parentKey && nodes.has(seed.parentKey)) {
      nodes.get(seed.parentKey)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Árvore sintética: baseline vazio; efetivo = projeção do bag legado do perfil.
 * roleBase só ajuda na projeção/contexto; o snapshot é permissions[].
 */
export function buildAccessProfileMatrixTree(
  permissions: readonly string[],
  roleBase?: AppUserRole | null | ""
): EditableTreeNodeDto[] {
  const role: AppUserRole =
    roleBase && roleBase !== "" && roleBase !== "SUPER_ADMIN"
      ? roleBase
      : "VIEWER";

  const projected = projectLegacyToStructured({
    role,
    legacyPermissions: permissions,
    // false: evita ganhar aliases de pais no rematerialize (snapshot estável)
    elevateAncestors: false,
  });

  const skeleton = buildEmptySeedTree();
  const walk = (nodes: EditableTreeNodeDto[]) => {
    for (const n of nodes) {
      const flags = projected.projectedFlags[n.key] ?? emptyFlags();
      n.roleFlags = emptyFlags();
      const hasAny = flags.canView || flags.canExecute || flags.canManage;
      n.override = hasAny
        ? {
            canView: flags.canView ? true : null,
            canExecute: flags.canExecute ? true : null,
            canManage: flags.canManage ? true : null,
          }
        : null;
      n.effectiveFlags = { ...flags };
      walk(n.children);
    }
  };
  walk(skeleton);
  return skeleton;
}

/** Mapa resourceKey → flags 3 eixos a partir do bag do perfil. */
export function projectAccessProfileResourceFlags(
  permissions: readonly string[],
  roleBase?: AppUserRole | null | ""
): Record<string, { canView: boolean; canExecute: boolean; canManage: boolean }> {
  const role: AppUserRole =
    roleBase && roleBase !== "" && roleBase !== "SUPER_ADMIN"
      ? roleBase
      : "VIEWER";
  const projected = projectLegacyToStructured({
    role,
    legacyPermissions: permissions,
    elevateAncestors: false,
  });
  return projected.projectedFlags;
}

export function buildAccessProfileMatrixModel(
  permissions: readonly string[],
  roleBase?: AppUserRole | null | ""
): AccessProfileMatrixModel {
  const tree = buildAccessProfileMatrixTree(permissions, roleBase);
  const rows = buildPermissionMatrixRowsFromAdminTree(tree);
  const baseline = draftFromAdminTree(tree);
  const projected = projectLegacyToStructured({
    role:
      roleBase && roleBase !== "" && roleBase !== "SUPER_ADMIN"
        ? roleBase
        : "VIEWER",
    legacyPermissions: permissions,
    elevateAncestors: false,
  });
  return {
    tree,
    rows,
    baseline,
    draft: structuredClone(baseline),
    legacyAliases: [...permissions].filter((k) => CATALOG_SET.has(k)).sort(),
    unmappedLegacyKeys: projected.unmappedLegacyKeys,
  };
}

/** Draft da matriz → bag legado (preserva unmapped do bag anterior). */
export function materializeAccessProfilePermissionsFromDraft(
  draft: PermissionMatrixDraft,
  previousPermissions: readonly string[],
  options?: {
    /**
     * Se true, só emite aliases mapeados que já estavam no bag (load sem edição).
     * Default false no save — permite conceder novas permissões pela matriz.
     */
    compatibleClamp?: boolean;
  }
): string[] {
  const effectiveByResourceKey: StructuredGrantMap = {};
  for (const [resourceKey, values] of Object.entries(draft)) {
    effectiveByResourceKey[resourceKey] =
      legacyFlagsFromMatrixDraftValues(values);
  }
  const result = materializeStructuredToLegacy({
    effectiveByResourceKey,
    previousLegacyPermissions: previousPermissions,
    compatibleMappedClamp: options?.compatibleClamp
      ? previousPermissions
      : undefined,
  });
  return result.legacyPermissions;
}

export function accessProfileMatrixImpact(
  rows: readonly PermissionMatrixRow[],
  draft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): PermissionMatrixImpactSummary {
  return summarizeMatrixImpact(rows, draft, baseline);
}

export function accessProfileMatrixDirty(
  draft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): boolean {
  return isMatrixDraftDirty(draft, baseline);
}

export function formatAccessProfileImpact(
  summary: PermissionMatrixImpactSummary
): string {
  return formatImpactSummaryHuman(summary);
}

/** Diff legado antes/depois (ordenados). */
export function diffLegacyPermissionBags(
  before: readonly string[],
  after: readonly string[]
): { gained: string[]; lost: string[]; unchanged: boolean } {
  const b = new Set(before);
  const a = new Set(after);
  const gained = [...a].filter((k) => !b.has(k)).sort();
  const lost = [...b].filter((k) => !a.has(k)).sort();
  return {
    gained,
    lost,
    unchanged: gained.length === 0 && lost.length === 0,
  };
}

export function needsBroadChangeConfirmation(args: {
  dirtyResourceCount: number;
  linkedUserCount: number;
  gainedCount: number;
  lostCount: number;
}): boolean {
  if (args.linkedUserCount > 0 && (args.gainedCount > 0 || args.lostCount > 0)) {
    return true;
  }
  return args.dirtyResourceCount >= 8 || args.gainedCount + args.lostCount >= 12;
}

/** Round-trip perfil: legado → matriz draft → legado (modo compatível). */
export function roundTripAccessProfilePermissions(
  permissions: readonly string[],
  roleBase?: AppUserRole | null | ""
): {
  after: string[];
  compatible: boolean;
  lost: string[];
  gained: string[];
} {
  const model = buildAccessProfileMatrixModel(permissions, roleBase);
  const after = materializeAccessProfilePermissionsFromDraft(
    model.draft,
    permissions,
    { compatibleClamp: true }
  );
  const diff = diffLegacyPermissionBags(permissions, after);
  // Unmapped do catálogo devem sobreviver; chaves mapeadas podem reordenar.
  const beforeSorted = [...new Set(permissions)].sort();
  const afterSorted = [...after].sort();
  const lost = beforeSorted.filter((k) => !afterSorted.includes(k));
  const gained = afterSorted.filter((k) => !beforeSorted.includes(k));
  return {
    after: afterSorted,
    compatible: lost.length === 0 && gained.length === 0,
    lost,
    gained: diff.gained,
  };
}
