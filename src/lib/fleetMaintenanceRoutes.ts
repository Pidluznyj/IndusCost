import type express from "express";
import type { FleetMaintenanceStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  FleetValidationError,
  assertReasonRequired,
  } from "@/src/lib/fleetValidation.js";
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
import { recalculateVehicleOperationalStatus } from "@/src/lib/fleetVehicleStatusOps.js";
import {
  buildFleetListResponse,
  fleetListMeta,
  parseFleetListQuery,
} from "@/src/lib/fleetListQuery.js";
import { handleFleetRouteError } from "@/src/lib/fleetErrors.js";
import { createFleetRouteGuards, type FleetAuthGuards } from "@/src/lib/fleetRouteGuards.js";

type AuthGuards = FleetAuthGuards;

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}


export function registerFleetMaintenanceRoutes(app: express.Express, auth: AuthGuards) {
  const { getCurrentAppUser } = auth;
  const g = createFleetRouteGuards(auth);

  app.get("/api/fleet/maintenances", ...g.view, async (req, res) => {
    try {
      const list = parseFleetListQuery(req.query as Record<string, unknown>);
      const where = buildMaintenanceWhere({
        vehicleId: list.vehicleId || undefined,
        status: list.status || undefined,
        priority: String(req.query.priority ?? "").trim() || undefined,
        maintenanceType: String(req.query.maintenanceType ?? "").trim() || undefined,
        start: list.startDate?.toISOString(),
        end: list.endDate?.toISOString(),
      });
      const orderBy =
        list.sortBy === "scheduledAt"
          ? { scheduledAt: list.sortOrder }
          : { openedAt: list.sortOrder };

      const [total, rows] = await Promise.all([
        prisma.fleetMaintenance.count({ where }),
        prisma.fleetMaintenance.findMany({
          where,
          include: MAINTENANCE_INCLUDE,
          orderBy,
          skip: list.skip,
          take: list.limit,
        }),
      ]);
      res.json(
        buildFleetListResponse(
          "maintenances",
          rows.map(serializeMaintenance),
          fleetListMeta(total, list.page, list.limit)
        )
      );
    } catch (e) {
      handleFleetRouteError(res, e, "GET maintenances", req);
    }
  });

  app.get("/api/fleet/vehicles/:id/maintenances", ...g.view, async (req, res) => {
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
      handleFleetRouteError(res, e, "GET vehicle maintenances", req);
    }
  });

  app.get("/api/fleet/maintenances/:id", ...g.view, async (req, res) => {
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
      handleFleetRouteError(res, e, "GET maintenance", req);
    }
  });

  app.post("/api/fleet/maintenances", ...g.maintenanceManage, async (req, res) => {
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
      handleFleetRouteError(res, e, "POST maintenance", req);
    }
  });

  app.put("/api/fleet/maintenances/:id", ...g.maintenanceManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const maintenance = await updateMaintenance(id, req.body ?? {}, user?.id ?? null);
      res.json({ maintenance });
    } catch (e) {
      handleFleetRouteError(res, e, "PUT maintenance", req);
    }
  });

  app.patch("/api/fleet/maintenances/:id/status", ...g.maintenanceManage, async (req, res) => {
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
        const result = await cancelMaintenance(id, reason!, user?.id ?? null);
        return res.json(result);
      }
      const maintenance = await changeMaintenanceStatus(id, status, user?.id ?? null, reason);
      res.json({ maintenance });
    } catch (e) {
      handleFleetRouteError(res, e, "PATCH maintenance status", req);
    }
  });

  app.post("/api/fleet/maintenances/:id/approve", ...g.maintenanceManage, async (req, res) => {
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
      handleFleetRouteError(res, e, "POST approve maintenance", req);
    }
  });

  app.post("/api/fleet/maintenances/:id/start", ...g.maintenanceManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const maintenance = await startMaintenance(id, user?.id ?? null);
      res.json({ maintenance });
    } catch (e) {
      handleFleetRouteError(res, e, "POST start maintenance", req);
    }
  });

  app.post("/api/fleet/maintenances/:id/complete", ...g.maintenanceManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const result = await completeMaintenance(id, req.body ?? {}, user?.id ?? null);
      res.json(result);
    } catch (e) {
      handleFleetRouteError(res, e, "POST complete maintenance", req);
    }
  });

  app.post("/api/fleet/maintenances/:id/cancel", ...g.maintenanceManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reason = assertReasonRequired(req.body?.reason, "Motivo do cancelamento");
      const user = await getCurrentAppUser(req);
      const result = await cancelMaintenance(id, reason, user?.id ?? null);
      res.json(result);
    } catch (e) {
      handleFleetRouteError(res, e, "POST cancel maintenance", req);
    }
  });

  app.post("/api/fleet/maintenances/:id/generate-cost", ...g.maintenanceManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const result = await generateMaintenanceCost(id, user?.id ?? null);
      res.json(result);
    } catch (e) {
      handleFleetRouteError(res, e, "POST generate-cost", req);
    }
  });

  app.post("/api/fleet/vehicles/:id/recalculate-status", ...g.manage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const result = await recalculateVehicleOperationalStatus(id, {
        userId: user?.id ?? null,
        trigger: "MANUAL_RECALCULATE",
        reason:
          typeof req.body?.reason === "string" && req.body.reason.trim()
            ? req.body.reason.trim()
            : "Recálculo manual do status operacional",
      });
      res.json(result);
    } catch (e) {
      handleFleetRouteError(res, e, "POST recalculate-status", req);
    }
  });
}
