import type express from "express";
import type { RequestHandler } from "express";
import {
  collectBrentCommoditySnapshot,
  getLatestBrentSnapshot,
  serializeBrentSnapshotForApi,
} from "@/src/lib/brentCommodityCollection.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

const VIEW_PERMISSION = "materials.view";
const COLLECT_PERMISSION = "materials.edit";

export function registerBrentCommodityRoutes(app: express.Application, guards: AuthGuards): void {
  const { requireAppAuth, requirePermission } = guards;

  app.get(
    "/api/market-intelligence/commodities/brent/latest",
    requireAppAuth,
    requirePermission(VIEW_PERMISSION),
    async (_req, res) => {
      try {
        const snapshot = await getLatestBrentSnapshot();
        if (!snapshot) {
          return res.status(404).json({
            error: "BRENT_SNAPSHOT_NOT_FOUND",
            message: "Nenhuma coleta Brent registrada.",
          });
        }
        return res.json(serializeBrentSnapshotForApi(snapshot));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao consultar Brent.";
        console.error("GET /api/market-intelligence/commodities/brent/latest", error);
        return res.status(500).json({ error: "BRENT_LATEST_FAILED", message });
      }
    }
  );

  app.post(
    "/api/market-intelligence/commodities/brent/collect",
    requireAppAuth,
    requirePermission(COLLECT_PERMISSION),
    async (_req, res) => {
      try {
        const outcome = await collectBrentCommoditySnapshot();
        const snapshot = serializeBrentSnapshotForApi(outcome.snapshot);
        const statusCode = outcome.snapshot.status === "SUCCESS" ? 201 : 200;
        return res.status(statusCode).json({
          action: "created",
          snapshot,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao coletar Brent.";
        console.error("POST /api/market-intelligence/commodities/brent/collect", error);
        return res.status(500).json({ error: "BRENT_COLLECT_FAILED", message });
      }
    }
  );
}
