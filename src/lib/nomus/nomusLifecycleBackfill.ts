/**
 * SYNC-08 — Backfill técnico de lifecycle Nomus (puro, sem I/O).
 *
 * Inicializa PRESENT / evidências de first/last seen.
 * Nunca declara ausência (MISSING_*).
 */

import { buildNomusSourceLifecycleDefaults } from "./nomusSourceLifecycleContract.js";
import type { NomusSourceSyncEntityType } from "./nomusSourceLifecycleContract.js";

/** Campos oficiais de negócio (não são alvo do backfill). */
export const NOMUS_OFFICIAL_BUSINESS_FIELD_GROUPS = {
  SALES_ORDER: [
    "orderCode",
    "status",
    "totalNetValue",
    "customerId",
    "issueDate",
    "nomusRawResponse",
  ],
  ACCOUNTS_RECEIVABLE: [
    "externalId",
    "dueDate",
    "amountReceivable",
    "amountReceived",
    "balanceReceivable",
    "rawPayload",
    "payloadHash",
  ],
  ACCOUNTS_PAYABLE: [
    "externalId",
    "dueDate",
    "amountPayable",
    "amountPaid",
    "balancePayable",
    "rawPayload",
    "payloadHash",
  ],
} as const;

/** Campos exclusivamente de lifecycle (alvo do backfill). */
export const NOMUS_LIFECYCLE_ONLY_FIELDS = [
  "sourcePresenceStatus",
  "presentInLastPayload",
  "firstSeenAt",
  "lastSeenAt",
  "missingSince",
  "missingConsecutiveRuns",
  "sourceRemovedAt",
  "lastSyncRunId",
] as const;

export type NomusLifecycleBackfillEntity =
  | "sales-orders"
  | "accounts-receivable"
  | "accounts-payable"
  | "all";

export type NomusLifecycleBackfillMode = "preview" | "apply";

export type NomusLifecycleBackfillCliOptions = {
  mode: NomusLifecycleBackfillMode;
  entity: NomusLifecycleBackfillEntity;
  externalId: number | null;
  orderCode: string | null;
  from: string | null;
  to: string | null;
  batchSize: number;
  /** Se true, também normaliza linhas já MISSING_* para PRESENT (perigoso). Default false. */
  forcePresent: boolean;
  explain: boolean;
  json: boolean;
  csv: boolean;
  resumeCursor: string | null;
};

export type NomusLifecycleBackfillLocalRow = {
  id: string;
  entityType: NomusSourceSyncEntityType;
  externalKey: string;
  sourcePresenceStatus: string | null | undefined;
  presentInLastPayload: boolean | null | undefined;
  firstSeenAt: Date | string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
  missingConsecutiveRuns: number | null | undefined;
  missingSince: Date | string | null | undefined;
  sourceRemovedAt: Date | string | null | undefined;
  createdAt: Date | string;
  updatedAt: Date | string;
  syncedAt?: Date | string | null;
};

export type NomusLifecycleBackfillPatch = {
  sourcePresenceStatus: "PRESENT";
  presentInLastPayload: true;
  firstSeenAt: Date;
  lastSeenAt: Date;
  missingConsecutiveRuns: 0;
  missingSince: null;
  sourceRemovedAt: null;
};

