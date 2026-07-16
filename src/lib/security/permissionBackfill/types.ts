/**
 * Tipos — backfill P20 (Etapa B): legado intencional → overrides estruturados.
 * Preview obrigatório; apply explícito; sem execução em produção neste prompt.
 */

import type { AppUserRole } from "@prisma/client";

/** Classificação de cada chave legada / grant. */
export type LegacyGrantKind =
  | "role"
  | "profile"
  | "direct_key"
  | "alias_1_1"
  | "mega_key"
  | "bleed"
  | "fallback"
  | "unmapped";

export type LegacyKeyClassification = {
  legacyKey: string;
  kind: LegacyGrantKind;
  /** Pode entrar no apply automático. */
  migratable: boolean;
  canonicalResourceKey?: string;
  note?: string;
};

export type BackfillOverrideRow = {
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
  reason: string;
};

export type BackfillUserSnapshot = {
  userId: string;
  role: AppUserRole;
  legacyPermissions: string[];
  overrides: BackfillOverrideRow[];
};

export type BackfillPendingItem = {
  legacyKey?: string;
  resourceKey?: string;
  kind: LegacyGrantKind | "lockout_risk" | "conflict" | "existing_override";
  reason: string;
};

export type BackfillUserPlan = {
  userId: string;
  subjectRef: string;
  role: AppUserRole;
  scenarioTag?: string | null;
  status:
    | "skipped_super_admin"
    | "skipped_no_legacy_grants"
    | "skipped_idempotent"
    | "ready"
    | "pending_only"
    | "error";
  legacyPermissionCount: number;
  migratableKeyCount: number;
  pendingCount: number;
  classifications: LegacyKeyClassification[];
  pending: BackfillPendingItem[];
  beforeOverrides: BackfillOverrideRow[];
  afterOverrides: BackfillOverrideRow[];
  /** Overrides novos que seriam gravados (delta). */
  deltaOverrides: BackfillOverrideRow[];
  compatible: boolean;
  note: string;
};

export type BackfillRunReport = {
  dryRun: boolean;
  runId: string;
  generatedAt: string;
  batchSize: number;
  subjectCount: number;
  readyCount: number;
  skippedCount: number;
  pendingCount: number;
  appliedCount: number;
  failedCount: number;
  users: BackfillUserPlan[];
  applyResults: BackfillApplyUserResult[];
  snapshotPath: string | null;
  note: string;
};

export type BackfillApplyUserResult = {
  userId: string;
  subjectRef: string;
  applied: boolean;
  unchanged: boolean;
  error?: string;
};

export type BackfillSnapshotFile = {
  runId: string;
  createdAt: string;
  label: string;
  users: BackfillUserSnapshot[];
};

export type BackfillPortUser = BackfillUserSnapshot & {
  accessProfileId?: string | null;
  accessProfilePermissions?: string[];
};

export type BackfillPort = {
  loadUsers(userIds?: string[]): Promise<BackfillPortUser[]>;
  loadUser(userId: string): Promise<BackfillPortUser | null>;
  replaceOverrides(userId: string, overrides: BackfillOverrideRow[]): Promise<void>;
  writeAudit(args: {
    actorUserId: string | null;
    targetUserId: string;
    targetRole: string;
    before: BackfillOverrideRow[];
    after: BackfillOverrideRow[];
    reason: string;
  }): Promise<void>;
  transaction<T>(fn: (port: BackfillPort) => Promise<T>): Promise<T>;
};
