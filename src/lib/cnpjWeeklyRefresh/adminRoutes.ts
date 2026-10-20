import type { PrismaClient } from "@prisma/client";
import type express from "express";
import type { RequestHandler } from "express";
import { readCnpjWeeklyRefreshConfig } from "./config.js";
import { getCnpjRefreshRunner, startCnpjWeeklyRefreshScheduledJob } from "./job.js";
import { buildCnpjRefreshMonitor } from "./monitor.js";
import { createCnpjRefreshRunner, type CnpjRefreshRunnerDeps } from "./refreshRun.js";
import type { CnpjRefreshStore } from "./store.js";
import { createPrismaCnpjRefreshStore } from "./store.server.js";

export const CNPJ_WEEKLY_REFRESH_ADMIN_BASE = "/api/admin/cnpj-weekly-refresh" as const;
export const CNPJ_WEEKLY_REFRESH_VIEW_PERMISSIONS = ["settings.cnpj_weekly_refresh.view"] as const;
export const CNPJ_WEEKLY_REFRESH_MANAGE_PERMISSIONS = ["settings.cnpj_weekly_refresh.manage"] as const;

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (keys: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{ id?: string | null; userId?: string | null } | null>;
};

export function registerCnpjWeeklyRefreshAdminRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: {
    prisma?: PrismaClient;
    store?: CnpjRefreshStore;
    env?: NodeJS.ProcessEnv;
    startScheduler?: boolean;
    runnerDeps?: CnpjRefreshRunnerDeps;
  }
): void {
  const env = deps.env ?? process.env;
  const config = readCnpjWeeklyRefreshConfig(env);
  const store = deps.store ?? (deps.prisma ? createPrismaCnpjRefreshStore(deps.prisma) : null);
  if (!store) throw new Error("Consulta semanal de CNPJ sem repositório.");
  const runner = deps.runnerDeps
    ? createCnpjRefreshRunner(deps.runnerDeps)
    : deps.prisma
      ? getCnpjRefreshRunner(deps.prisma, env)
      : createCnpjRefreshRunner({ store, config });
  if (deps.startScheduler !== false && deps.prisma) {
    startCnpjWeeklyRefreshScheduledJob(deps.prisma, env);
  }

  const view = guards.requireAnyPermission([...CNPJ_WEEKLY_REFRESH_VIEW_PERMISSIONS]);
  const manage = guards.requireAnyPermission([...CNPJ_WEEKLY_REFRESH_MANAGE_PERMISSIONS]);

  app.get(`${CNPJ_WEEKLY_REFRESH_ADMIN_BASE}/status`, guards.requireAppAuth, view, async (_req, res) => {
    const runs = await store.listRuns(1);
    res.json(buildCnpjRefreshMonitor({ now: new Date(), config, runs }));
  });

  app.get(`${CNPJ_WEEKLY_REFRESH_ADMIN_BASE}/runs`, guards.requireAppAuth, view, async (req, res) => {
    const take = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const runs = await store.listRuns(take);
    res.json({
      runs: runs.map((run) => buildCnpjRefreshMonitor({ now: new Date(), config, runs: [run] }).lastRun),
    });
  });

  app.get(`${CNPJ_WEEKLY_REFRESH_ADMIN_BASE}/runs/:id/changes`, guards.requireAppAuth, view, async (req, res) => {
    const changes = await store.listChanges(String(req.params.id), 50);
    res.json({
      changes: changes.map((change) => ({
        id: change.id,
        cnpj: change.cnpj,
        field: change.field,
        previousValue: change.previousValue,
        nextValue: change.nextValue,
        source: change.source,
        consultedAt: change.consultedAt.toISOString(),
        detectedAt: change.detectedAt.toISOString(),
      })),
    });
  });

  app.post(`${CNPJ_WEEKLY_REFRESH_ADMIN_BASE}/run`, guards.requireAppAuth, manage, async (req, res) => {
    const user = await guards.getCurrentAppUser(req);
    const userId = user?.id ?? user?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "Não autenticado." });
    const started = await runner.startManual(userId);
    if (!started.ok) return res.status(409).json({ error: "Já existe uma consulta de CNPJ em andamento.", code: started.code });
    return res.status(202).json({ runId: started.runId });
  });

  app.post(`${CNPJ_WEEKLY_REFRESH_ADMIN_BASE}/runs/:id/retry-failures`, guards.requireAppAuth, manage, async (req, res) => {
    const user = await guards.getCurrentAppUser(req);
    const userId = user?.id ?? user?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "Não autenticado." });
    const result = await runner.retryFailures(String(req.params.id), userId);
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "NOTHING_TO_RETRY" ? 422 : 409;
      return res.status(status).json({ error: "Não foi possível reprocessar as falhas.", code: result.code });
    }
    return res.status(202).json({ runId: result.runId, retried: result.retried });
  });
}
