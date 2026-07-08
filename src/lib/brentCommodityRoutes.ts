import type express from "express";
import type { RequestHandler } from "express";
import {
  collectBrentCommoditySnapshot,
  getLatestBrentSnapshot,
  serializeBrentSnapshotForApi,
} from "@/src/lib/brentCommodityCollection.js";
import {
  getRegisteredScheduledJob,
  listRegisteredScheduledJobs,
} from "@/src/lib/brentCommodityJobRegistry.js";
import { startBrentCommodityScheduledJob } from "@/src/lib/brentCommodityScheduledJob.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

const VIEW_PERMISSION = "materials.view";
const COLLECT_PERMISSION = "materials.edit";

export function registerBrentCommodityRoutes(app: express.Application, guards: AuthGuards): void {
  const { requireAppAuth, requirePermission } = guards;

  startBrentCommodityScheduledJob();

  app.get(
    "/api/market-intelligence/commodities/jobs",
    requireAppAuth,
    requirePermission(VIEW_PERMISSION),
    (_req, res) => res.json({ jobs: listRegisteredScheduledJobs() })
  );

  app.get(
    "/api/market-intelligence/commodities/jobs/:jobId",
    requireAppAuth,
    requirePermission(VIEW_PERMISSION),
    (req, res) => {
      const job = getRegisteredScheduledJob(String(req.params.jobId ?? ""));
      if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
      return res.json(job);
    }
  );

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
        const outcome = await collectBrentCommoditySnapshot({ trigger: "MANUAL" });
        if (outcome.action === "skipped") {
          return res.status(200).json({
            action: "skipped",
            reason: outcome.reason,
            slot: outcome.slot,
            quoteDate: outcome.quoteDate,
            existingSnapshotId: outcome.existingSnapshotId,
          });
        }

        const statusCode = outcome.snapshot.status === "SUCCESS" ? 201 : 200;
        return res.status(statusCode).json({
          action: "created",
          slot: outcome.slot,
          quoteDate: outcome.quoteDate,
          snapshot: serializeBrentSnapshotForApi(outcome.snapshot),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao coletar Brent.";
        console.error("POST /api/market-intelligence/commodities/brent/collect", error);
        return res.status(500).json({ error: "BRENT_COLLECT_FAILED", message });
      }
    }
  );
}
