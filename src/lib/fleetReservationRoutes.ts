import type express from "express";
import { prisma } from "@/src/lib/prisma.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { hasPermission } from "@/src/lib/appAuth.js";
import {
  FleetValidationError,
  assertReasonRequired,
  fleetValidationHttpStatus,
} from "@/src/lib/fleetValidation.js";
import { writeFleetAuditLog } from "@/src/lib/fleetService.js";
import { performCheckin, performCheckout } from "@/src/lib/fleetUsageOps.js";
import {
  buildReservationWhere,
  canUserCancelReservation,
  getReservationOrThrow,
  listAvailableVehicles,
  RESERVATION_INCLUDE,
  syncVehicleStatusAfterReservationChange,
  validateReservationFull,
} from "@/src/lib/fleetReservationOps.js";
import {
  buildFleetListResponse,
  fleetListMeta,
  parseFleetListQuery,
} from "@/src/lib/fleetListQuery.js";
import { createFleetRouteGuards, type FleetAuthGuards } from "@/src/lib/fleetRouteGuards.js";

type AuthGuards = FleetAuthGuards;

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function fleetError(res: express.Response, e: unknown, logLabel: string) {
  if (e instanceof FleetValidationError) {
    return res.status(fleetValidationHttpStatus(e.message)).json({ error: e.message });
  }
  console.error(logLabel, e);
  return res.status(500).json({ error: e instanceof Error ? e.message : "Erro interno." });
}

