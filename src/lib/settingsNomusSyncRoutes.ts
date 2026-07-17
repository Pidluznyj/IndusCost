import type express from "express";
import type { RequestHandler } from "express";
import { promises as fs } from "fs";
import {
  getNomusDailySyncStatus,
  NomusDailySyncConflictError,
  startNomusDailySyncApply,
} from "@/src/lib/nomusDailySyncRunner.js";
import {
  getNomusAccountsReceivableSyncStatus,
  NomusAccountsReceivableSyncConflictError,
  startNomusAccountsReceivableSyncApply,
} from "@/src/lib/nomusAccountsReceivableSyncRunner.js";
import {
  getNomusAccountsPayableSyncStatus,
  NomusAccountsPayableSyncConflictError,
  startNomusAccountsPayableSyncApply,
} from "@/src/lib/nomusAccountsPayableSyncRunner.js";
import {
  getNomusNfesSyncStatus,
  NomusNfesSyncConflictError,
  startNomusNfesSyncApply,
} from "@/src/lib/nomusNfesSyncRunner.js";
import {
  getNomusStockDocumentsSyncStatus,
  NomusStockDocumentsSyncConflictError,
  startNomusStockDocumentsSyncApply,
} from "@/src/lib/nomusStockDocumentsSyncRunner.js";
import {
  FINANCE_AP_ACTIONS,
  FINANCE_AP_RESOURCE_KEY,
} from "@/src/lib/financeAccountsPayableAccess.js";
import {
  ADMIN_SETTINGS_ACTIONS,
  ADMIN_SETTINGS_RESOURCE_KEYS,
} from "@/src/lib/adminSettingsAccess.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildNomusSourceReconciliationObservabilityStatus,
  loadNomusSourcePresenceDrilldown,
} from "@/src/lib/nomus/nomusSourceReconciliationObservability.server.js";

export type NomusSyncLogSummary = {
  fileName: string;
  kind: string;
  target: string;
  mode: string;
  status: string;
  success: boolean | null;
  exitCode: number | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  sizeBytes: number;
  modifiedAt: string;
  command: string | null;
  metrics: Record<string, number | null>;
  blockedReasons: Record<string, number>;
};

type AuthGuards = {
  requireBootstrapOrAnyPermission?: (permissions: string[]) => RequestHandler;
  /** Piloto P18 — Contas a Pagar sync usa requireResource. */
  requireBootstrapOrResource?: (
    isBootstrap: (req: express.Request) => boolean,
    resourceKey: string,
    action?: string
  ) => RequestHandler;
  isBootstrapAdminRequest?: (req: express.Request) => boolean;
};

export type SettingsNomusSyncRoutesDeps = {
  listNomusSyncLogEntries: () => Promise<
    Array<{ fileName: string; absolutePath: string; sizeBytes: number; modifiedAt: string }>
  >;
  buildNomusSummary: (
    fileMeta: { fileName: string; sizeBytes: number; modifiedAt: string },
    content: string
  ) => NomusSyncLogSummary | null;
  mergeNomusSummaryWithIntegrationRun: (
    summary: NomusSyncLogSummary,
    run: unknown
  ) => NomusSyncLogSummary;
  loadNomusIntegrationRunByBasename: () => Promise<Map<string, unknown>>;
  readNomusSyncLogSafe: (fileNameRaw: string) => Promise<{
    fileName: string;
    absolutePath: string;
    sizeBytes: number;
    modifiedAt: string;
    content: string;
  } | null>;
  buildNomusIntegrationHealthPayload: () => Promise<{ targets: unknown[] }>;
  findNomusIntegrationRunForLog: (
    fileName: string,
    absolutePath: string
  ) => Promise<unknown | null>;
  sanitizeLogContent: (content: string) => string;
  nomusSyncTargets: readonly string[];
  maxNomusLogFilesScan: number;
};

