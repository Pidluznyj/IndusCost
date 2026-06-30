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
  requireBootstrapOrAnyPermission: (permissions: string[]) => RequestHandler;
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
  const { requireBootstrapOrAnyPermission } = auth;

  app.get(
    "/api/integrations/nomus/health",
    requireBootstrapOrAnyPermission(["settings.nomus.view", "settings.view"]),
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

  app.get(
    "/api/settings/nomus-sync/logs",
    requireBootstrapOrAnyPermission(["settings.nomus.view", "settings.view"]),
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
    requireBootstrapOrAnyPermission(["settings.nomus.view", "settings.view"]),
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

  const nomusDailySyncManagePermissions = ["settings.nomus.sync", "settings.view"] as const;

  app.get(
    "/api/settings/nomus-sync/daily-status",
    requireBootstrapOrAnyPermission([...nomusDailySyncManagePermissions]),
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
    requireBootstrapOrAnyPermission([...nomusDailySyncManagePermissions]),
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
  const nomusArSyncManagePermissions = ["settings.nomus.sync", "settings.view"] as const;

  app.get(
    "/api/settings/nomus-sync/accounts-receivable-status",
    requireBootstrapOrAnyPermission([...nomusArSyncViewPermissions]),
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
    requireBootstrapOrAnyPermission([...nomusArSyncManagePermissions]),
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

  const nomusApSyncViewPermissions = ["settings.nomus.view", "settings.view"] as const;
  const nomusApSyncManagePermissions = ["settings.nomus.sync", "settings.view"] as const;

  app.get(
    "/api/settings/nomus-sync/accounts-payable-status",
    requireBootstrapOrAnyPermission([...nomusApSyncViewPermissions]),
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
    requireBootstrapOrAnyPermission([...nomusApSyncManagePermissions]),
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
  const nomusNfeSyncManagePermissions = ["settings.nomus.sync", "settings.view"] as const;

  app.get(
    "/api/settings/nomus-sync/nfes-status",
    requireBootstrapOrAnyPermission([...nomusNfeSyncViewPermissions]),
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
    requireBootstrapOrAnyPermission([...nomusNfeSyncManagePermissions]),
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
}