export function registerFleetReservationRoutes(app: express.Express, auth: AuthGuards) {
  const { getCurrentAppUser } = auth;
  const g = createFleetRouteGuards(auth);

  app.get("/api/fleet/availability", ...g.view, async (req, res) => {
    try {
      const start = new Date(String(req.query.start ?? ""));
      const end = new Date(String(req.query.end ?? ""));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: "Parâmetros start e end são obrigatórios." });
      }
      const vehicles = await listAvailableVehicles({
        start,
        end,
        vehicleType: String(req.query.vehicleType ?? "").trim() || undefined,
        unit: String(req.query.unit ?? "").trim() || undefined,
        costCenter: String(req.query.costCenter ?? "").trim() || undefined,
      });
      res.json({ vehicles });
    } catch (e) {
      fleetError(res, e, "GET availability");
    }
  });

  app.get("/api/fleet/reservations", ...g.view, async (req, res) => {
    try {
      const list = parseFleetListQuery(req.query as Record<string, unknown>);
      const where = buildReservationWhere({
        vehicleId: list.vehicleId || undefined,
        driverId: list.driverId || undefined,
        status: list.status || undefined,
        start: list.startDate?.toISOString(),
        end: list.endDate?.toISOString(),
      });
      const orderBy =
        list.sortBy === "endDateTime"
          ? { endDateTime: list.sortOrder }
          : { startDateTime: list.sortOrder };

      const [total, reservations] = await Promise.all([
        prisma.fleetReservation.count({ where }),
        prisma.fleetReservation.findMany({
          where,
          include: RESERVATION_INCLUDE,
          orderBy,
          skip: list.skip,
          take: list.limit,
        }),
      ]);
      res.json(
        buildFleetListResponse("reservations", reservations, fleetListMeta(total, list.page, list.limit))
      );
    } catch (e) {
      fleetError(res, e, "GET reservations");
    }
  });

  app.get("/api/fleet/reservations/:id", ...g.view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reservation = await getReservationOrThrow(id);
      const logs = await prisma.fleetAuditLog.findMany({
        where: { entityType: "FleetReservation", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      res.json({ reservation, auditLogs: logs });
    } catch (e) {
      fleetError(res, e, "GET reservation");
    }
  });

  app.post("/api/fleet/reservations", ...g.reservationsCreate, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });
      const driverId = isUuid(body.driverId) ? body.driverId : null;
      const startDateTime = new Date(body.startDateTime);
      const endDateTime = new Date(body.endDateTime);
      if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
        return res.status(400).json({ error: "Datas de reserva inválidas." });
      }

      await validateReservationFull({ vehicleId, driverId, startDateTime, endDateTime });

      const user = await getCurrentAppUser(req);
      const created = await prisma.fleetReservation.create({
        data: {
          vehicleId,
          driverId,
          requesterUserId: user?.id ?? null,
          startDateTime,
          endDateTime,
          destination: body.destination?.trim?.() ?? null,
          reason: body.reason?.trim?.() ?? null,
          costCenter: body.costCenter?.trim?.() ?? null,
          status: "PENDING_APPROVAL",
          approvalStatus: "PENDING",
          notes: body.notes?.trim?.() ?? null,
        },
        include: RESERVATION_INCLUDE,
      });

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: created.id,
        action: "CREATE",
        newValue: JSON.stringify({ status: created.status, vehicleId }),
        userId: user?.id ?? null,
      });

      res.status(201).json({ reservation: created });
    } catch (e) {
      fleetError(res, e, "POST reservation");
    }
  });

  app.put("/api/fleet/reservations/:id", ...g.reservationsCreate, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await getReservationOrThrow(id);
      if (!["REQUESTED", "PENDING_APPROVAL"].includes(existing.status)) {
        return res.status(400).json({ error: "Somente reserva pendente pode ser editada." });
      }

      const body = req.body ?? {};
      const vehicleId = isUuid(body.vehicleId) ? body.vehicleId : existing.vehicleId;
      const driverId = isUuid(body.driverId) ? body.driverId : existing.driverId;
      const startDateTime = body.startDateTime
        ? new Date(body.startDateTime)
        : existing.startDateTime;
      const endDateTime = body.endDateTime ? new Date(body.endDateTime) : existing.endDateTime;

      await validateReservationFull({
        vehicleId,
        driverId,
        startDateTime,
        endDateTime,
        excludeReservationId: id,
      });

      const user = await getCurrentAppUser(req);
      const updated = await prisma.fleetReservation.update({
        where: { id },
        data: {
          vehicleId,
          driverId,
          startDateTime,
          endDateTime,
          destination:
            body.destination !== undefined ? (body.destination?.trim?.() ?? null) : undefined,
          reason: body.reason !== undefined ? (body.reason?.trim?.() ?? null) : undefined,
          costCenter:
            body.costCenter !== undefined ? (body.costCenter?.trim?.() ?? null) : undefined,
          notes: body.notes !== undefined ? (body.notes?.trim?.() ?? null) : undefined,
        },
        include: RESERVATION_INCLUDE,
      });

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: id,
        action: "UPDATE",
        userId: user?.id ?? null,
      });

      res.json({ reservation: updated });
    } catch (e) {
      fleetError(res, e, "PUT reservation");
    }
  });

  app.patch("/api/fleet/reservations/:id/approve", ...g.reservationsApprove, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await getReservationOrThrow(id);
      if (!["REQUESTED", "PENDING_APPROVAL"].includes(existing.status)) {
        return res.status(400).json({ error: "Reserva não pode ser aprovada neste status." });
      }

      await validateReservationFull({
        vehicleId: existing.vehicleId,
        driverId: existing.driverId,
        startDateTime: existing.startDateTime,
        endDateTime: existing.endDateTime,
        excludeReservationId: id,
      });

      const user = await getCurrentAppUser(req);
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.fleetReservation.update({
          where: { id },
          data: {
            status: "APPROVED",
            approvalStatus: "APPROVED",
            approvedBy: user?.email ?? user?.name ?? null,
            approvedAt: new Date(),
          },
          include: RESERVATION_INCLUDE,
        });
        await tx.fleetVehicle.update({
          where: { id: existing.vehicleId },
          data: { status: "RESERVED" },
        });
        return r;
      });

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: id,
        action: "APPROVE",
        oldValue: existing.status,
        newValue: updated.status,
        userId: user?.id ?? null,
      });

      res.json({ reservation: updated });
    } catch (e) {
      fleetError(res, e, "PATCH approve");
    }
  });

  app.patch("/api/fleet/reservations/:id/reject", ...g.reservationsApprove, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reason = assertReasonRequired(req.body?.reason, "Motivo da rejeição");
      const existing = await getReservationOrThrow(id);
      if (!["REQUESTED", "PENDING_APPROVAL"].includes(existing.status)) {
        return res.status(400).json({ error: "Reserva não pode ser rejeitada neste status." });
      }

      const user = await getCurrentAppUser(req);
      const updated = await prisma.fleetReservation.update({
        where: { id },
        data: {
          status: "REJECTED",
          approvalStatus: "REJECTED",
          rejectionReason: reason,
        },
        include: RESERVATION_INCLUDE,
      });

      await syncVehicleStatusAfterReservationChange(existing.vehicleId);

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: id,
        action: "REJECT",
        oldValue: existing.status,
        newValue: updated.status,
        reason,
        userId: user?.id ?? null,
      });

      res.json({ reservation: updated });
    } catch (e) {
      fleetError(res, e, "PATCH reject");
    }
  });

  app.patch("/api/fleet/reservations/:id/cancel", ...g.reservationsCreate, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reason = assertReasonRequired(req.body?.reason, "Motivo do cancelamento");
      const existing = await getReservationOrThrow(id);
      if (existing.status === "IN_USE") {
        return res.status(400).json({ error: "Reserva em uso não pode ser cancelada." });
      }

      const user = await getCurrentAppUser(req);
      const canManage = user ? hasPermission(user, "fleet.manage") : false;
      if (!canUserCancelReservation(existing, user?.id ?? null, canManage)) {
        return res.status(403).json({ error: "Sem permissão para cancelar esta reserva." });
      }

      const updated = await prisma.fleetReservation.update({
        where: { id },
        data: { status: "CANCELED", cancelReason: reason },
        include: RESERVATION_INCLUDE,
      });

      await syncVehicleStatusAfterReservationChange(existing.vehicleId);

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: id,
        action: "CANCEL",
        oldValue: existing.status,
        newValue: updated.status,
        reason,
        userId: user?.id ?? null,
      });

      res.json({ reservation: updated });
    } catch (e) {
      fleetError(res, e, "PATCH cancel");
    }
  });

  app.patch("/api/fleet/reservations/:id/replace-vehicle", ...g.manage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const newVehicleId = req.body?.vehicleId;
      if (!isUuid(newVehicleId)) return res.status(400).json({ error: "Novo veículo inválido." });

      const existing = await getReservationOrThrow(id);
      if (!["PENDING_APPROVAL", "APPROVED"].includes(existing.status)) {
        return res.status(400).json({ error: "Substituição não permitida neste status." });
      }

      await validateReservationFull({
        vehicleId: newVehicleId,
        driverId: existing.driverId,
        startDateTime: existing.startDateTime,
        endDateTime: existing.endDateTime,
        excludeReservationId: id,
      });

      const user = await getCurrentAppUser(req);
      const oldVehicleId = existing.vehicleId;
      const updated = await prisma.fleetReservation.update({
        where: { id },
        data: { vehicleId: newVehicleId },
        include: RESERVATION_INCLUDE,
      });

      await syncVehicleStatusAfterReservationChange(oldVehicleId);
      await syncVehicleStatusAfterReservationChange(newVehicleId);
      if (updated.status === "APPROVED") {
        await prisma.fleetVehicle.update({
          where: { id: newVehicleId },
          data: { status: "RESERVED" },
        });
      }

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: id,
        action: "REPLACE_VEHICLE",
        oldValue: oldVehicleId,
        newValue: newVehicleId,
        userId: user?.id ?? null,
      });

      res.json({ reservation: updated });
    } catch (e) {
      fleetError(res, e, "PATCH replace-vehicle");
    }
  });

  app.post("/api/fleet/reservations/:id/checkout", ...g.reservationsCreate, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const result = await performCheckout({
        reservationId: id,
        body: req.body ?? {},
        userId: user?.id ?? null,
        userLabel: user?.email ?? user?.name ?? null,
      });
      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST checkout");
    }
  });

  app.post("/api/fleet/reservations/:id/checkin", ...g.reservationsCreate, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const result = await performCheckin({
        reservationId: id,
        body: req.body ?? {},
        userId: user?.id ?? null,
      });
      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST checkin");
    }
  });
}