export function registerSettingsNomusSyncRoutes(
  app: express.Express,
  auth: AuthGuards,
  deps: SettingsNomusSyncRoutesDeps
) {
  const isBootstrap = auth.isBootstrapAdminRequest ?? (() => false);
  if (!auth.requireBootstrapOrResource) {
    throw new Error("registerSettingsNomusSyncRoutes requires requireBootstrapOrResource");
  }
  const nomusView = auth.requireBootstrapOrResource(
    isBootstrap,
    ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync,
    ADMIN_SETTINGS_ACTIONS.view
  );

  app.get(
    "/api/integrations/nomus/health",
    nomusView,
    async (_req, res) => {
      try {
        const payload = await deps.buildNomusIntegrationHealthPayload();
        return res.json(payload);
      } catch (error) {
        console.error("GET /api/integrations/nomus/health:", error);
        return res.status(500).json({ error: "Erro ao carregar saúde das integrações Nomus." });
      }
    }
  );

  /** SYNC-09 — métricas/alertas de NomusSourceSyncRun (somente view). */
  app.get(
    "/api/settings/nomus-sync/source-reconciliation-status",
    nomusView,
    async (_req, res) => {
      try {
        const payload = await buildNomusSourceReconciliationObservabilityStatus(prisma);
        return res.json(payload);
      } catch (error) {
        console.error(
          "GET /api/settings/nomus-sync/source-reconciliation-status:",
          error
        );
        return res.status(500).json({
          error: "Erro ao carregar observabilidade de reconciliação Nomus.",
        });
      }
    }
  );

  /** SYNC-09 — drilldown administrativo de presença (sem rawPayload). */
  app.get(
    "/api/settings/nomus-sync/source-reconciliation-records",
    nomusView,
    async (req, res) => {
      try {
        const payload = await loadNomusSourcePresenceDrilldown(
          prisma,
          req.query as Record<string, unknown>
        );
        return res.json(payload);
      } catch (error) {
        console.error(
          "GET /api/settings/nomus-sync/source-reconciliation-records:",
          error
        );
        return res.status(500).json({
          error: "Erro ao consultar registros de presença Nomus.",
        });
      }
    }
  );

  app.get(
    "/api/settings/nomus-sync/logs",
    nomusView,
    async (req, res) => {
      try {
        const rawLimit = Number(req.query.limit);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.trunc(rawLimit))) : 50;
        const modeFilter = String(req.query.mode || "all").toLowerCase();
        const kindFilter = String(req.query.kind || "all").toLowerCase();
        const targetFilter = String(req.query.target || "all").toLowerCase();
        const statusFilter = String(req.query.status || "all").toUpperCase();
        const allowedStatus = new Set(["ALL", "SUCCESS", "FAILED", "UNKNOWN", "SKIPPED"]);
        const normalizedStatusFilter = allowedStatus.has(statusFilter) ? statusFilter : "ALL";
        const allowedTargets = new Set<string>(["all", ...deps.nomusSyncTargets]);
        const normalizedTargetFilter = allowedTargets.has(targetFilter) ? targetFilter : "all";

        const allEntries = await deps.listNomusSyncLogEntries();
        const sorted = allEntries.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
        const integrationByBasename = await deps.loadNomusIntegrationRunByBasename();

        const scanned: NomusSyncLogSummary[] = [];
        let scanCount = 0;
        for (const entry of sorted) {
          if (scanCount >= deps.maxNomusLogFilesScan) break;
          scanCount += 1;
          const raw = await fs.readFile(entry.absolutePath, "utf8");
          const summary = deps.buildNomusSummary(entry, deps.sanitizeLogContent(raw));
          if (!summary) continue;
          const merged = deps.mergeNomusSummaryWithIntegrationRun(
            summary,
            integrationByBasename.get(entry.fileName)
          );
          scanned.push(merged);
        }

        const sortTs = (s: NomusSyncLogSummary) => {
          const stamp = s.createdAt ?? s.finishedAt ?? s.modifiedAt;
          const n = Date.parse(stamp);
          return Number.isFinite(n) ? n : 0;
        };
        scanned.sort((a, b) => sortTs(b) - sortTs(a));

        const summaries: NomusSyncLogSummary[] = [];
        for (const merged of scanned) {
          if (modeFilter !== "all" && merged.mode !== modeFilter) continue;
          if (kindFilter !== "all" && merged.kind !== kindFilter) continue;
          if (normalizedTargetFilter !== "all" && merged.target !== normalizedTargetFilter) continue;
          if (normalizedStatusFilter !== "ALL" && merged.status !== normalizedStatusFilter) continue;
          summaries.push(merged);
          if (summaries.length >= limit) break;
        }

        return res.json(summaries);
      } catch (error) {
        console.error("GET /api/settings/nomus-sync/logs:", error);
        return res.status(500).json({ error: "Erro ao listar logs de sincronização Nomus." });
      }
    }
  );

  app.get(
    "/api/settings/nomus-sync/logs/:fileName",
    nomusView,
    async (req, res) => {
      try {
        const row = await deps.readNomusSyncLogSafe(String(req.params.fileName || ""));
        if (!row) {
          return res.status(404).json({ error: "Log não encontrado." });
        }
        const summary = deps.buildNomusSummary(
          {
            fileName: row.fileName,
            sizeBytes: row.sizeBytes,
            modifiedAt: row.modifiedAt,
          },
          row.content
        );
        const integrationRun = await deps.findNomusIntegrationRunForLog(row.fileName, row.absolutePath);
        const mergedSummary =
          summary && integrationRun
            ? deps.mergeNomusSummaryWithIntegrationRun(summary, integrationRun)
            : summary;
        return res.json({
          fileName: row.fileName,
          sizeBytes: row.sizeBytes,
          modifiedAt: row.modifiedAt,
          summary: mergedSummary,
          content: row.content,
        });
      } catch (error) {
        console.error("GET /api/settings/nomus-sync/logs/:fileName:", error);
        return res.status(500).json({ error: "Erro ao carregar detalhe do log Nomus." });
      }
    }
  );

  const nomusDailySyncManagePermissions = ["settings.nomus.sync"] as const;

  app.get(
    "/api/settings/nomus-sync/daily-status",
    auth.requireBootstrapOrResource(isBootstrap, ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync, ADMIN_SETTINGS_ACTIONS.execute),
    async (_req, res) => {
      try {
        const status = await getNomusDailySyncStatus();
        return res.json(status);
      } catch (error) {
        console.error("GET /api/settings/nomus-sync/daily-status:", error);
        return res.status(500).json({ error: "Erro ao consultar status da rotina diária Nomus." });
      }
    }
  );

  app.post(
    "/api/settings/nomus-sync/daily-run",
    auth.requireBootstrapOrResource(isBootstrap, ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync, ADMIN_SETTINGS_ACTIONS.execute),
    async (_req, res) => {
      try {
        const projectRoot = process.env.INDUSCOST_APP_DIR || process.cwd();
        const result = await startNomusDailySyncApply(projectRoot);
        return res.status(202).json(result);
      } catch (error) {
        if (error instanceof NomusDailySyncConflictError) {
          return res.status(409).json({
            error: error.message,
            message: "Já existe uma rotina Nomus em andamento. Aguarde finalizar antes de iniciar outra.",
          });
        }
        console.error("POST /api/settings/nomus-sync/daily-run:", error);
        return res.status(500).json({
          error: "Não foi possível iniciar a rotina diária Nomus. Verifique logs do servidor.",
        });
      }
    }
  );

  const nomusArSyncViewPermissions = ["settings.nomus.view", "settings.view"] as const;
  const nomusArSyncManagePermissions = ["settings.nomus.sync"] as const;

  app.get(
    "/api/settings/nomus-sync/accounts-receivable-status",
    nomusView,
    async (_req, res) => {
      try {
        const status = await getNomusAccountsReceivableSyncStatus();
        return res.json(status);
      } catch (error) {
        console.error("GET /api/settings/nomus-sync/accounts-receivable-status:", error);
        return res.status(500).json({
          error: "Erro ao consultar status de Contas a Receber Nomus.",
        });
      }
    }
  );

  app.post(
    "/api/settings/nomus-sync/accounts-receivable-run",
    auth.requireBootstrapOrResource(isBootstrap, ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync, ADMIN_SETTINGS_ACTIONS.execute),
    async (_req, res) => {
      try {
        const projectRoot = process.env.INDUSCOST_APP_DIR || process.cwd();
        const result = await startNomusAccountsReceivableSyncApply(projectRoot);
        return res.status(202).json(result);
      } catch (error) {
        if (error instanceof NomusAccountsReceivableSyncConflictError) {
          return res.status(409).json({
            error: error.message,
            message: "Já existe uma sincronização de Contas a Receber em andamento. Aguarde finalizar.",
          });
        }
        console.error("POST /api/settings/nomus-sync/accounts-receivable-run:", error);
        return res.status(500).json({
          error: "Não foi possível iniciar a sincronização de Contas a Receber. Verifique logs do servidor.",
        });
      }
    }
  );

  const apStatusGuard = auth.requireBootstrapOrResource(
    isBootstrap,
    FINANCE_AP_RESOURCE_KEY,
    FINANCE_AP_ACTIONS.view
  );

  const apRunGuard = auth.requireBootstrapOrResource(
    isBootstrap,
    FINANCE_AP_RESOURCE_KEY,
    FINANCE_AP_ACTIONS.execute
  );

  app.get(
    "/api/settings/nomus-sync/accounts-payable-status",
    apStatusGuard,
    async (_req, res) => {
      try {
        const status = await getNomusAccountsPayableSyncStatus();
        return res.json(status);
      } catch (error) {
        console.error("GET /api/settings/nomus-sync/accounts-payable-status:", error);
        return res.status(500).json({
          error: "Erro ao consultar status de Contas a Pagar Nomus.",
        });
      }
    }
  );

  app.post(
    "/api/settings/nomus-sync/accounts-payable-run",
    apRunGuard,
    async (_req, res) => {
      try {
        const projectRoot = process.env.INDUSCOST_APP_DIR || process.cwd();
        const result = await startNomusAccountsPayableSyncApply(projectRoot);
        return res.status(202).json(result);
      } catch (error) {
        if (error instanceof NomusAccountsPayableSyncConflictError) {
          return res.status(409).json({
            error: error.message,
            message: "Já existe uma sincronização de Contas a Pagar em andamento. Aguarde finalizar.",
          });
        }
        console.error("POST /api/settings/nomus-sync/accounts-payable-run:", error);
        return res.status(500).json({
          error: "Não foi possível iniciar a sincronização de Contas a Pagar. Verifique logs do servidor.",
        });
      }
    }
  );

  const nomusNfeSyncViewPermissions = ["settings.nomus.view", "settings.view"] as const;
  const nomusNfeSyncManagePermissions = ["settings.nomus.sync"] as const;

  app.get(
    "/api/settings/nomus-sync/nfes-status",
    nomusView,
    async (_req, res) => {
      try {
        const status = await getNomusNfesSyncStatus();
        return res.json(status);
      } catch (error) {
        console.error("GET /api/settings/nomus-sync/nfes-status:", error);
        return res.status(500).json({
          error: "Erro ao consultar status de NF-e Nomus.",
        });
      }
    }
  );

  app.post(
    "/api/settings/nomus-sync/nfes-run",
    auth.requireBootstrapOrResource(isBootstrap, ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync, ADMIN_SETTINGS_ACTIONS.execute),
    async (_req, res) => {
      try {
        const projectRoot = process.env.INDUSCOST_APP_DIR || process.cwd();
        const result = await startNomusNfesSyncApply(projectRoot);
        return res.status(202).json(result);
      } catch (error) {
        if (error instanceof NomusNfesSyncConflictError) {
          return res.status(409).json({
            error: error.message,
            message: "Já existe uma sincronização de NF-e em andamento. Aguarde finalizar.",
          });
        }
        console.error("POST /api/settings/nomus-sync/nfes-run:", error);
        return res.status(500).json({
          error: "Não foi possível iniciar a sincronização de NF-e. Verifique logs do servidor.",
        });
      }
    }
  );

  app.get(
    "/api/settings/nomus-sync/stock-documents-status",
    nomusView,
    async (_req, res) => {
      try {
        const status = await getNomusStockDocumentsSyncStatus();
        return res.json(status);
      } catch (error) {
        console.error("GET /api/settings/nomus-sync/stock-documents-status:", error);
        return res.status(500).json({
          error: "Erro ao consultar status de Documentos de Saída Nomus.",
        });
      }
    }
  );

  app.post(
    "/api/settings/nomus-sync/stock-documents-run",
    auth.requireBootstrapOrResource(
      isBootstrap,
      ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync,
      ADMIN_SETTINGS_ACTIONS.execute
    ),
    async (_req, res) => {
      try {
        const projectRoot = process.env.INDUSCOST_APP_DIR || process.cwd();
        const result = await startNomusStockDocumentsSyncApply(projectRoot);
        return res.status(202).json(result);
      } catch (error) {
        if (error instanceof NomusStockDocumentsSyncConflictError) {
          return res.status(409).json({
            error: error.message,
            message:
              "Já existe uma sincronização de Documentos de Saída em andamento. Aguarde finalizar.",
          });
        }
        console.error("POST /api/settings/nomus-sync/stock-documents-run:", error);
        return res.status(500).json({
          error:
            "Não foi possível iniciar a sincronização de Documentos de Saída. Verifique logs do servidor.",
        });
      }
    }
  );
}
