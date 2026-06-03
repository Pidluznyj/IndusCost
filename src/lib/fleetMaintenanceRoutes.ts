import type express from "express";
import type { FleetMaintenanceStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { FleetValidationError, assertReasonRequired } from "@/src/lib/fleetValidation.js";
import {
  MAINTENANCE_INCLUDE,
  approveMaintenance,
  buildMaintenanceWhere,
  cancelMaintenance,
  changeMaintenanceStatus,
  completeMaintenance,
  createMaintenance,
  generateMaintenanceCost,
  getMaintenanceOrThrow,
  serializeMaintenance,
  startMaintenance,
  updateMaintenance,
} from "@/src/lib/fleetMaintenanceOps.js";

type AuthGuards = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (p: string) => express.RequestHandler;
  requireAnyPermission: (ps: string[]) => express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function fleetError(res: express.Response, e: unknown, logLabel: string) {
  if (e instanceof FleetValidationError) return res.status(400).json({ error: e.message });
  console.error(logLabel, e);
  return res.status(500).json({ error: e instanceof Error ? e.message : "Erro interno." });
}

export function registerFleetMaintenanceRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requirePermission, requireAnyPermission, getCurrentAppUser } = auth;
  const fleetView = [requireAppAuth, requirePermission("fleet.view")] as express.RequestHandler[];
  const fleetMaintManage = [
    requireAppAuth,
    requireAnyPermission(["fleet.maintenance.manage", "fleet.manage"]),
  ] as express.RequestHandler[];

  app.get("/api/fleet/maintenances", ...fleetView, async (req, res) => {
    try {
      const where = buildMaintenanceWhere({
        vehicleId: String(req.query.vehicleId ?? "").trim() || undefined,
        status: String(req.query.status ?? "").trim() || undefined,
        priority: String(req.query.priority ?? "").trim() || undefined,
        maintenanceType: String(req.query.maintenanceType ?? "").trim() || undefined,
        start: String(req.query.start ?? "").trim() || undefined,
        end: String(req.query.end ?? "").trim() || undefined,
      });
      const rows = await prisma.fleetMaintenance.findMany({
        where,
        include: MAINTENANCE_INCLUDE,
        orderBy: { openedAt: "desc" },
        take: 300,
      });
      res.json({ maintenances: rows.map(serializeMaintenance) });
    } catch (e) {
      fleetError(res, e, "GET maintenances");
    }
  });

  app.get("/api/fleet/vehicles/:id/maintenances", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const { prisma } = await import("@/src/lib/prisma.js");
      const { MAINTENANCE_INCLUDE, serializeMaintenance: serialize } = await import(
        "@/src/lib/fleetMaintenanceOps.js"
      );
      const rows = await prisma.fleetMaintenance.findMany({
        where: { vehicleId: id },
        include: MAINTENANCE_INCLUDE,
        orderBy: { openedAt: "desc" },
        take: 100,
      });
      res.json({ maintenances: rows.map(serialize) });
    } catch (e) {
      fleetError(res, e, "GET vehicle maintenances");
    }
  });

  app.get("/api/fleet/maintenances/:id", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const m = await getMaintenanceOrThrow(id);
      const logs = await prisma.fleetAuditLog.findMany({
        where: { entityType: "FleetMaintenance", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 40,
      });
      res.json({ maintenance: serializeMaintenance(m), auditLogs: logs });
    } catch (e) {
      fleetError(res, e, "GET maintenance");
    }
  });

  app.post("/api/fleet/maintenances", ...fleetMaintManage, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });
      const user = await getCurrentAppUser(req);
      const maintenance = await createMaintenance({
        vehicleId,
        reservationId: isUuid(body.reservationId) ? body.reservationId : null,
        body,
        userId: user?.id ?? null,
      });
      res.status(201).json({ maintenance });
    } catch (e) {
      fleetError(res, e, "POST maintenance");
    }
  });

  app.put("/api/fleet/maintenances/:id", ...fleetMaintManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const maintenance = await updateMaintenance(id, req.body ?? {}, user?.id ?? null);
      res.json({ maintenance });
    } catch (e) {
      fleetError(res, e, "PUT maintenance");
    }
  });

  app.patch("/api/fleet/maintenances/:id/status", ...fleetMaintManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const status = req.body?.status as FleetMaintenanceStatus;
      if (!status) return res.status(400).json({ error: "Status é obrigatório." });
      const user = await getCurrentAppUser(req);
      const reason =
        status === "CANCELED"
          ? assertReasonRequired(req.body?.reason, "Motivo do cancelamento")
          : undefined;
      if (status === "CANCELED") {
        const maintenance = await cancelMaintenance(id, reason!, user?.id ?? null);
        return res.json({ maintenance });
      }
      const maintenance = await changeMaintenanceStatus(id, status, user?.id ?? null, reason);
      res.json({ maintenance });
    } catch (e) {
      fleetError(res, e, "PATCH maintenance status");
    }
  });

  app.post("/api/fleet/maintenances/:id/approve", ...fleetMaintManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const maintenance = await approveMaintenance(
        id,
        user?.email ?? user?.name ?? null,
        user?.id ?? null
      );
      res.json({ maintenance });
    } catch (e) {
      fleetError(res, e, "POST approve maintenance");
    }
  });

  app.post("/api/fleet/maintenances/:id/start", ...fleetMaintManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const maintenance = await startMaintenance(id, user?.id ?? null);
      res.json({ maintenance });
    } catch (e) {
      fleetError(res, e, "POST start maintenance");
    }
  });

  app.post("/api/fleet/maintenances/:id/complete", ...fleetMaintManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const result = await completeMaintenance(id, req.body ?? {}, user?.id ?? null);
      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST complete maintenance");
    }
  });

  app.post("/api/fleet/maintenances/:id/cancel", ...fleetMaintManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reason = assertReasonRequired(req.body?.reason, "Motivo do cancelamento");
      const user = await getCurrentAppUser(req);
      const maintenance = await cancelMaintenance(id, reason, user?.id ?? null);
      res.json({ maintenance });
    } catch (e) {
      fleetError(res, e, "POST cancel maintenance");
    }
  });

  app.post("/api/fleet/maintenances/:id/generate-cost", ...fleetMaintManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const result = await generateMaintenanceCost(id, user?.id ?? null);
      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST generate-cost");
    }
  });
}
