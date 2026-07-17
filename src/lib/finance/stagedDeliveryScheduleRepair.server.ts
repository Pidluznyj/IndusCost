/**
 * FIN-13 — Repair server: identifica pedidos staged e reprocessa fatos O2C derivados.
 * Sem Nomus. Preview não escreve.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { getOrderFullAudit } from "./orderFullAuditService.js";
import { projectEffectiveScheduleForOrderAudit } from "./effectiveScheduleAuditProjection.js";
import { salesOrderAuditCodeCandidates } from "./effectiveSalesOrderScheduleAudit.js";
import {
  STAGED_DELIVERY_REPAIR_LOG,
  type StagedDeliveryRepairCandidate,
  type StagedDeliveryRepairCli,
} from "./stagedDeliveryScheduleRepair.js";

const LOCK_PATH = resolve(".locks/repair-staged-delivery-schedules.lock");

export type StagedDeliveryRepairResult = {
  mode: "preview" | "apply";
  exitCode: number;
  lockBlocked: boolean;
  durationMs: number;
  scanned: number;
  candidates: number;
  rebuilt: number;
  errors: number;
  items: StagedDeliveryRepairCandidate[];
  notes: string[];
};

function acquireLock(): boolean {
  mkdirSync(resolve(".locks"), { recursive: true });
  if (existsSync(LOCK_PATH)) return false;
  writeFileSync(LOCK_PATH, `${process.pid}:${new Date().toISOString()}\n`, "utf8");
  return true;
}

function releaseLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
}

async function listCandidateOrderCodes(
  prisma: PrismaClient,
  cli: StagedDeliveryRepairCli
): Promise<string[]> {
  if (cli.orderCode?.trim()) return [cli.orderCode.trim()];

  const from = cli.from ? new Date(`${cli.from}T00:00:00`) : null;
  const to = cli.to ? new Date(`${cli.to}T23:59:59.999`) : null;

  const rows = await prisma.salesOrder.findMany({
    where: {
      ...(from || to
        ? {
            issueDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      items: {
        some: {
          OR: [
            { nomusItemStatusNormalized: { equals: "PARTIAL", mode: "insensitive" } },
            { nomusItemStatusRaw: "3" },
          ],
        },
      },
    },
    select: { orderCode: true },
    orderBy: { issueDate: "asc" },
    take: cli.batchSize,
  });

  return rows.map((r) => r.orderCode).filter(Boolean);
}

function toCandidate(
  orderCode: string,
  salesOrderId: string,
  schedule: {
    coverageSummary: {
      materializationMode: string;
      itemActiveResidualTotal: { toFixed(n: number): string };
      activeOrderResidualTotal: { toFixed(n: number): string };
      stagedResidualWithoutPosition: { toFixed(n: number): string };
    };
    activeOrderResidualSchedule: Array<{
      installmentNumber: number;
      dueDate: string | null;
      residualAmount: { toFixed(n: number): string };
    }>;
    occupiedPositionIndexes: number[];
    stagedDeliveryBlocks: unknown[];
  }
): StagedDeliveryRepairCandidate | null {
  const mode = schedule.coverageSummary.materializationMode;
  const orphan = Number(schedule.coverageSummary.stagedResidualWithoutPosition.toFixed(2));
  const isStaged = mode === "STAGED_AUTOMATIC" || mode === "STAGED_MANUAL";
  if (!isStaged && orphan <= 0) return null;

  return {
    salesOrderId,
    orderCode,
    materializationMode: mode,
    itemActiveResidualTotal: schedule.coverageSummary.itemActiveResidualTotal.toFixed(2),
    activeOrderResidualTotal: schedule.coverageSummary.activeOrderResidualTotal.toFixed(2),
    stagedResidualWithoutPosition:
      schedule.coverageSummary.stagedResidualWithoutPosition.toFixed(2),
    residualLines: schedule.activeOrderResidualSchedule.map((l) => ({
      installmentNumber: l.installmentNumber,
      dueDate: l.dueDate,
      residualAmount: l.residualAmount.toFixed(2),
    })),
    occupiedPositionCount: schedule.occupiedPositionIndexes.length,
    deliveryBlockCount: schedule.stagedDeliveryBlocks.length,
  };
}

async function loadScheduleForOrder(prisma: PrismaClient, requestedOrder: string) {
  const candidates = salesOrderAuditCodeCandidates(requestedOrder);
  const order = await prisma.salesOrder.findFirst({
    where: {
      OR: candidates.flatMap((code) => [
        { orderCode: { equals: code, mode: "insensitive" as const } },
        { externalSalesOrderCode: { equals: code, mode: "insensitive" as const } },
      ]),
    },
    select: { id: true, orderCode: true },
  });
  if (!order) return null;

  const audit = await getOrderFullAudit({
    salesOrderId: order.id,
    orderCode: order.orderCode,
  });
  if (!("ok" in audit) || audit.ok !== true) {
    throw new Error(`Auditoria 360° indisponível para ${order.orderCode}`);
  }

  const projection = projectEffectiveScheduleForOrderAudit({
    salesOrderId: audit.salesOrderId,
    orderCode: audit.orderCode ?? order.orderCode,
    issueDate: audit.salesOrder.issueDate
      ? new Date(audit.salesOrder.issueDate)
      : null,
    paymentTerms: audit.salesOrder.paymentTerms,
    paymentMethod: audit.salesOrder.paymentMethod,
    nomusRawResponse: null,
    totalActiveValue: audit.summary?.activeOrderValue ?? 0,
    items: audit.items,
    receivables: audit.receivables,
    stockDocuments: audit.stockDocuments,
    nfeNumbers: (audit.nfes ?? [])
      .map((n) => n.numero)
      .filter((n): n is string => Boolean(n?.trim())),
    referenceDate: new Date(),
  });

  return {
    salesOrderId: order.id,
    orderCode: order.orderCode,
    schedule: projection.schedule,
  };
}

function runO2cRebuildForOrder(orderCode: string): Promise<{ ok: boolean }> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/rebuildOrderToCashAudit.ts",
        "--mode",
        "apply",
        "--orderCode",
        orderCode,
        "--limit",
        "1",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    child.on("close", (code) => {
      resolvePromise({ ok: code === 0 });
    });
  });
}

export async function runStagedDeliveryScheduleRepair(input: {
  prisma: PrismaClient;
  cli: StagedDeliveryRepairCli;
}): Promise<StagedDeliveryRepairResult> {
  const started = Date.now();
  const notes: string[] = [];

  if (!acquireLock()) {
    return {
      mode: input.cli.mode,
      exitCode: 2,
      lockBlocked: true,
      durationMs: Date.now() - started,
      scanned: 0,
      candidates: 0,
      rebuilt: 0,
      errors: 0,
      items: [],
      notes: [`Lock ativo em ${LOCK_PATH}`],
    };
  }

  try {
    const codes = await listCandidateOrderCodes(input.prisma, input.cli);
    const items: StagedDeliveryRepairCandidate[] = [];
    let errors = 0;
    let rebuilt = 0;

    for (const code of codes) {
      try {
        const loaded = await loadScheduleForOrder(input.prisma, code);
        if (!loaded) continue;
        const candidate = toCandidate(
          loaded.orderCode,
          loaded.salesOrderId,
          loaded.schedule
        );
        if (!candidate) continue;
        items.push(candidate);

        if (input.cli.mode === "apply") {
          const r = await runO2cRebuildForOrder(candidate.orderCode);
          if (r.ok) rebuilt += 1;
          else {
            errors += 1;
            notes.push(`Falha rebuild O2C ${candidate.orderCode}`);
          }
        }
      } catch (e) {
        errors += 1;
        notes.push(`Erro ${code}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (input.cli.mode === "preview") {
      notes.push(
        `${STAGED_DELIVERY_REPAIR_LOG} Preview: sem escrita. Apply reprocessa OrderToCashAudit via rebuild oficial.`
      );
    }

    return {
      mode: input.cli.mode,
      exitCode: errors > 0 ? 1 : 0,
      lockBlocked: false,
      durationMs: Date.now() - started,
      scanned: codes.length,
      candidates: items.length,
      rebuilt,
      errors,
      items,
      notes,
    };
  } finally {
    releaseLock();
  }
}
