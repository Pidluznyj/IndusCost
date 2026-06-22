import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildNomusAutoApplyBomDashboard,
  normalizeAutoApplyFilter,
} from "@/src/lib/nomusAutoApplyBomDashboard.js";
import {
  getNomusAutoApplyDashboardRevalidationStatus,
  recoverNomusAutoApplyDashboardRevalidationJobsOnStartup,
  startNomusAutoApplyDashboardRevalidationJob,
} from "@/src/lib/nomusAutoApplyDashboardRevalidationJob.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

const VIEW_PERMISSIONS = [
  "products.view",
  "products.tab.bom",
  "products.tab.tree",
  "products.tab.cost",
  "products.edit",
];

export function registerNomusAutoApplyBomDashboardRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = guards;

  void recoverNomusAutoApplyDashboardRevalidationJobsOnStartup().catch((error) => {
    console.error("[nomus-auto-apply-dashboard] startup recovery failed", error);
  });

  app.get(
    "/api/nomus/auto-apply-bom-dashboard",
    requireAppAuth,
    requireAnyPermission(VIEW_PERMISSIONS),
    async (req, res) => {
      try {
        const filter = normalizeAutoApplyFilter(
          req.query.filter != null ? String(req.query.filter) : undefined
        );
        const search =
          req.query.search != null && String(req.query.search).trim()
            ? String(req.query.search).trim()
            : undefined;

        const revalidateQuery = String(req.query.revalidate ?? "").trim();
        const syncRevalidate = revalidateQuery === "1" || revalidateQuery === "true";
        const preferSnapshotQuery = String(req.query.preferSnapshot ?? "").trim();
        const preferSnapshot = preferSnapshotQuery !== "0" && !syncRevalidate;
        const result = await buildNomusAutoApplyBomDashboard({
          filter,
          search,
          revalidateBlocked: syncRevalidate,
          preferSnapshot,
        });
        return res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Erro ao montar dashboard de auto apply BOM Nomus.";
        console.error("GET /api/nomus/auto-apply-bom-dashboard", error);
        return res.status(500).json({
          error: "AUTO_APPLY_BOM_DASHBOARD_FAILED",
          message,
        });
      }
    }
  );

  app.post(
    "/api/nomus/auto-apply-bom-dashboard/revalidation/start",
    requireAppAuth,
    requireAnyPermission(VIEW_PERMISSIONS),
    async (req, res) => {
      try {
        const auth = await getCurrentAppUser(req);
        const started = await startNomusAutoApplyDashboardRevalidationJob({
          createdByUserId: auth?.id ?? null,
        });
        return res.json(started);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao iniciar revalidação do painel.";
        console.error("POST /api/nomus/auto-apply-bom-dashboard/revalidation/start", error);
        return res.status(500).json({
          error: "AUTO_APPLY_BOM_DASHBOARD_REVALIDATION_START_FAILED",
          message,
        });
      }
    }
  );

  app.get(
    "/api/nomus/auto-apply-bom-dashboard/revalidation/status",
    requireAppAuth,
    requireAnyPermission(VIEW_PERMISSIONS),
    async (_req, res) => {
      try {
        const status = await getNomusAutoApplyDashboardRevalidationStatus();
        return res.json(status);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao consultar status da revalidação.";
        console.error("GET /api/nomus/auto-apply-bom-dashboard/revalidation/status", error);
        return res.status(500).json({
          error: "AUTO_APPLY_BOM_DASHBOARD_REVALIDATION_STATUS_FAILED",
          message,
        });
      }
    }
  );
}
