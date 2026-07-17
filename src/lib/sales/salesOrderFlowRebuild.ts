/**
 * OP-56 — Helpers puros do rebuild do Fluxo de Pedidos (CLI, checkpoint, resumo).
 * Sem I/O de banco / Nomus.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export const SALES_ORDER_FLOW_REBUILD_DEFAULT_BATCH_SIZE = 50;
export const SALES_ORDER_FLOW_REBUILD_DEFAULT_CHECKPOINT_FILE =
  "tmp/sales-order-flow-rebuild.checkpoint.json";
export const SALES_ORDER_FLOW_REBUILD_DEFAULT_LOCK_FILE =
  "tmp/sales-order-flow-rebuild.lock";
export const SALES_ORDER_FLOW_REBUILD_CHECKPOINT_ENV =
  "SALES_ORDER_FLOW_REBUILD_CHECKPOINT_FILE";
export const SALES_ORDER_FLOW_REBUILD_LOCK_ENV =
  "SALES_ORDER_FLOW_REBUILD_LOCK_FILE";

export type SalesOrderFlowRebuildMode = "preview" | "apply";

export type SalesOrderFlowRebuildCliOptions = {
  mode: SalesOrderFlowRebuildMode;
  /** Código do pedido (ex.: "PD 02596"). */
  orderCode: string | null;
  fromDate: Date | null;
  toDate: Date | null;
  batchSize: number;
  includeCompleted: boolean;
  /**
   * Cursor de retomada: salesOrderId (UUID) ou orderCode.
   * Processa pedidos com id estritamente maior que o resolvido.
   */
  resumeFrom: string | null;
  checkpointFile: string;
  lockFile: string;
  /** Limite defensivo de lotes por execução (null = até esgotar). */
  maxBatches: number | null;
};

export type SalesOrderFlowRebuildCheckpoint = {
  version: 1;
  lastSalesOrderId: string;
  lastOrderCode: string | null;
  batchesCompleted: number;
  ordersProcessed: number;
  updatedAt: string;
};

export type SalesOrderFlowRebuildOrderError = {
  salesOrderId: string;
  orderCode: string | null;
  message: string;
};

export type SalesOrderFlowRebuildSummary = {
  mode: SalesOrderFlowRebuildMode;
  ordersSelected: number;
  ordersProcessed: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  errorReport: SalesOrderFlowRebuildOrderError[];
  batchesCompleted: number;
  batchSize: number;
  includeCompleted: boolean;
  orderCodeFilter: string | null;
  fromDate: string | null;
  toDate: string | null;
  resumeFrom: string | null;
  checkpointFile: string;
  checkpointAdvanced: boolean;
  lastCheckpoint: SalesOrderFlowRebuildCheckpoint | null;
  lockBlocked: boolean;
  durationMs: number;
  exitCode: number;
};

export function hasCliFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`) || argv.includes(`--${name}=true`);
}

function parseArgValue(argv: string[], name: string): string | null {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith(eq)) return arg.slice(eq.length);
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) return next;
    }
  }
  return null;
}

function parseDateArg(value: string | null): Date | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!));
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parsePositiveInt(raw: string, label: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} inválido: ${raw}`);
  return n;
}

export function printSalesOrderFlowRebuildHelp(): string {
  return [
    "Usage: npm run rebuild:sales-order-flow -- --preview| --apply [options]",
    "   or: npx tsx scripts/rebuildSalesOrderFlow.ts --preview|--apply [options]",
    "",
    "Options:",
    "  --preview                  Calcula sem gravar snapshots/eventos (default se sem --apply)",
    "  --apply                    Persiste snapshots/eventos derivados",
    "  --order=\"PD 02596\"         Filtra um pedido pelo orderCode",
    "  --from=YYYY-MM-DD          issueDate >= from (UTC)",
    "  --to=YYYY-MM-DD            issueDate <= to (UTC fim do dia)",
    "  --batch-size=N             Tamanho do lote (default 50)",
    "  --include-completed        Inclui pedidos já SHIPPED_COMPLETED",
    "  --resume-from=ID|CODE      Retoma após salesOrderId ou orderCode",
    "  --checkpoint-file=PATH     Arquivo de checkpoint (default tmp/...)",
    "  --lock-file=PATH           Lock exclusivo apply (default tmp/...)",
    "  --max-batches=N            Limite defensivo de lotes nesta execução",
    "  --help",
    "",
    "Somente dados locais. Sem Nomus HTTP.",
    "Grava apenas SalesOrder*FlowSnapshot / SalesOrderFlowEvent.",
    "Não altera SalesOrder, OP, Documento, NF ou CR.",
    "Docs: docs/commercial/sales-order-flow/rebuild-runbook.md",
  ].join("\n");
}

export function parseSalesOrderFlowRebuildCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): SalesOrderFlowRebuildCliOptions {
  if (hasCliFlag(argv, "help") || hasCliFlag(argv, "h")) {
    throw new Error("HELP");
  }

  const apply = hasCliFlag(argv, "apply") || argv.includes("apply");
  const previewFlag =
    hasCliFlag(argv, "preview") ||
    argv.includes("preview") ||
    hasCliFlag(argv, "dry-run");

  if (apply && previewFlag) {
    throw new Error("Informe apenas --preview ou --apply, não ambos.");
  }

  const finalMode: SalesOrderFlowRebuildMode = apply ? "apply" : "preview";

  const batchSizeRaw = parseArgValue(argv, "batch-size");
  const batchSize = batchSizeRaw
    ? parsePositiveInt(batchSizeRaw, "--batch-size")
    : SALES_ORDER_FLOW_REBUILD_DEFAULT_BATCH_SIZE;

  const maxBatchesRaw = parseArgValue(argv, "max-batches");
  const maxBatches = maxBatchesRaw
    ? parsePositiveInt(maxBatchesRaw, "--max-batches")
    : null;

  const orderCode = (parseArgValue(argv, "order") ?? "").trim() || null;
  const fromDate = parseDateArg(parseArgValue(argv, "from"));
  const toDate = parseDateArg(parseArgValue(argv, "to"));
  if (parseArgValue(argv, "from") && !fromDate) {
    throw new Error(`--from inválido: ${parseArgValue(argv, "from")}`);
  }
  if (parseArgValue(argv, "to") && !toDate) {
    throw new Error(`--to inválido: ${parseArgValue(argv, "to")}`);
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new Error("--from não pode ser posterior a --to.");
  }

  const resumeFrom = (parseArgValue(argv, "resume-from") ?? "").trim() || null;
  const checkpointFile =
    (parseArgValue(argv, "checkpoint-file") ?? "").trim() ||
    (env[SALES_ORDER_FLOW_REBUILD_CHECKPOINT_ENV] ?? "").trim() ||
    SALES_ORDER_FLOW_REBUILD_DEFAULT_CHECKPOINT_FILE;
  const lockFile =
    (parseArgValue(argv, "lock-file") ?? "").trim() ||
    (env[SALES_ORDER_FLOW_REBUILD_LOCK_ENV] ?? "").trim() ||
    SALES_ORDER_FLOW_REBUILD_DEFAULT_LOCK_FILE;

  return {
    mode: finalMode,
    orderCode,
    fromDate,
    toDate,
    batchSize: Math.min(Math.max(1, batchSize), 500),
    includeCompleted: hasCliFlag(argv, "include-completed"),
    resumeFrom,
    checkpointFile,
    lockFile,
    maxBatches,
  };
}

export function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
}

export function serializeSalesOrderFlowRebuildCheckpoint(
  checkpoint: SalesOrderFlowRebuildCheckpoint
): string {
  return `${JSON.stringify(checkpoint, null, 2)}\n`;
}

