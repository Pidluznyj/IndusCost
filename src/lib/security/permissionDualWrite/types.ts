/**
 * Dual-write estruturado ↔ legado (Prompt 06).
 * Sincronização controlada sem loops; acesso efetivo continua via AppUser.permissions[].
 */

import type { AppUserRole } from "@prisma/client";
import type { PermissionFlags } from "@/src/lib/security/permissionTypes.js";

export type DualWriteDirection = "structured_to_legacy" | "legacy_to_structured";

export type DualWriteAliasBinding = {
  resourceKey: string;
  legacyKey: string;
  axis: "view" | "execute" | "manage";
};

export type StructuredGrantMap = Record<string, PermissionFlags>;

export type MaterializeToLegacyInput = {
  effectiveByResourceKey: StructuredGrantMap;
  /** Bag legado atual — chaves sem mapeamento são preservadas. */
  previousLegacyPermissions?: readonly string[];
  /** Se false (default), não inclui chaves fora do PERMISSION_CATALOG. */
  preserveOutsideCatalog?: boolean;
  /**
   * Modo compatível: só emite aliases mapeados que já estavam neste conjunto
   * (evita ganho por colisão / ancestral). Unmapped do previous ainda são preservados.
   */
  compatibleMappedClamp?: readonly string[];
};

export type MaterializeToLegacyResult = {
  legacyPermissions: string[];
  mappedLegacyKeys: string[];
  preservedUnmappedKeys: string[];
  droppedOutsideCatalogKeys: string[];
  unmappedReport: DualWriteUnmappedEntry[];
};

export type ProjectFromLegacyInput = {
  role: AppUserRole;
  legacyPermissions: readonly string[];
  userId?: string;
};

export type ProjectFromLegacyResult = {
  /** Flags por resourceKey derivadas só de aliases (sem role seed). */
  projectedFlags: StructuredGrantMap;
  /** Overrides style grants (null = não setado no eixo). */
  projectedOverrides: Array<{
    resourceKey: string;
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
    reason: string;
  }>;
  mappedLegacyKeys: string[];
  unmappedLegacyKeys: string[];
  unmappedReport: DualWriteUnmappedEntry[];
};

export type DualWriteUnmappedEntry = {
  key: string;
  reason:
    | "no_structural_alias"
    | "outside_catalog"
    | "alias_without_resource_flag"
    | "round_trip_asymmetry";
  detail?: string;
};

export type DualWritePlan = {
  direction: DualWriteDirection;
  dryRun: boolean;
  beforeLegacy: string[];
  afterLegacy: string[];
  beforeStructured: StructuredGrantMap;
  afterStructured: StructuredGrantMap;
  gainedLegacy: string[];
  lostLegacy: string[];
  preservedUnmapped: string[];
  unmappedReport: DualWriteUnmappedEntry[];
  compatible: boolean;
  unchanged: boolean;
  note: string;
};

export type DualWriteApplyResult = DualWritePlan & {
  applied: boolean;
};