export type NomusLifecycleBackfillItem = {
  localId: string;
  entityType: NomusSourceSyncEntityType;
  externalKey: string;
  action: "INITIALIZE" | "NORMALIZE" | "SKIP_ALREADY_OK" | "SKIP_PRESERVE_ABSENCE";
  needsWrite: boolean;
  before: {
    sourcePresenceStatus: string | null;
    presentInLastPayload: boolean | null;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    missingConsecutiveRuns: number;
  };
  after: NomusLifecycleBackfillPatch | null;
  reasons: string[];
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(value: Date | string | null | undefined): string | null {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

function earlier(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

/** Melhor evidência segura para firstSeenAt / lastSeenAt — sem inferir ausência. */
export function resolveLifecycleBackfillSeenAts(row: NomusLifecycleBackfillLocalRow): {
  firstSeenAt: Date;
  lastSeenAt: Date;
} {
  const createdAt = toDate(row.createdAt) ?? new Date(0);
  const updatedAt = toDate(row.updatedAt) ?? createdAt;
  const syncedAt = toDate(row.syncedAt ?? null);
  const existingFirst = toDate(row.firstSeenAt);
  const existingLast = toDate(row.lastSeenAt);

  const firstSeenAt = existingFirst
    ? earlier(existingFirst, createdAt)
    : createdAt;

  const lastCandidates = [updatedAt, syncedAt, existingLast, createdAt].filter(
    (d): d is Date => d != null
  );
  const lastSeenAt = lastCandidates.reduce((acc, d) => later(acc, d));

  return { firstSeenAt, lastSeenAt };
}

export function planNomusLifecycleBackfillRow(
  row: NomusLifecycleBackfillLocalRow,
  options?: { forcePresent?: boolean }
): NomusLifecycleBackfillItem {
  const status = row.sourcePresenceStatus ?? null;
  const isMissing =
    status === "MISSING_CANDIDATE" || status === "MISSING_CONFIRMED";

  const before = {
    sourcePresenceStatus: status,
    presentInLastPayload:
      typeof row.presentInLastPayload === "boolean" ? row.presentInLastPayload : null,
    firstSeenAt: toIso(row.firstSeenAt),
    lastSeenAt: toIso(row.lastSeenAt),
    missingConsecutiveRuns: row.missingConsecutiveRuns ?? 0,
  };

  if (isMissing && !options?.forcePresent) {
    return {
      localId: row.id,
      entityType: row.entityType,
      externalKey: row.externalKey,
      action: "SKIP_PRESERVE_ABSENCE",
      needsWrite: false,
      before,
      after: null,
      reasons: [
        "PRESERVE_EXISTING_ABSENCE",
        "BACKFILL_DOES_NOT_DECLARE_ABSENCE",
      ],
    };
  }

  const defaults = buildNomusSourceLifecycleDefaults();
  const seen = resolveLifecycleBackfillSeenAts(row);
  const after: NomusLifecycleBackfillPatch = {
    sourcePresenceStatus: defaults.sourcePresenceStatus,
    presentInLastPayload: defaults.presentInLastPayload,
    firstSeenAt: seen.firstSeenAt,
    lastSeenAt: seen.lastSeenAt,
    missingConsecutiveRuns: defaults.missingConsecutiveRuns,
    missingSince: defaults.missingSince,
    sourceRemovedAt: defaults.sourceRemovedAt,
  };

  const reasons: string[] = ["LIFECYCLE_TECHNICAL_INIT", "NO_ABSENCE_DECLARED"];
  const alreadyOk =
    before.sourcePresenceStatus === "PRESENT" &&
    before.presentInLastPayload === true &&
    before.missingConsecutiveRuns === 0 &&
    before.firstSeenAt === after.firstSeenAt.toISOString() &&
    before.lastSeenAt === after.lastSeenAt.toISOString() &&
    row.missingSince == null &&
    row.sourceRemovedAt == null;

  if (alreadyOk) {
    return {
      localId: row.id,
      entityType: row.entityType,
      externalKey: row.externalKey,
      action: "SKIP_ALREADY_OK",
      needsWrite: false,
      before,
      after: null,
      reasons: ["IDEMPOTENT_NOOP"],
    };
  }

  if (before.sourcePresenceStatus !== "PRESENT" || before.presentInLastPayload !== true) {
    reasons.push("INITIALIZE_PRESENT");
  } else {
    reasons.push("NORMALIZE_SEEN_AT");
  }

  return {
    localId: row.id,
    entityType: row.entityType,
    externalKey: row.externalKey,
    action:
      before.sourcePresenceStatus !== "PRESENT" || before.presentInLastPayload !== true
        ? "INITIALIZE"
        : "NORMALIZE",
    needsWrite: true,
    before,
    after,
    reasons,
  };
}

export function planNomusLifecycleBackfill(
  rows: NomusLifecycleBackfillLocalRow[],
  options?: { forcePresent?: boolean }
): {
  items: NomusLifecycleBackfillItem[];
  toWrite: NomusLifecycleBackfillItem[];
  counters: {
    total: number;
    initialize: number;
    normalize: number;
    skipAlreadyOk: number;
    skipPreserveAbsence: number;
    wouldWrite: number;
  };
  absencesDeclared: 0;
} {
  const items = rows.map((row) => planNomusLifecycleBackfillRow(row, options));
  const toWrite = items.filter((i) => i.needsWrite);
  return {
    items,
    toWrite,
    counters: {
      total: items.length,
      initialize: items.filter((i) => i.action === "INITIALIZE").length,
      normalize: items.filter((i) => i.action === "NORMALIZE").length,
      skipAlreadyOk: items.filter((i) => i.action === "SKIP_ALREADY_OK").length,
      skipPreserveAbsence: items.filter((i) => i.action === "SKIP_PRESERVE_ABSENCE")
        .length,
      wouldWrite: toWrite.length,
    },
    absencesDeclared: 0,
  };
}

export function chunkLifecycleBackfillItems<T>(
  items: T[],
  batchSize: number
): T[][] {
  const size = Math.max(1, Math.floor(batchSize) || 100);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function readFlag(argv: string[], name: string): boolean {
  return argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
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

export function parseNomusLifecycleBackfillCli(
  argv: string[]
): NomusLifecycleBackfillCliOptions {
  const modeRaw = (argv[0] ?? "preview").toLowerCase();
  if (modeRaw !== "preview" && modeRaw !== "apply") {
    throw new Error('Modo inválido. Use "preview" ou "apply".');
  }
  const entityRaw = (readOpt(argv, "entity") ?? "all").toLowerCase();
  const allowed: NomusLifecycleBackfillEntity[] = [
    "sales-orders",
    "accounts-receivable",
    "accounts-payable",
    "all",
  ];
  if (!allowed.includes(entityRaw as NomusLifecycleBackfillEntity)) {
    throw new Error(
      `--entity inválido. Use ${allowed.join(" | ")}.`
    );
  }
  const batchRaw = readOpt(argv, "batch-size");
  const batchSize = batchRaw ? Number(batchRaw) : 200;
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error("--batch-size deve ser >= 1.");
  }
  const externalRaw = readOpt(argv, "externalId");
  const externalId =
    externalRaw != null && externalRaw !== ""
      ? Number(externalRaw)
      : null;
  if (externalRaw != null && externalRaw !== "" && !Number.isFinite(externalId)) {
    throw new Error("--externalId inválido.");
  }

  return {
    mode: modeRaw,
    entity: entityRaw as NomusLifecycleBackfillEntity,
    externalId,
    orderCode: readOpt(argv, "orderCode"),
    from: readOpt(argv, "from"),
    to: readOpt(argv, "to"),
    batchSize,
    forcePresent: readFlag(argv, "force-present"),
    explain: readFlag(argv, "explain"),
    json: readFlag(argv, "json") || !readFlag(argv, "csv"),
    csv: readFlag(argv, "csv"),
    resumeCursor: readOpt(argv, "resume-cursor"),
  };
}

export type NomusLifecycleBackfillResumeCursor = {
  version: 1;
  entity: NomusLifecycleBackfillEntity;
  nextOffset: number;
  updatedAt: string;
};

export function serializeLifecycleBackfillResumeCursor(
  cursor: NomusLifecycleBackfillResumeCursor
): string {
  return JSON.stringify(cursor);
}

export function parseLifecycleBackfillResumeCursor(
  raw: string | null | undefined
): NomusLifecycleBackfillResumeCursor | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NomusLifecycleBackfillResumeCursor>;
    if (
      parsed.version === 1 &&
      typeof parsed.nextOffset === "number" &&
      parsed.nextOffset >= 0
    ) {
      return {
        version: 1,
        entity: (parsed.entity as NomusLifecycleBackfillEntity) ?? "all",
        nextOffset: parsed.nextOffset,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Preview nunca escreve — contrato testável. */
export function lifecycleBackfillPreviewWrites(): false {
  return false;
}