export function parseSalesOrderFlowRebuildCheckpoint(
  raw: string | null | undefined
): SalesOrderFlowRebuildCheckpoint | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<SalesOrderFlowRebuildCheckpoint>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.lastSalesOrderId !== "string" || !parsed.lastSalesOrderId) {
      return null;
    }
    return {
      version: 1,
      lastSalesOrderId: parsed.lastSalesOrderId,
      lastOrderCode:
        typeof parsed.lastOrderCode === "string" ? parsed.lastOrderCode : null,
      batchesCompleted:
        typeof parsed.batchesCompleted === "number" ? parsed.batchesCompleted : 0,
      ordersProcessed:
        typeof parsed.ordersProcessed === "number" ? parsed.ordersProcessed : 0,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Checkpoint só avança quando o lote inteiro terminou (sucessos + erros isolados).
 * Lote incompleto (crash/abort) → não avançar.
 */
export function shouldAdvanceSalesOrderFlowRebuildCheckpoint(input: {
  batchComplete: boolean;
  mode: SalesOrderFlowRebuildMode;
}): boolean {
  return input.mode === "apply" && input.batchComplete;
}

export function emptySalesOrderFlowRebuildSummary(
  options: SalesOrderFlowRebuildCliOptions
): SalesOrderFlowRebuildSummary {
  return {
    mode: options.mode,
    ordersSelected: 0,
    ordersProcessed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
    errorReport: [],
    batchesCompleted: 0,
    batchSize: options.batchSize,
    includeCompleted: options.includeCompleted,
    orderCodeFilter: options.orderCode,
    fromDate: options.fromDate?.toISOString().slice(0, 10) ?? null,
    toDate: options.toDate?.toISOString().slice(0, 10) ?? null,
    resumeFrom: options.resumeFrom,
    checkpointFile: options.checkpointFile,
    checkpointAdvanced: false,
    lastCheckpoint: null,
    lockBlocked: false,
    durationMs: 0,
    exitCode: 0,
  };
}

export function exitCodeForSalesOrderFlowRebuildSummary(
  summary: Pick<SalesOrderFlowRebuildSummary, "errors" | "lockBlocked" | "ordersProcessed">
): number {
  if (summary.lockBlocked) return 2;
  if (summary.errors > 0) return 1;
  return 0;
}

export function formatSalesOrderFlowRebuildSummary(
  summary: SalesOrderFlowRebuildSummary
): string {
  const lines = [
    "=== Sales Order Flow Rebuild SUMMARY ===",
    `mode: ${summary.mode}`,
    `ordersSelected: ${summary.ordersSelected}`,
    `ordersProcessed: ${summary.ordersProcessed}`,
    `created: ${summary.created}`,
    `updated: ${summary.updated}`,
    `unchanged: ${summary.unchanged}`,
    `errors: ${summary.errors}`,
    `batchesCompleted: ${summary.batchesCompleted}`,
    `batchSize: ${summary.batchSize}`,
    `includeCompleted: ${summary.includeCompleted}`,
    `checkpointAdvanced: ${summary.checkpointAdvanced}`,
    `lockBlocked: ${summary.lockBlocked}`,
    `durationMs: ${summary.durationMs}`,
    `exitCode: ${summary.exitCode}`,
  ];
  if (summary.errorReport.length > 0) {
    lines.push("errorsDetail:");
    for (const err of summary.errorReport.slice(0, 50)) {
      lines.push(
        `  - ${err.orderCode ?? err.salesOrderId}: ${err.message}`
      );
    }
    if (summary.errorReport.length > 50) {
      lines.push(`  … +${summary.errorReport.length - 50} more`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Lock próprio (arquivo JSON + PID)
// ---------------------------------------------------------------------------

export type SalesOrderFlowRebuildLockPayload = {
  version: 1;
  token: string;
  pid: number;
  mode: SalesOrderFlowRebuildMode;
  startedAt: string;
  hostname: string | null;
};

export type SalesOrderFlowRebuildLockAcquireResult =
  | {
      ok: true;
      lockFile: string;
      token: string;
      payload: SalesOrderFlowRebuildLockPayload;
    }
  | {
      ok: false;
      code: "LOCK_HELD";
      message: string;
      lockFile: string;
      holder: SalesOrderFlowRebuildLockPayload | null;
    };

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EPERM") return true;
    return false;
  }
}

export function parseSalesOrderFlowRebuildLockPayload(
  raw: string | null | undefined
): SalesOrderFlowRebuildLockPayload | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SalesOrderFlowRebuildLockPayload>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) return null;
    if (parsed.mode !== "preview" && parsed.mode !== "apply") return null;
    if (typeof parsed.startedAt !== "string" || !parsed.startedAt) return null;
    return {
      version: 1,
      token: parsed.token,
      pid: Math.trunc(parsed.pid),
      mode: parsed.mode,
      startedAt: parsed.startedAt,
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : null,
    };
  } catch {
    return null;
  }
}

