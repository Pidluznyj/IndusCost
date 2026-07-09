import type express from "express";
import type { RequestHandler } from "express";
import {
  collectPtaxSnapshot,
  getLatestPtaxSnapshot,
  serializePtaxSnapshotForApi,
} from "./ptaxSnapshotCollection.js";
import { startPtaxSnapshotScheduledJob } from "./ptaxSnapshotJob.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

export function registerPtaxSnapshotRoutes(app: express.Application, guards: AuthGuards): void {
  const { requireAppAuth, requirePermission } = guards;
  startPtaxSnapshotScheduledJob();

  app.get(
    "/api/market-intelligence/ptax/latest",
    requireAppAuth,
    requirePermission("materials.view"),
    async (_req, res) => {
      try {
        const snapshot = await getLatestPtaxSnapshot();
        if (!snapshot) return res.status(404).json({ error: "PTAX_SNAPSHOT_NOT_FOUND" });
        return res.json(serializePtaxSnapshotForApi(snapshot));
      } catch (error) {
        console.error("GET /api/market-intelligence/ptax/latest", error);
        return res.status(500).json({ error: "PTAX_LATEST_FAILED" });
      }
    }
  );

  app.post(
    "/api/market-intelligence/ptax/collect",
    requireAppAuth,
    requirePermission("materials.edit"),
    async (_req, res) => {
      try {
        const outcome = await collectPtaxSnapshot({ trigger: "MANUAL" });
        if (outcome.action === "skipped") {
          return res.status(200).json({
            action: "skipped",
            reason: outcome.reason,
            quoteDate: outcome.quoteDate,
            existingSnapshotId: outcome.existingSnapshotId,
          });
        }
        return res.status(outcome.snapshot.status === "SUCCESS" ? 201 : 200).json({
          action: "created",
          quoteDate: outcome.quoteDate,
          snapshot: serializePtaxSnapshotForApi(outcome.snapshot),
        });
      } catch (error) {
        console.error("POST /api/market-intelligence/ptax/collect", error);
        return res.status(500).json({ error: "PTAX_COLLECT_FAILED" });
      }
    }
  );
}
