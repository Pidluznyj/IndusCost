import type express from "express";
import type { RequestHandler } from "express";
import {
  collectBrentCommoditySnapshot,
  getLatestBrentSnapshot,
  serializeBrentSnapshotForApi,
} from "./brentCommodityCollection.js";
import {
  getRegisteredScheduledJob,
  listRegisteredScheduledJobs,
  startBrentCommodityScheduledJob,
} from "./brentCommodityJob.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

export function registerBrentCommodityRoutes(app: express.Application, guards: AuthGuards): void {
  const { requireAppAuth, requirePermission } = guards;
  startBrentCommodityScheduledJob();

  app.get("/api/market-intelligence/commodities/jobs", requireAppAuth, requirePermission("materials.view"), (_req, res) =>
    res.json({ jobs: listRegisteredScheduledJobs() })
  );

  app.get("/api/market-intelligence/commodities/jobs/:jobId", requireAppAuth, requirePermission("materials.view"), (req, res) => {
    const job = getRegisteredScheduledJob(String(req.params.jobId ?? ""));
    return job ? res.json(job) : res.status(404).json({ error: "JOB_NOT_FOUND" });
  });

  app.get("/api/market-intelligence/commodities/brent/latest", requireAppAuth, requirePermission("materials.view"), async (_req, res) => {
    try {
      const snapshot = await getLatestBrentSnapshot();
      if (!snapshot) return res.status(404).json({ error: "BRENT_SNAPSHOT_NOT_FOUND" });
      return res.json(serializeBrentSnapshotForApi(snapshot));
    } catch (error) {
      console.error("GET /api/market-intelligence/commodities/brent/latest", error);
      return res.status(500).json({ error: "BRENT_LATEST_FAILED" });
    }
  });

  app.post("/api/market-intelligence/commodities/brent/collect", requireAppAuth, requirePermission("materials.edit"), async (_req, res) => {
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
      return res.status(outcome.snapshot.status === "SUCCESS" ? 201 : 200).json({
        action: "created",
        slot: outcome.slot,
        quoteDate: outcome.quoteDate,
        snapshot: serializeBrentSnapshotForApi(outcome.snapshot),
      });
    } catch (error) {
      console.error("POST /api/market-intelligence/commodities/brent/collect", error);
      return res.status(500).json({ error: "BRENT_COLLECT_FAILED" });
    }
  });
}