export function acquireSalesOrderFlowRebuildLock(args: {
  lockFile: string;
  mode: SalesOrderFlowRebuildMode;
  pid?: number;
  now?: () => Date;
  existsFn?: (path: string) => boolean;
  readFn?: (path: string) => string;
  writeFn?: (path: string, data: string) => void;
  unlinkFn?: (path: string) => void;
  mkdirFn?: (path: string) => void;
}): SalesOrderFlowRebuildLockAcquireResult {
  const existsFn = args.existsFn ?? existsSync;
  const readFn = args.readFn ?? ((p) => readFileSync(p, "utf8"));
  const writeFn = args.writeFn ?? writeFileSync;
  const unlinkFn = args.unlinkFn ?? unlinkSync;
  const mkdirFn =
    args.mkdirFn ??
    ((p: string) => {
      if (p && p !== "." && !existsFn(p)) mkdirSync(p, { recursive: true });
    });
  const now = args.now ?? (() => new Date());
  const pid = args.pid ?? process.pid;

  const dir = dirname(args.lockFile);
  mkdirFn(dir);

  const readHolder = (): SalesOrderFlowRebuildLockPayload | null => {
    try {
      if (!existsFn(args.lockFile)) return null;
      return parseSalesOrderFlowRebuildLockPayload(readFn(args.lockFile));
    } catch {
      return null;
    }
  };

  let holder = readHolder();
  if (holder && !isPidAlive(holder.pid)) {
    try {
      unlinkFn(args.lockFile);
    } catch {
      /* ignore */
    }
    holder = readHolder();
  }

  if (holder && isPidAlive(holder.pid)) {
    return {
      ok: false,
      code: "LOCK_HELD",
      message: `Rebuild do Fluxo de Pedidos já em execução (pid=${holder.pid}, token=${holder.token}).`,
      lockFile: args.lockFile,
      holder,
    };
  }

  const payload: SalesOrderFlowRebuildLockPayload = {
    version: 1,
    token: randomUUID(),
    pid,
    mode: args.mode,
    startedAt: now().toISOString(),
    hostname: hostname(),
  };

  try {
    if (existsFn(args.lockFile)) {
      const live = readHolder();
      if (live && isPidAlive(live.pid)) {
        return {
          ok: false,
          code: "LOCK_HELD",
          message: `Rebuild do Fluxo de Pedidos já em execução (pid=${live.pid}).`,
          lockFile: args.lockFile,
          holder: live,
        };
      }
    }
    writeFn(args.lockFile, `${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "LOCK_HELD",
      message: `Falha ao adquirir lock: ${message}`,
      lockFile: args.lockFile,
      holder: readHolder(),
    };
  }

  return {
    ok: true,
    lockFile: args.lockFile,
    token: payload.token,
    payload,
  };
}

export function releaseSalesOrderFlowRebuildLock(args: {
  lockFile: string;
  token: string;
  readFn?: (path: string) => string;
  unlinkFn?: (path: string) => void;
  existsFn?: (path: string) => boolean;
}): boolean {
  const existsFn = args.existsFn ?? existsSync;
  const readFn = args.readFn ?? ((p) => readFileSync(p, "utf8"));
  const unlinkFn = args.unlinkFn ?? unlinkSync;
  try {
    if (!existsFn(args.lockFile)) return true;
    const holder = parseSalesOrderFlowRebuildLockPayload(readFn(args.lockFile));
    if (holder && holder.token !== args.token) return false;
    unlinkFn(args.lockFile);
    return true;
  } catch {
    return false;
  }
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}
