/**
 * Constrói o plano de PermissionResource a partir do contrato + seed PT legado.
 */

import type { PermissionResourceType } from "@prisma/client";
import {
  PERMISSION_CONTRACT_RESOURCES,
  validatePermissionContract,
} from "@/src/lib/security/permissionContract/index.js";
import {
  PERMISSION_RESOURCE_SEEDS,
  sortPermissionResourcesForInsert,
  validatePermissionResourceCatalog,
} from "@/src/lib/permissionResourceSeedData.js";
import type { CatalogSeedPlan, CatalogSeedResourceRow } from "./types.ts";

function inferType(args: {
  parentKey: string | null;
  isTab: boolean;
  isInternalAction: boolean;
}): PermissionResourceType {
  if (args.isInternalAction) return "ACTION";
  if (args.isTab) return "TAB";
  if (args.parentKey == null) return "MENU";
  return "SUBMENU";
}

function buildCanonicalDescription(row: {
  notes?: string;
  sensitivity: string;
  legacyAliasKeys: readonly string[];
  relationalBridgeKeys: readonly string[];
}): string {
  const parts = [
    "[canonical]",
    `sensitivity=${row.sensitivity}`,
  ];
  if (row.notes?.trim()) parts.push(row.notes.trim());
  if (row.legacyAliasKeys.length) {
    parts.push(`legacyAliases=${row.legacyAliasKeys.join(",")}`);
  }
  if (row.relationalBridgeKeys.length) {
    parts.push(`bridges=${row.relationalBridgeKeys.join(",")}`);
  }
  return parts.join(" | ");
}

function buildLegacyDescription(args: {
  original: string;
  bridgedBy: string[];
  obsoleteTag: string | null;
}): string {
  const parts = ["[legacy_pt_seed]", args.original];
  if (args.bridgedBy.length) {
    parts.push(`superseded_by_canonical=${args.bridgedBy.join(",")}`);
  }
  if (args.obsoleteTag) parts.push(args.obsoleteTag);
  return parts.join(" | ");
}

/** Mapa resourceKey canônico → bridges PT. */
function bridgeOwners(): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    for (const rel of r.relationalResourceKeys) {
      const list = owners.get(rel) ?? [];
      list.push(r.resourceKey);
      owners.set(rel, list);
    }
  }
  return owners;
}

/**
 * Plano completo: canônicos do contrato + legado PT preservado (sem delete).
 * Aliases ficam no plano; DB não tem coluna de alias.
 */
