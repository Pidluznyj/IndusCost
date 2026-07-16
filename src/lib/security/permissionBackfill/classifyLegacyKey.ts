/**
 * Classificação de chaves legadas para backfill (Etapa B).
 * Bleed / mega-key / fallback nunca são promovidos automaticamente.
 */

import { ALL_PERMISSION_KEYS } from "@/src/lib/permissionCatalog.js";
import {
  isHardMegaKey,
  isKnownMegaOrBleedKey,
} from "@/src/lib/security/permissionContract/index.js";
import { isLegacyBleedGrant } from "@/src/lib/security/accessComparison/bleedDetection.ts";
import {
  getDualWriteAliasIndex,
  type DualWriteAliasIndex,
} from "@/src/lib/security/permissionDualWrite/aliasIndex.ts";
import { MEGA_KEY_MIGRATION_MAP } from "@/src/lib/security/permissionMegaKeyMigration.js";
import type { LegacyGrantKind, LegacyKeyClassification } from "./types.ts";

const CATALOG = new Set(ALL_PERMISSION_KEYS);

function migrationEntry(legacyKey: string) {
  return MEGA_KEY_MIGRATION_MAP.find((e) => e.legacyKey === legacyKey);
}

/**
 * Classifica uma chave da bag `AppUser.permissions[]`.
 */
export function classifyLegacyPermissionKey(
  legacyKey: string,
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): LegacyKeyClassification {
  const key = legacyKey.trim();
  if (!key) {
    return { legacyKey: key, kind: "unmapped", migratable: false, note: "empty" };
  }

  const migration = migrationEntry(key);
  const canonical = index.canonicalByLegacy.get(key);
  const legacyBindings = index.byLegacy.get(key) ?? [];

  if (isHardMegaKey(key)) {
    return {
      legacyKey: key,
      kind: "mega_key",
      migratable: false,
      canonicalResourceKey: canonical?.resourceKey,
      note: "PERMISSION_HARD_MEGA_KEYS — revisão manual; não expandir cross-module",
    };
  }

  if (migration?.mode === "canonical_1_1" && canonical) {
    return {
      legacyKey: key,
      kind: "alias_1_1",
      migratable: true,
      canonicalResourceKey: canonical.resourceKey,
      note: migration.notes,
    };
  }

  if (migration?.mode === "removed_bleed") {
    return {
      legacyKey: key,
      kind: "bleed",
      migratable: false,
      note: migration.notes,
    };
  }

  if (isKnownMegaOrBleedKey(key) && !canonical) {
    return {
      legacyKey: key,
      kind: "mega_key",
      migratable: false,
      note: "mega/bleed conhecido sem owner 1:1 no índice dual-write",
    };
  }

  if (isKnownMegaOrBleedKey(key) && canonical) {
    return {
      legacyKey: key,
      kind: "mega_key",
      migratable: false,
      canonicalResourceKey: canonical.resourceKey,
      note: "mega-key com alvo canônico único — pendente aprovação manual (não auto-apply)",
    };
  }

  if (!canonical) {
    const kind: LegacyGrantKind = CATALOG.has(key) ? "unmapped" : "unmapped";
    return {
      legacyKey: key,
      kind,
      migratable: false,
      note: CATALOG.has(key)
        ? "catálogo sem alias estrutural 1:1"
        : "fora do catálogo",
    };
  }

  if (legacyBindings.length > 1) {
    const bleedTargets = legacyBindings.filter((b) =>
      isLegacyBleedGrant(key, b.resourceKey, "view")
    );
    if (bleedTargets.length > 0 && bleedTargets.length === legacyBindings.length - 1) {
      // Owner canônico existe; demais são bleed
    } else if (legacyBindings.length > 1) {
      const others = legacyBindings.filter((b) => b.resourceKey !== canonical.resourceKey);
      if (others.length > 0) {
        return {
          legacyKey: key,
          kind: "bleed",
          migratable: false,
          canonicalResourceKey: canonical.resourceKey,
          note: `alias multi-recurso (${legacyBindings.length} owners); só canônico ${canonical.resourceKey} é inequívoco — pendente`,
        };
      }
    }
  }

  if (
    migration &&
    migration.mode !== "canonical_1_1" &&
    migration.legacyLayer !== "none"
  ) {
    return {
      legacyKey: key,
      kind: "mega_key",
      migratable: false,
      canonicalResourceKey: canonical.resourceKey,
      note: migration.removalTarget,
    };
  }

  return {
    legacyKey: key,
    kind: "alias_1_1",
    migratable: true,
    canonicalResourceKey: canonical.resourceKey,
    note: "projeção 1:1 canônica",
  };
}

/** Classifica chaves de perfil (AccessProfile.permissions[]) — nunca auto-migrar como override. */
export function classifyProfilePermissionKeys(
  keys: readonly string[]
): LegacyKeyClassification[] {
  return keys.map((k) => ({
    legacyKey: k,
    kind: "profile" as const,
    migratable: false,
    note: "grant de perfil — usar snapshot de perfil, não backfill de bag",
  }));
}

/** Baseline de role — não promover via backfill de bag. */
export function classifyRoleBaselineNote(role: string): LegacyKeyClassification {
  return {
    legacyKey: `role:${role}`,
    kind: "role",
    migratable: false,
    note: "baseline da role — não materializar via backfill de bag",
  };
}

export function listMigratableLegacyKeys(
  legacyPermissions: readonly string[],
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): { migratable: string[]; classifications: LegacyKeyClassification[] } {
  const classifications = legacyPermissions.map((k) =>
    classifyLegacyPermissionKey(k, index)
  );
  const migratable = classifications.filter((c) => c.migratable).map((c) => c.legacyKey);
  return { migratable, classifications };
}
