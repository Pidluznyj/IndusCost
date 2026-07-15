/**
 * Seed hierárquico do catálogo persistido a partir do contrato canônico (Prompt 05).
 * Não altera navegação, AppUser.permissions, RolePermission nem overrides.
 */

import type { PermissionResourceType } from "@prisma/client";

export type CatalogSeedSource = "canonical_contract" | "legacy_pt_seed";

export type CatalogSeedResourceRow = {
  key: string;
  label: string;
  description: string;
  type: PermissionResourceType;
  parentKey: string | null;
  module: string;
  sortOrder: number;
  isSystem: true;
  isActive: boolean;
  source: CatalogSeedSource;
  /** Aliases legados (PERMISSION_CATALOG) — persistidos só no plano/auditoria; não há coluna DB. */
  legacyAliasKeys: readonly string[];
  /** Chaves PT do seed antigo que esta linha canônica cobre (bridge). */
  relationalBridgeKeys: readonly string[];
  /** Se true, linha é legado PT a preservar (não deletar). */
  legacyRetain: boolean;
  /** Marcação auditável de obsoleto UI / superseded. */
  obsoleteTag: string | null;
};

export type CatalogSeedExistingRow = {
  key: string;
  label: string;
  description: string | null;
  type: PermissionResourceType;
  parentKey: string | null;
  module: string;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
};

export type CatalogSeedChangeKind = "create" | "update" | "unchanged" | "retain_legacy_only";

export type CatalogSeedChange = {
  kind: CatalogSeedChangeKind;
  key: string;
  before?: CatalogSeedExistingRow;
  after: CatalogSeedResourceRow;
  changedFields?: string[];
};

export type CatalogSeedPlan = {
  generatedAt: string;
  rows: CatalogSeedResourceRow[];
  issues: { code: string; message: string }[];
  aliasIndex: Record<string, string[]>; // legacyAlias → resourceKeys
};

export type CatalogSeedDiffReport = {
  dryRun: boolean;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  retainLegacyCount: number;
  changes: CatalogSeedChange[];
  issues: { code: string; message: string }[];
  note: string;
};

/** Porta mínima para testes sem Prisma real. */
export type PermissionCatalogSeedPort = {
  listResources(): Promise<CatalogSeedExistingRow[]>;
  createResource(row: CatalogSeedResourceRow): Promise<void>;
  updateResource(key: string, row: CatalogSeedResourceRow): Promise<void>;
  /** Opcional: auditoria. */
  writeAudit?(action: string, payload: unknown): Promise<void>;
  /** Transação opcional. */
  transaction?<T>(fn: (port: PermissionCatalogSeedPort) => Promise<T>): Promise<T>;
};
