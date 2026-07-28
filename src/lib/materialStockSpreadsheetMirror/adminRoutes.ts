/**
 * API administrativa do espelho planilha — não exposta ao operador de estoque.
 */
import { randomUUID } from "node:crypto";
import type express from "express";
import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import { readMaterialStockSpreadsheetMirrorConfig } from "./config.js";
import { createMaterialStockSpreadsheetOutboxRepository } from "./repository.server.js";
import { runMaterialStockSpreadsheetMirrorWorker } from "./worker.server.js";
import type { MaterialStockSpreadsheetMirrorStatus } from "./types.js";

export const MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE =
  "/api/admin/material-stock-spreadsheet-mirror" as const;

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (keys: string[]) => RequestHandler;
};

type RouteDeps = {
  prisma: PrismaClient;
};

function serializeOutbox(row: {
  id: string;
  materialId: string;
  materialCode: string;
  eventType: string;
  status: string;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lastAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  syncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    materialId: row.materialId,
    materialCode: row.materialCode,
    eventType: row.eventType,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.availableAt.toISOString(),
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerMaterialStockSpreadsheetMirrorAdminRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: RouteDeps
): void {
  const { requireAppAuth, requireAnyPermission } = guards;
  const viewPerms = ["settings.material_stock_mirror.view"] as const;
  const managePerms = ["settings.material_stock_mirror.manage"] as const;
  const repo = () => createMaterialStockSpreadsheetOutboxRepository(deps.prisma);

  // Inicia scheduler ao registrar rotas (idempotente).
  void import("./job.js").then(({ startMaterialStockSpreadsheetMirrorScheduledJob }) => {
    startMaterialStockSpreadsheetMirrorScheduledJob(deps.prisma);
  });

  app.get(
    `${MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE}/status`,
    requireAppAuth,
    requireAnyPermission([...viewPerms]),
    async (_req, res) => {
      try {
        const config = readMaterialStockSpreadsheetMirrorConfig();
        const repository = repo();
        const [pending, processing, error, latest] = await Promise.all([
          deps.prisma.materialStockSpreadsheetOutbox.count({
            where: { status: "PENDING" },
          }),
          deps.prisma.materialStockSpreadsheetOutbox.count({
            where: { status: "PROCESSING" },
          }),
          deps.prisma.materialStockSpreadsheetOutbox.count({
            where: { status: "ERROR" },
          }),
          repository.findLatestSynced(),
        ]);
        return res.status(200).json({
          enabled: config.enabled,
          configured: Boolean(config.webhookUrl && config.webhookSecret),
          counts: { pending, processing, error },
          lastSyncedAt: latest?.syncedAt?.toISOString() ?? null,
          lastSyncedMaterialCode: latest?.materialCode ?? null,
        });
      } catch (error) {
        console.error(
          `GET ${MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE}/status`,
          error instanceof Error ? error.message : "erro"
        );
        return res.status(500).json({ error: "STATUS_FAILED" });
      }
    }
  );

  app.get(
    `${MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE}/outbox`,
    requireAppAuth,
    requireAnyPermission([...viewPerms]),
    async (req, res) => {
      try {
        const statusRaw = String(req.query.status ?? "").trim().toUpperCase();
        const status =
          statusRaw === "ACTIVE" ||
          statusRaw === "PENDING" ||
          statusRaw === "PROCESSING" ||
          statusRaw === "SYNCED" ||
          statusRaw === "ERROR"
            ? (statusRaw as MaterialStockSpreadsheetMirrorStatus | "ACTIVE")
            : null;
        const page = Number(req.query.page ?? 1);
        const pageSize = Number(req.query.pageSize ?? 20);
        const result = await repo().list({
          status,
          page: Number.isFinite(page) ? page : 1,
          pageSize: Number.isFinite(pageSize) ? pageSize : 20,
        });
        return res.status(200).json({
          page: Math.max(1, Number.isFinite(page) ? page : 1),
          pageSize: Math.min(100, Math.max(1, Number.isFinite(pageSize) ? pageSize : 20)),
          total: result.total,
          rows: result.rows.map(serializeOutbox),
        });
      } catch (error) {
        console.error(
          `GET ${MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE}/outbox`,
          error instanceof Error ? error.message : "erro"
        );
        return res.status(500).json({ error: "LIST_FAILED" });
      }
    }
  );

  app.post(
    `${MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE}/outbox/:id/retry`,
    requireAppAuth,
    requireAnyPermission([...managePerms]),
    async (req, res) => {
      try {
        const id = String(req.params.id ?? "").trim();
        const row = await repo().requeue(id, {
          availableAt: new Date(),
          idempotencyKey: randomUUID(),
        });
        if (!row) {
          return res.status(404).json({ error: "NOT_FOUND" });
        }
        return res.status(200).json({ ok: true, row: serializeOutbox(row) });
      } catch (error) {
        console.error(
          `POST ${MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE}/outbox/:id/retry`,
          error instanceof Error ? error.message : "erro"
        );
        return res.status(500).json({ error: "RETRY_FAILED" });
      }
    }
  );

  app.post(
    `${MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE}/drain`,
    requireAppAuth,
    requireAnyPermission([...managePerms]),
    async (_req, res) => {
      try {
        const config = readMaterialStockSpreadsheetMirrorConfig();
        const result = await runMaterialStockSpreadsheetMirrorWorker({
          repository: repo(),
          workerId: `admin-drain:${randomUUID()}`,
          maxJobs: config.workerBatchSize,
        });
        return res.status(200).json({
          ok: true,
          processed: result.processed,
          synced: result.synced,
          retried: result.retried,
          errored: result.errored,
        });
      } catch (error) {
        console.error(
          `POST ${MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE}/drain`,
          error instanceof Error ? error.message : "erro"
        );
        return res.status(500).json({ error: "DRAIN_FAILED" });
      }
    }
  );
}