export function buildPermissionCatalogSeedPlan(): CatalogSeedPlan {
  const issues: { code: string; message: string }[] = [];

  for (const issue of validatePermissionContract()) {
    issues.push({ code: `CONTRACT_${issue.code}`, message: issue.message });
  }
  for (const issue of validatePermissionResourceCatalog()) {
    issues.push({ code: `LEGACY_SEED_${issue.code}`, message: issue.message });
  }

  const bridgeByPt = bridgeOwners();
  const rows: CatalogSeedResourceRow[] = [];
  const aliasIndex: Record<string, string[]> = {};

  // 1) Canonical from contract
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    const legacyAliasKeys = [
      ...new Set(r.actions.flatMap((a) => [...a.legacyPermissionKeys])),
    ].sort();
    const relationalBridgeKeys = [...r.relationalResourceKeys];
    const type = inferType({
      parentKey: r.parentKey,
      isTab: r.isTab,
      isInternalAction: r.isInternalAction,
    });

    // Action fantasma: ACTION sem aliases reais
    if (type === "ACTION" && legacyAliasKeys.length === 0) {
      issues.push({
        code: "PHANTOM_ACTION",
        message: `ACTION sem legacy aliases: ${r.resourceKey}`,
      });
    }

    const row: CatalogSeedResourceRow = {
      key: r.resourceKey,
      label: r.label,
      description: buildCanonicalDescription({
        notes: r.notes,
        sensitivity: r.sensitivity,
        legacyAliasKeys,
        relationalBridgeKeys,
      }),
      type,
      parentKey: r.parentKey,
      module: r.groupId,
      sortOrder: r.sortOrder,
      isSystem: true,
      isActive: true,
      source: "canonical_contract",
      legacyAliasKeys,
      relationalBridgeKeys,
      legacyRetain: false,
      obsoleteTag: null,
    };
    rows.push(row);

    for (const alias of legacyAliasKeys) {
      const owners = aliasIndex[alias] ?? [];
      owners.push(r.resourceKey);
      aliasIndex[alias] = owners;
    }
  }

  // 2) Legacy PT seed rows (retain; never delete)
  // Abas com UI oculta documentadas no auditor → obsolete tag
  const obsoleteUiKeys = new Set([
    "comissoes.tab.dashboard",
    "comissoes.tab.previstas",
    "comissoes.tab.confirmadas",
    "comissoes.tab.liberacao",
    "comissoes.tab.pagamentos",
    "comissoes.tab.pessoas",
    "comissoes.tab.regras",
    "comissoes.tab.auditoria",
    "comissoes.tab.configuracoes",
    "financeiro.conciliacao_carteira.tab.conciliacao",
    "financeiro.conciliacao_carteira.tab.inteligencia",
  ]);

  const canonicalKeys = new Set(rows.map((r) => r.key));
  for (const seed of PERMISSION_RESOURCE_SEEDS) {
    if (canonicalKeys.has(seed.key)) {
      // Mesma chave (ex.: dashboard, admin): enriquecer canônico com aliases PT, sem duplicar.
      const canonical = rows.find((r) => r.key === seed.key)!;
      const mergedAliases = [
        ...new Set([...canonical.legacyAliasKeys, ...seed.legacyAliasKeys]),
      ].sort();
      canonical.legacyAliasKeys = mergedAliases;
      canonical.relationalBridgeKeys = [
        ...new Set([...canonical.relationalBridgeKeys, seed.key]),
      ];
      canonical.description = buildCanonicalDescription({
        notes: `${canonical.description} | also_legacy_pt_seed`,
        sensitivity: "merged",
        legacyAliasKeys: mergedAliases,
        relationalBridgeKeys: canonical.relationalBridgeKeys,
      });
      for (const alias of seed.legacyAliasKeys) {
        const owners = aliasIndex[alias] ?? [];
        if (!owners.includes(seed.key) && !owners.includes(canonical.key)) {
          owners.push(canonical.key);
        }
        aliasIndex[alias] = owners;
      }
      continue;
    }
    const bridgedBy = bridgeByPt.get(seed.key) ?? [];
    const obsoleteTag = obsoleteUiKeys.has(seed.key)
      ? "[obsolete_ui]"
      : bridgedBy.length
        ? "[bridged_legacy]"
        : null;

    rows.push({
      key: seed.key,
      label: seed.label,
      description: buildLegacyDescription({
        original: seed.description,
        bridgedBy,
        obsoleteTag,
      }),
      type: seed.type,
      parentKey: seed.parentKey,
      module: seed.module,
      sortOrder: seed.sortOrder + 10_000, // legado após canônicos na mesma profundidade
      isSystem: true,
      isActive: true, // não desativar — UI/guards ainda usam
      source: "legacy_pt_seed",
      legacyAliasKeys: seed.legacyAliasKeys,
      relationalBridgeKeys: bridgedBy,
      legacyRetain: true,
      obsoleteTag,
    });

    for (const alias of seed.legacyAliasKeys) {
      const owners = aliasIndex[alias] ?? [];
      owners.push(seed.key);
      aliasIndex[alias] = owners;
    }
  }

  // Alias uniqueness: mesmo alias em múltiplos resources é esperado (OR); flag se >3
  for (const [alias, owners] of Object.entries(aliasIndex)) {
    if (owners.length > 4) {
      issues.push({
        code: "ALIAS_HIGH_FANOUT",
        message: `${alias} → ${owners.length} resources`,
      });
    }
  }

  // Parents exist within plan
  const keySet = new Set(rows.map((r) => r.key));
  for (const row of rows) {
    if (row.parentKey && !keySet.has(row.parentKey)) {
      issues.push({
        code: "MISSING_PARENT",
        message: `${row.key} → ${row.parentKey}`,
      });
    }
  }

  const sorted = sortCatalogSeedRows(rows);

  return {
    generatedAt: new Date().toISOString(),
    rows: sorted,
    issues,
    aliasIndex,
  };
}

export function sortCatalogSeedRows(
  rows: readonly CatalogSeedResourceRow[]
): CatalogSeedResourceRow[] {
  return sortPermissionResourcesForInsert(
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      description: r.description,
      type: r.type,
      parentKey: r.parentKey,
      module: r.module,
      sortOrder: r.sortOrder,
      isSystem: true as const,
      legacyAliasKeys: [...r.legacyAliasKeys],
    }))
  ).map((seed) => rows.find((r) => r.key === seed.key)!);
}

export function assertCatalogSeedPlanReady(plan: CatalogSeedPlan): void {
  const blocking = plan.issues.filter((i) =>
    ["MISSING_PARENT", "PHANTOM_ACTION", "CONTRACT_DUPLICATE_RESOURCE_KEY", "CONTRACT_CYCLE"].some(
      (c) => i.code === c || i.code.startsWith(c)
    )
  );
  if (blocking.length > 0) {
    throw new Error(
      `Plano de seed inválido: ${blocking.map((i) => `${i.code}:${i.message}`).join("; ")}`
    );
  }
}
