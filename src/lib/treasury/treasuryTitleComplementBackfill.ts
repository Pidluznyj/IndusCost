/**
 * Backfill de TreasuryTitleOperationalComplement a partir de títulos oficiais Nomus.
 * Lógica pura (sem I/O): CLI, classificação, preview, checkpoint e lotes.
 * Nunca muta NomusAccounts* nem apaga complementos existentes.
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { normalizeTreasuryMoneyString } from "./treasuryMoney.js";

export const TREASURY_TITLE_COMPLEMENT_BACKFILL_DEFAULT_BATCH_SIZE = 200;
export const TREASURY_TITLE_COMPLEMENT_BACKFILL_HARD_MAX_BATCH = 1000;
export const TREASURY_TITLE_COMPLEMENT_BACKFILL_NOTES =
  "backfill:treasury-title-complements" as const;
export const TREASURY_TITLE_COMPLEMENT_BACKFILL_CHECKPOINT_ENV =
  "TREASURY_TITLE_COMPLEMENT_BACKFILL_CHECKPOINT_FILE" as const;
export const TREASURY_TITLE_COMPLEMENT_BACKFILL_USER_ENV =
  "TREASURY_BACKFILL_CREATED_BY_USER_ID" as const;

export type TreasuryTitleComplementBackfillMode = "preview" | "apply";
export type TreasuryTitleComplementBackfillTitleType =
  | "RECEIVABLE"
  | "PAYABLE"
  | "ALL";

export type TreasuryTitleComplementBackfillAction =
  | "CREATE"
  | "SKIP_EXISTING_COMPLEMENT"
  | "SKIP_EXISTING_CANCELLED_COMPLEMENT"
  | "SKIP_CANCELLED_OFFICIAL"
  | "SKIP_SETTLED"
  | "SKIP_INCONSISTENT_NO_DATE"
  | "SKIP_INCONSISTENT_EXTERNAL_MISMATCH"
  | "SKIP_DUPLICATE_EXTERNAL";

export type TreasuryTitleComplementBackfillCliOptions = {
  mode: TreasuryTitleComplementBackfillMode;
  titleType: TreasuryTitleComplementBackfillTitleType;
  from: string | null;
  to: string | null;
  batchSize: number;
  createdByUserId: string | null;
  checkpointFile: string | null;
  resume: boolean;
  openOnly: boolean;
  limit: number | null;
  json: boolean;
};

export type TreasuryOfficialTitleBackfillSeed = {
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  officialExternalId: number;
  dueDate: Date | string | null;
  scheduleDate?: Date | string | null;
  openBalance: string | null;
  status: boolean | null;
  sourcePresenceStatus: string;
  sourceRemovedAt: Date | string | null;
};

export type TreasuryComplementBackfillExisting = {
  id: string;
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  officialExternalId: number;
  cancelledAt: Date | string | null;
};

export type TreasuryTitleComplementCreateSeed = {
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  officialExternalId: number;
  expectedDate: string | null;
  scheduledDate: string | null;
  expectedAmount: string | null;
  scheduledAmount: string | null;
  status: "ACTIVE";
  priority: "NORMAL";
  notes: typeof TREASURY_TITLE_COMPLEMENT_BACKFILL_NOTES;
  createdByUserId: string;
};

export type TreasuryTitleComplementBackfillItem = {
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  officialExternalId: number;
  action: TreasuryTitleComplementBackfillAction;
  needsWrite: boolean;
  reasons: string[];
  create: TreasuryTitleComplementCreateSeed | null;
  openBalance: string | null;
  expectedDate: string | null;
};

export type TreasuryTitleComplementBackfillCounters = {
  titlesFound: number;
  eligible: number;
  existingComplements: number;
  existingCancelledComplements: number;
  wouldCreate: number;
  created: number;
  skippedSettled: number;
  skippedCancelledOfficial: number;
  inconsistencies: number;
  duplicates: number;
  errors: number;
};

export type TreasuryTitleComplementBackfillCheckpoint = {
  version: 1;
  runId: string;
  titleType: TreasuryTitleComplementBackfillTitleType;
  from: string | null;
  to: string | null;
  /** Cursor lexicográfico: TYPE:externalId */
  cursor: string | null;
  created: number;
  skipped: number;
  errors: number;
  completed: boolean;
  updatedAt: string;
};

export type TreasuryTitleComplementBackfillEstimate = {
  method: string;
  sampleSize: number;
  sampleDurationMs: number;
  estimatedTotalApplyMs: number;
  estimatedBatches: number;
};

export type TreasuryTitleComplementBackfillPreviewReport = {
  mode: TreasuryTitleComplementBackfillMode;
  period: { from: string | null; to: string | null };
  titleType: TreasuryTitleComplementBackfillTitleType;
  titlesFound: number;
  eligible: number;
  existingComplements: number;
  existingCancelledComplements: number;
  wouldCreate: number;
  inconsistencies: number;
  duplicates: number;
  cancelledOfficial: number;
  settled: number;
  sampleWouldCreate: Array<{
    titleType: "RECEIVABLE" | "PAYABLE";
    officialTitleId: string;
    officialExternalId: number;
    expectedDate: string | null;
    expectedAmount: string | null;
  }>;
  inconsistencySamples: Array<{
    officialTitleId: string;
    officialExternalId: number;
    action: TreasuryTitleComplementBackfillAction;
    reasons: string[];
  }>;
  duplicateSamples: Array<{
    officialExternalId: number;
    titleIds: string[];
  }>;
  estimate: TreasuryTitleComplementBackfillEstimate;
  counters: TreasuryTitleComplementBackfillCounters;
};

function parsePositiveInt(raw: string, label: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} inválido: ${raw}`);
  return n;
}

function readOpt(argv: string[], name: string): string | null {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3) || null;
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1]!;
  }
  return null;
}

function readFlag(argv: string[], name: string): boolean {
  return argv.some((a) => a === `--${name}` || a === `--${name}=true`);
}

export function parseTreasuryTitleComplementBackfillCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): TreasuryTitleComplementBackfillCliOptions {
  const modeRaw = (argv[0] ?? "preview").toLowerCase();
  if (modeRaw !== "preview" && modeRaw !== "apply") {
    throw new Error('Modo inválido. Use "preview" ou "apply" como primeiro argumento.');
  }

  const titleTypeRaw = (readOpt(argv, "title-type") ?? "all").toUpperCase();
  const allowed: TreasuryTitleComplementBackfillTitleType[] = [
    "RECEIVABLE",
    "PAYABLE",
    "ALL",
  ];
  if (!allowed.includes(titleTypeRaw as TreasuryTitleComplementBackfillTitleType)) {
    throw new Error(
      `--title-type inválido: ${titleTypeRaw}. Use receivable|payable|all.`
    );
  }

  let batchSize = TREASURY_TITLE_COMPLEMENT_BACKFILL_DEFAULT_BATCH_SIZE;
  const batchRaw = readOpt(argv, "batch-size");
  if (batchRaw) {
    batchSize = Math.min(
      parsePositiveInt(batchRaw, "--batch-size"),
      TREASURY_TITLE_COMPLEMENT_BACKFILL_HARD_MAX_BATCH
    );
  }

  const from = readOpt(argv, "from");
  const to = readOpt(argv, "to");
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    throw new Error(`--from inválido (use YYYY-MM-DD): ${from}`);
  }
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error(`--to inválido (use YYYY-MM-DD): ${to}`);
  }

  const createdByUserId =
    readOpt(argv, "created-by-user-id") ??
    env[TREASURY_TITLE_COMPLEMENT_BACKFILL_USER_ENV]?.trim() ??
    null;

  const checkpointFile =
    readOpt(argv, "checkpoint-file") ??
    env[TREASURY_TITLE_COMPLEMENT_BACKFILL_CHECKPOINT_ENV]?.trim() ??
    null;

  const limitRaw = readOpt(argv, "limit");
  const limit = limitRaw ? parsePositiveInt(limitRaw, "--limit") : null;

  return {
    mode: modeRaw,
    titleType: titleTypeRaw as TreasuryTitleComplementBackfillTitleType,
    from,
    to,
    batchSize,
    createdByUserId,
    checkpointFile,
    resume: readFlag(argv, "resume"),
    openOnly: !readFlag(argv, "include-settled"),
    limit,
    json: readFlag(argv, "json"),
  };
}

export function moneyFromOfficial(
  value: { toFixed(digits: number): string } | string | number | null | undefined
): string | null {
  if (value == null || value === "") return null;
  try {
    if (typeof value === "string") return normalizeTreasuryMoneyString(value);
    if (typeof value === "number") {
      return normalizeTreasuryMoneyString(value.toFixed(2));
    }
    return normalizeTreasuryMoneyString(value.toFixed(2));
  } catch {
    return null;
  }
}

export function isOfficialTitleCancelled(row: {
  sourcePresenceStatus: string;
  sourceRemovedAt: Date | string | null;
}): boolean {
  if (row.sourceRemovedAt != null) return true;
  return String(row.sourcePresenceStatus).toUpperCase() === "MISSING_CONFIRMED";
}

export function isOfficialTitleSettled(row: {
  status: boolean | null;
  openBalance: string | null;
}): boolean {
  if (row.status === true) return true;
  if (row.openBalance == null) return false;
  return Number(row.openBalance) <= 0;
}

export function resolveBackfillExpectedDate(
  row: TreasuryOfficialTitleBackfillSeed
): { expectedDate: string | null; scheduledDate: string | null } {
  const due = toCivilDateKey(row.dueDate);
  const scheduled = toCivilDateKey(row.scheduleDate ?? null);
  if (row.titleType === "PAYABLE") {
    return {
      expectedDate: scheduled ?? due,
      scheduledDate: scheduled,
    };
  }
  return { expectedDate: due, scheduledDate: null };
}

export function buildTreasuryTitleComplementCreateSeed(
  row: TreasuryOfficialTitleBackfillSeed,
  createdByUserId: string
): TreasuryTitleComplementCreateSeed | null {
  const dates = resolveBackfillExpectedDate(row);
  if (!dates.expectedDate && !dates.scheduledDate) return null;
  const amount = row.openBalance;
  return {
    titleType: row.titleType,
    officialTitleId: row.officialTitleId,
    officialExternalId: row.officialExternalId,
    expectedDate: dates.expectedDate,
    scheduledDate: dates.scheduledDate,
    expectedAmount: amount,
    scheduledAmount:
      row.titleType === "PAYABLE" && dates.scheduledDate ? amount : null,
    status: "ACTIVE",
    priority: "NORMAL",
    notes: TREASURY_TITLE_COMPLEMENT_BACKFILL_NOTES,
    createdByUserId,
  };
}

export function serializeTreasuryBackfillCursor(item: {
  titleType: "RECEIVABLE" | "PAYABLE";
  officialExternalId: number;
}): string {
  return `${item.titleType}:${item.officialExternalId}`;
}

export function parseTreasuryBackfillCursor(
  raw: string | null | undefined
): { titleType: "RECEIVABLE" | "PAYABLE"; officialExternalId: number } | null {
  if (!raw?.trim()) return null;
  const m = /^(RECEIVABLE|PAYABLE):(\d+)$/.exec(raw.trim());
  if (!m) return null;
  return {
    titleType: m[1] as "RECEIVABLE" | "PAYABLE",
    officialExternalId: Number(m[2]),
  };
}

export function compareTreasuryBackfillCursor(
  a: { titleType: "RECEIVABLE" | "PAYABLE"; officialExternalId: number },
  b: { titleType: "RECEIVABLE" | "PAYABLE"; officialExternalId: number }
): number {
  if (a.titleType !== b.titleType) {
    return a.titleType < b.titleType ? -1 : 1;
  }
  return a.officialExternalId - b.officialExternalId;
}

export function isAfterTreasuryBackfillCursor(
  item: { titleType: "RECEIVABLE" | "PAYABLE"; officialExternalId: number },
  cursor: { titleType: "RECEIVABLE" | "PAYABLE"; officialExternalId: number } | null
): boolean {
  if (!cursor) return true;
  return compareTreasuryBackfillCursor(item, cursor) > 0;
}

/**
 * Classifica títulos oficiais × complementos existentes.
 * Idempotente: qualquer complemento (ativo ou cancelado) impede CREATE.
 */
export function planTreasuryTitleComplementBackfill(input: {
  titles: TreasuryOfficialTitleBackfillSeed[];
  existingComplements: TreasuryComplementBackfillExisting[];
  createdByUserId: string;
  openOnly?: boolean;
}): {
  items: TreasuryTitleComplementBackfillItem[];
  toCreate: TreasuryTitleComplementBackfillItem[];
  counters: TreasuryTitleComplementBackfillCounters;
  duplicateExternalIds: Map<number, string[]>;
} {
  const openOnly = input.openOnly !== false;
  const byTitle = new Map<string, TreasuryComplementBackfillExisting>();
  const byExternal = new Map<string, TreasuryComplementBackfillExisting>();
  for (const c of input.existingComplements) {
    byTitle.set(`${c.titleType}:${c.officialTitleId}`, c);
    byExternal.set(`${c.titleType}:${c.officialExternalId}`, c);
  }

  const externalBuckets = new Map<string, string[]>();
  for (const t of input.titles) {
    const key = `${t.titleType}:${t.officialExternalId}`;
    const list = externalBuckets.get(key) ?? [];
    list.push(t.officialTitleId);
    externalBuckets.set(key, list);
  }
  const duplicateExternalIds = new Map<number, string[]>();
  for (const [key, ids] of externalBuckets) {
    if (ids.length > 1) {
      const externalId = Number(key.split(":")[1]);
      duplicateExternalIds.set(externalId, ids);
    }
  }

  const items: TreasuryTitleComplementBackfillItem[] = [];
  const counters: TreasuryTitleComplementBackfillCounters = {
    titlesFound: input.titles.length,
    eligible: 0,
    existingComplements: 0,
    existingCancelledComplements: 0,
    wouldCreate: 0,
    created: 0,
    skippedSettled: 0,
    skippedCancelledOfficial: 0,
    inconsistencies: 0,
    duplicates: 0,
    errors: 0,
  };

  const sorted = [...input.titles].sort((a, b) =>
    compareTreasuryBackfillCursor(a, b)
  );

  for (const row of sorted) {
    const dates = resolveBackfillExpectedDate(row);
    const base = {
      titleType: row.titleType,
      officialTitleId: row.officialTitleId,
      officialExternalId: row.officialExternalId,
      openBalance: row.openBalance,
      expectedDate: dates.expectedDate,
      create: null as TreasuryTitleComplementCreateSeed | null,
    };

    const dupIds = duplicateExternalIds.get(row.officialExternalId);
    if (dupIds && dupIds.length > 1) {
      counters.duplicates += 1;
      items.push({
        ...base,
        action: "SKIP_DUPLICATE_EXTERNAL",
        needsWrite: false,
        reasons: ["DUPLICATE_EXTERNAL_ID_IN_SOURCE"],
      });
      continue;
    }

    if (isOfficialTitleCancelled(row)) {
      counters.skippedCancelledOfficial += 1;
      items.push({
        ...base,
        action: "SKIP_CANCELLED_OFFICIAL",
        needsWrite: false,
        reasons: ["OFFICIAL_CANCELLED_OR_REMOVED"],
      });
      continue;
    }

    if (openOnly && isOfficialTitleSettled(row)) {
      counters.skippedSettled += 1;
      items.push({
        ...base,
        action: "SKIP_SETTLED",
        needsWrite: false,
        reasons: ["OFFICIAL_SETTLED_OR_ZERO_BALANCE"],
      });
      continue;
    }

    const existing =
      byTitle.get(`${row.titleType}:${row.officialTitleId}`) ?? null;
    const byExt =
      byExternal.get(`${row.titleType}:${row.officialExternalId}`) ?? null;

    if (byExt && byExt.officialTitleId !== row.officialTitleId) {
      counters.inconsistencies += 1;
      items.push({
        ...base,
        action: "SKIP_INCONSISTENT_EXTERNAL_MISMATCH",
        needsWrite: false,
        reasons: [
          "COMPLEMENT_EXTERNAL_ID_POINTS_TO_OTHER_TITLE",
          `complementId=${byExt.id}`,
        ],
      });
      continue;
    }

    if (existing) {
      if (existing.cancelledAt != null) {
        counters.existingCancelledComplements += 1;
        items.push({
          ...base,
          action: "SKIP_EXISTING_CANCELLED_COMPLEMENT",
          needsWrite: false,
          reasons: ["COMPLEMENT_ALREADY_EXISTS_CANCELLED"],
        });
      } else {
        counters.existingComplements += 1;
        items.push({
          ...base,
          action: "SKIP_EXISTING_COMPLEMENT",
          needsWrite: false,
          reasons: ["COMPLEMENT_ALREADY_EXISTS"],
        });
      }
      continue;
    }

    if (!dates.expectedDate && !dates.scheduledDate) {
      counters.inconsistencies += 1;
      items.push({
        ...base,
        action: "SKIP_INCONSISTENT_NO_DATE",
        needsWrite: false,
        reasons: ["MISSING_DUE_AND_SCHEDULE_DATE"],
      });
      continue;
    }

    const create = buildTreasuryTitleComplementCreateSeed(
      row,
      input.createdByUserId
    );
    if (!create) {
      counters.inconsistencies += 1;
      items.push({
        ...base,
        action: "SKIP_INCONSISTENT_NO_DATE",
        needsWrite: false,
        reasons: ["CREATE_SEED_FAILED"],
      });
      continue;
    }

    counters.eligible += 1;
    counters.wouldCreate += 1;
    items.push({
      ...base,
      action: "CREATE",
      needsWrite: true,
      reasons: ["MISSING_COMPLEMENT_SEED_FROM_OFFICIAL"],
      create,
    });
  }

  return {
    items,
    toCreate: items.filter((i) => i.needsWrite),
    counters,
    duplicateExternalIds,
  };
}

export function chunkTreasuryBackfillItems<T>(
  items: T[],
  batchSize: number
): T[][] {
  const size = Math.max(1, Math.floor(batchSize) || 1);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function estimateTreasuryBackfillApplyMs(input: {
  wouldCreate: number;
  batchSize: number;
  sampleSize: number;
  sampleDurationMs: number;
}): TreasuryTitleComplementBackfillEstimate {
  const batchSize = Math.max(1, input.batchSize);
  const estimatedBatches = Math.ceil(Math.max(0, input.wouldCreate) / batchSize);
  const perItemMs =
    input.sampleSize > 0
      ? input.sampleDurationMs / input.sampleSize
      : 3;
  const writeFactor = 2.5;
  const estimatedTotalApplyMs = Math.round(
    input.wouldCreate * perItemMs * writeFactor + estimatedBatches * 15
  );
  return {
    method: "timed_classify_extrapolated_to_apply",
    sampleSize: input.sampleSize,
    sampleDurationMs: input.sampleDurationMs,
    estimatedTotalApplyMs,
    estimatedBatches,
  };
}

export function buildTreasuryTitleComplementBackfillPreviewReport(input: {
  mode: TreasuryTitleComplementBackfillMode;
  options: Pick<
    TreasuryTitleComplementBackfillCliOptions,
    "from" | "to" | "titleType" | "batchSize"
  >;
  plan: ReturnType<typeof planTreasuryTitleComplementBackfill>;
  sampleDurationMs: number;
}): TreasuryTitleComplementBackfillPreviewReport {
  const { plan, options } = input;
  const estimate = estimateTreasuryBackfillApplyMs({
    wouldCreate: plan.counters.wouldCreate,
    batchSize: options.batchSize,
    sampleSize: plan.counters.titlesFound,
    sampleDurationMs: input.sampleDurationMs,
  });

  return {
    mode: input.mode,
    period: { from: options.from, to: options.to },
    titleType: options.titleType,
    titlesFound: plan.counters.titlesFound,
    eligible: plan.counters.eligible,
    existingComplements: plan.counters.existingComplements,
    existingCancelledComplements: plan.counters.existingCancelledComplements,
    wouldCreate: plan.counters.wouldCreate,
    inconsistencies: plan.counters.inconsistencies,
    duplicates: plan.counters.duplicates,
    cancelledOfficial: plan.counters.skippedCancelledOfficial,
    settled: plan.counters.skippedSettled,
    sampleWouldCreate: plan.toCreate.slice(0, 20).map((i) => ({
      titleType: i.titleType,
      officialTitleId: i.officialTitleId,
      officialExternalId: i.officialExternalId,
      expectedDate: i.create?.expectedDate ?? null,
      expectedAmount: i.create?.expectedAmount ?? null,
    })),
    inconsistencySamples: plan.items
      .filter(
        (i) =>
          i.action === "SKIP_INCONSISTENT_NO_DATE" ||
          i.action === "SKIP_INCONSISTENT_EXTERNAL_MISMATCH"
      )
      .slice(0, 20)
      .map((i) => ({
        officialTitleId: i.officialTitleId,
        officialExternalId: i.officialExternalId,
        action: i.action,
        reasons: i.reasons,
      })),
    duplicateSamples: [...plan.duplicateExternalIds.entries()]
      .slice(0, 20)
      .map(([officialExternalId, titleIds]) => ({
        officialExternalId,
        titleIds,
      })),
    estimate,
    counters: plan.counters,
  };
}

export function createEmptyTreasuryBackfillCheckpoint(input: {
  runId: string;
  titleType: TreasuryTitleComplementBackfillTitleType;
  from: string | null;
  to: string | null;
}): TreasuryTitleComplementBackfillCheckpoint {
  return {
    version: 1,
    runId: input.runId,
    titleType: input.titleType,
    from: input.from,
    to: input.to,
    cursor: null,
    created: 0,
    skipped: 0,
    errors: 0,
    completed: false,
    updatedAt: new Date().toISOString(),
  };
}

export function assertBackfillDoesNotTouchOfficialTitles(
  createPayload: Record<string, unknown>
): void {
  const forbidden = [
    "amountReceivable",
    "amountPayable",
    "balanceReceivable",
    "balancePayable",
    "dueDate",
    "rawPayload",
    "payloadHash",
  ];
  for (const key of forbidden) {
    if (key in createPayload) {
      throw new Error(
        `Backfill não pode tocar campo oficial Nomus: ${key}`
      );
    }
  }
}
