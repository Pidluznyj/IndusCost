import type express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  FleetValidationError,
  assertContractDateRange,
  assertDateRange,
  assertDriverAuthorizedForReservation,
  assertKmRange,
  assertNonNegativeAmount,
  assertNonNegativeKm,
  normalizePlate,
  parseDecimalKm,
} from "@/src/lib/fleetValidation.js";
import {
  assertNoReservationOverlap,
  assertUniqueActiveDriverCpf,
  assertUniqueActivePlate,
  buildFleetDashboard,
  loadFleetSettings,
  serializeFleetVehicle,
  validateReservationCreate,
  writeFleetAuditLog,
} from "@/src/lib/fleetService.js";

type AuthGuards = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (p: string) => express.RequestHandler;
  requireAnyPermission: (ps: string[]) => express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{ id: string; email: string; name: string } | null>;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function fleetError(res: express.Response, e: unknown, logLabel: string) {
  if (e instanceof FleetValidationError) {
    return res.status(400).json({ error: e.message });
  }
  console.error(logLabel, e);
  const msg = e instanceof Error ? e.message : "Erro interno.";
  return res.status(500).json({ error: msg });
}

async function actorId(req: express.Request, getCurrentAppUser: AuthGuards["getCurrentAppUser"]) {
  const u = await getCurrentAppUser(req);
  return u?.id ?? u?.email ?? null;
}

export function registerFleetRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requirePermission, requireAnyPermission, getCurrentAppUser } = auth;

  const fleetView = [requireAppAuth, requirePermission("fleet.view")] as express.RequestHandler[];
  const fleetManage = [requireAppAuth, requireAnyPermission(["fleet.manage", "fleet.vehicles.edit"])] as express.RequestHandler[];
  const fleetVehiclesEdit = [requireAppAuth, requireAnyPermission(["fleet.vehicles.edit", "fleet.manage"])] as express.RequestHandler[];
  const fleetResCreate = [requireAppAuth, requireAnyPermission(["fleet.reservations.create", "fleet.manage"])] as express.RequestHandler[];
  const fleetResApprove = [requireAppAuth, requireAnyPermission(["fleet.reservations.approve", "fleet.manage"])] as express.RequestHandler[];
  const fleetMaintManage = [requireAppAuth, requireAnyPermission(["fleet.maintenance.manage", "fleet.manage"])] as express.RequestHandler[];
  const fleetSettingsManage = [requireAppAuth, requirePermission("fleet.settings.manage")] as express.RequestHandler[];

  // --- Dashboard ---
  app.get("/api/fleet/dashboard", ...fleetView, async (req, res) => {
    try {
      const dashboard = await buildFleetDashboard();
      res.json(dashboard);
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/dashboard");
    }
  });

  // --- Vehicles ---
  app.get("/api/fleet/vehicles", ...fleetView, async (req, res) => {
    try {
      const status = String(req.query.status ?? "").trim();
      const origin = String(req.query.origin ?? "").trim();
      const unit = String(req.query.unit ?? "").trim();
      const costCenter = String(req.query.costCenter ?? "").trim();
      const search = String(req.query.search ?? "").trim();

      const where: Prisma.FleetVehicleWhereInput = {};
      if (status) where.status = status as Prisma.EnumFleetVehicleStatusFilter["equals"];
      if (origin) where.origin = origin as Prisma.EnumFleetVehicleOriginFilter["equals"];
      if (unit) where.unit = unit;
      if (costCenter) where.costCenter = costCenter;
      if (search) {
        where.OR = [
          { plate: { contains: search, mode: "insensitive" } },
          { brand: { contains: search, mode: "insensitive" } },
          { model: { contains: search, mode: "insensitive" } },
        ];
      }

      const vehicles = await prisma.fleetVehicle.findMany({
        where,
        orderBy: [{ plate: "asc" }, { brand: "asc" }],
      });
      res.json({ vehicles: vehicles.map(serializeFleetVehicle) });
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/vehicles");
    }
  });

  app.get("/api/fleet/vehicles/:id", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const vehicle = await prisma.fleetVehicle.findUnique({
        where: { id },
        include: {
          contracts: { orderBy: { startDate: "desc" } },
          documents: { orderBy: { expirationDate: "asc" } },
          reservations: { orderBy: { startDateTime: "desc" }, take: 50 },
          maintenances: { orderBy: { openedAt: "desc" }, take: 50 },
          costs: { orderBy: { costDate: "desc" }, take: 50 },
          incidents: { orderBy: { incidentDate: "desc" }, take: 50 },
          attachments: { orderBy: { uploadedAt: "desc" }, take: 50 },
        },
      });
      if (!vehicle) return res.status(404).json({ error: "Veículo não encontrado." });
      res.json({
        vehicle: {
          ...serializeFleetVehicle(vehicle),
          contracts: vehicle.contracts,
          documents: vehicle.documents,
          reservations: vehicle.reservations,
          maintenances: vehicle.maintenances,
          costs: vehicle.costs.map((c) => ({ ...c, amount: Number(c.amount) })),
          incidents: vehicle.incidents,
          attachments: vehicle.attachments,
        },
      });
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/vehicles/:id");
    }
  });

  app.post("/api/fleet/vehicles", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const body = req.body ?? {};
      const brand = typeof body.brand === "string" ? body.brand.trim() : "";
      const model = typeof body.model === "string" ? body.model.trim() : "";
      if (!brand || !model) return res.status(400).json({ error: "Marca e modelo são obrigatórios." });

      const plate = normalizePlate(body.plate);
      const currentKm = parseDecimalKm(body.currentKm) ?? 0;
      const initialKm = parseDecimalKm(body.initialKm) ?? currentKm;
      assertNonNegativeKm(currentKm);
      assertNonNegativeKm(initialKm);

      await assertUniqueActivePlate(plate);

      const userId = await actorId(req, getCurrentAppUser);
      const status = body.status === "BLOCKED" ? "BLOCKED" : plate ? "AVAILABLE" : "AVAILABLE";

      const created = await prisma.fleetVehicle.create({
        data: {
          plate,
          renavam: body.renavam?.trim?.() ?? null,
          chassis: body.chassis?.trim?.() ?? null,
          brand,
          model,
          modelYear: body.modelYear != null ? Number(body.modelYear) : null,
          manufactureYear: body.manufactureYear != null ? Number(body.manufactureYear) : null,
          color: body.color?.trim?.() ?? null,
          vehicleType: body.vehicleType?.trim?.() ?? null,
          fuelType: body.fuelType?.trim?.() ?? null,
          origin: body.origin ?? "OWNED",
          status,
          ownershipType: body.ownershipType?.trim?.() ?? null,
          currentKm,
          initialKm,
          unit: body.unit?.trim?.() ?? null,
          costCenter: body.costCenter?.trim?.() ?? null,
          responsibleUserId: isUuid(body.responsibleUserId) ? body.responsibleUserId : null,
          notes: body.notes?.trim?.() ?? null,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await writeFleetAuditLog({
        entityType: "FleetVehicle",
        entityId: created.id,
        action: "CREATE",
        newValue: JSON.stringify({ plate: created.plate, status: created.status }),
        userId,
      });

      res.status(201).json({ vehicle: serializeFleetVehicle(created) });
    } catch (e) {
      fleetError(res, e, "POST /api/fleet/vehicles");
    }
  });

  app.put("/api/fleet/vehicles/:id", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetVehicle.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Veículo não encontrado." });

      const body = req.body ?? {};
      const plate = body.plate !== undefined ? normalizePlate(body.plate) : existing.plate;
      if (plate !== existing.plate) await assertUniqueActivePlate(plate, id);

      const currentKm =
        body.currentKm !== undefined ? (parseDecimalKm(body.currentKm) ?? 0) : Number(existing.currentKm);
      const initialKm =
        body.initialKm !== undefined ? (parseDecimalKm(body.initialKm) ?? 0) : Number(existing.initialKm);
      assertNonNegativeKm(currentKm);
      assertNonNegativeKm(initialKm);

      const userId = await actorId(req, getCurrentAppUser);
      const updated = await prisma.fleetVehicle.update({
        where: { id },
        data: {
          plate,
          renavam: body.renavam !== undefined ? (body.renavam?.trim?.() ?? null) : undefined,
          chassis: body.chassis !== undefined ? (body.chassis?.trim?.() ?? null) : undefined,
          brand: body.brand?.trim?.() ?? undefined,
          model: body.model?.trim?.() ?? undefined,
          modelYear: body.modelYear !== undefined ? Number(body.modelYear) : undefined,
          manufactureYear: body.manufactureYear !== undefined ? Number(body.manufactureYear) : undefined,
          color: body.color !== undefined ? (body.color?.trim?.() ?? null) : undefined,
          vehicleType: body.vehicleType !== undefined ? (body.vehicleType?.trim?.() ?? null) : undefined,
          fuelType: body.fuelType !== undefined ? (body.fuelType?.trim?.() ?? null) : undefined,
          origin: body.origin ?? undefined,
          ownershipType: body.ownershipType !== undefined ? (body.ownershipType?.trim?.() ?? null) : undefined,
          currentKm,
          initialKm,
          unit: body.unit !== undefined ? (body.unit?.trim?.() ?? null) : undefined,
          costCenter: body.costCenter !== undefined ? (body.costCenter?.trim?.() ?? null) : undefined,
          responsibleUserId:
            body.responsibleUserId !== undefined
              ? isUuid(body.responsibleUserId)
                ? body.responsibleUserId
                : null
              : undefined,
          notes: body.notes !== undefined ? (body.notes?.trim?.() ?? null) : undefined,
          updatedBy: userId,
        },
      });

      await writeFleetAuditLog({
        entityType: "FleetVehicle",
        entityId: id,
        action: "UPDATE",
        oldValue: JSON.stringify({ plate: existing.plate, status: existing.status }),
        newValue: JSON.stringify({ plate: updated.plate, status: updated.status }),
        userId,
      });

      res.json({ vehicle: serializeFleetVehicle(updated) });
    } catch (e) {
      fleetError(res, e, "PUT /api/fleet/vehicles/:id");
    }
  });

  app.patch("/api/fleet/vehicles/:id/status", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const status = req.body?.status;
      if (!status || typeof status !== "string") {
        return res.status(400).json({ error: "Status é obrigatório." });
      }

      const existing = await prisma.fleetVehicle.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Veículo não encontrado." });

      const userId = await actorId(req, getCurrentAppUser);
      const updated = await prisma.fleetVehicle.update({
        where: { id },
        data: { status: status as typeof existing.status, updatedBy: userId },
      });

      await writeFleetAuditLog({
        entityType: "FleetVehicle",
        entityId: id,
        action: "STATUS_CHANGE",
        oldValue: existing.status,
        newValue: updated.status,
        reason: typeof req.body?.reason === "string" ? req.body.reason : null,
        userId,
      });

      res.json({ vehicle: serializeFleetVehicle(updated) });
    } catch (e) {
      fleetError(res, e, "PATCH /api/fleet/vehicles/:id/status");
    }
  });

  // --- Drivers ---
  app.get("/api/fleet/drivers", ...fleetView, async (req, res) => {
    try {
      const status = String(req.query.status ?? "").trim();
      const where: Prisma.FleetDriverWhereInput = {};
      if (status) where.status = status as Prisma.EnumFleetDriverStatusFilter["equals"];
      const drivers = await prisma.fleetDriver.findMany({ where, orderBy: { name: "asc" } });
      res.json({ drivers });
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/drivers");
    }
  });

  app.post("/api/fleet/drivers", ...fleetManage, async (req, res) => {
    try {
      const body = req.body ?? {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const cpfRaw = typeof body.cpf === "string" ? body.cpf.trim() : "";
      const cpf = cpfRaw.replace(/\D/g, "");
      if (!name || !cpf) return res.status(400).json({ error: "Nome e CPF são obrigatórios." });

      await assertUniqueActiveDriverCpf(cpf);

      const created = await prisma.fleetDriver.create({
        data: {
          name,
          cpf,
          cnhNumber: body.cnhNumber?.trim?.() ?? null,
          cnhCategory: body.cnhCategory?.trim?.() ?? null,
          cnhExpirationDate: body.cnhExpirationDate ? new Date(body.cnhExpirationDate) : null,
          phone: body.phone?.trim?.() ?? null,
          email: body.email?.trim?.() ?? null,
          unit: body.unit?.trim?.() ?? null,
          costCenter: body.costCenter?.trim?.() ?? null,
          status: body.status ?? "PENDING",
          notes: body.notes?.trim?.() ?? null,
        },
      });

      const userId = await actorId(req, getCurrentAppUser);
      await writeFleetAuditLog({
        entityType: "FleetDriver",
        entityId: created.id,
        action: "CREATE",
        newValue: JSON.stringify({ name: created.name, status: created.status }),
        userId,
      });

      res.status(201).json({ driver: created });
    } catch (e) {
      fleetError(res, e, "POST /api/fleet/drivers");
    }
  });

  // --- Reservations ---
  app.get("/api/fleet/reservations", ...fleetView, async (req, res) => {
    try {
      const vehicleId = String(req.query.vehicleId ?? "").trim();
      const status = String(req.query.status ?? "").trim();
      const where: Prisma.FleetReservationWhereInput = {};
      if (vehicleId && isUuid(vehicleId)) where.vehicleId = vehicleId;
      if (status) where.status = status as Prisma.EnumFleetReservationStatusFilter["equals"];

      const reservations = await prisma.fleetReservation.findMany({
        where,
        include: {
          vehicle: { select: { id: true, plate: true, brand: true, model: true } },
          driver: { select: { id: true, name: true, cnhExpirationDate: true, status: true } },
        },
        orderBy: { startDateTime: "desc" },
        take: 200,
      });
      res.json({ reservations });
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/reservations");
    }
  });

  app.post("/api/fleet/reservations", ...fleetResCreate, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });

      const startDateTime = new Date(body.startDateTime);
      const endDateTime = new Date(body.endDateTime);
      if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
        return res.status(400).json({ error: "Datas de reserva inválidas." });
      }

      await validateReservationCreate({
        vehicleId,
        driverId: isUuid(body.driverId) ? body.driverId : null,
        startDateTime,
        endDateTime,
      });

      const user = await getCurrentAppUser(req);
      const created = await prisma.fleetReservation.create({
        data: {
          vehicleId,
          driverId: isUuid(body.driverId) ? body.driverId : null,
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
        include: {
          vehicle: { select: { plate: true, brand: true, model: true } },
          driver: { select: { name: true } },
        },
      });

      await prisma.fleetVehicle.update({
        where: { id: vehicleId },
        data: { status: "RESERVED" },
      });

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: created.id,
        action: "CREATE",
        newValue: JSON.stringify({ status: created.status }),
        userId: user?.id ?? null,
      });

      res.status(201).json({ reservation: created });
    } catch (e) {
      fleetError(res, e, "POST /api/fleet/reservations");
    }
  });

  app.patch("/api/fleet/reservations/:id/approve", ...fleetResApprove, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetReservation.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Reserva não encontrada." });
      if (!["REQUESTED", "PENDING_APPROVAL"].includes(existing.status)) {
        return res.status(400).json({ error: "Reserva não pode ser aprovada neste status." });
      }

      const user = await getCurrentAppUser(req);
      const updated = await prisma.fleetReservation.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvalStatus: "APPROVED",
          approvedBy: user?.email ?? user?.name ?? null,
          approvedAt: new Date(),
        },
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
      fleetError(res, e, "PATCH approve reservation");
    }
  });

  app.patch("/api/fleet/reservations/:id/reject", ...fleetResApprove, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetReservation.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Reserva não encontrada." });

      const user = await getCurrentAppUser(req);
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.fleetReservation.update({
          where: { id },
          data: {
            status: "REJECTED",
            approvalStatus: "REJECTED",
            rejectionReason: String(req.body?.reason ?? "").trim() || null,
          },
        });
        await tx.fleetVehicle.update({
          where: { id: existing.vehicleId },
          data: { status: "AVAILABLE" },
        });
        return r;
      });

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: id,
        action: "REJECT",
        oldValue: existing.status,
        newValue: updated.status,
        userId: user?.id ?? null,
      });

      res.json({ reservation: updated });
    } catch (e) {
      fleetError(res, e, "PATCH reject reservation");
    }
  });

  app.patch("/api/fleet/reservations/:id/cancel", ...fleetResCreate, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetReservation.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Reserva não encontrada." });
      if (existing.status === "IN_USE") {
        return res.status(400).json({ error: "Reserva em uso não pode ser cancelada." });
      }

      const user = await getCurrentAppUser(req);
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.fleetReservation.update({
          where: { id },
          data: {
            status: "CANCELED",
            cancelReason: String(req.body?.reason ?? "").trim() || null,
          },
        });
        if (["REQUESTED", "PENDING_APPROVAL", "APPROVED"].includes(existing.status)) {
          await tx.fleetVehicle.update({
            where: { id: existing.vehicleId },
            data: { status: "AVAILABLE" },
          });
        }
        return r;
      });

      await writeFleetAuditLog({
        entityType: "FleetReservation",
        entityId: id,
        action: "CANCEL",
        oldValue: existing.status,
        newValue: updated.status,
        userId: user?.id ?? null,
      });

      res.json({ reservation: updated });
    } catch (e) {
      fleetError(res, e, "PATCH cancel reservation");
    }
  });

  app.post("/api/fleet/reservations/:id/checkout", ...fleetResCreate, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reservation = await prisma.fleetReservation.findUnique({
        where: { id },
        include: { vehicle: true, driver: true },
      });
      if (!reservation) return res.status(404).json({ error: "Reserva não encontrada." });
      if (reservation.status !== "APPROVED") {
        return res.status(400).json({ error: "Somente reserva aprovada pode ser retirada." });
      }

      const settings = await loadFleetSettings();
      if (reservation.driver) {
        assertDriverAuthorizedForReservation(reservation.driver, {
          blockExpiredCnh: settings.bloquearRetiradaCnhVencida !== "false",
        });
      }

      const checkoutKm = parseDecimalKm(req.body?.checkoutKm);
      if (checkoutKm == null) return res.status(400).json({ error: "Km de retirada é obrigatório." });
      assertNonNegativeKm(checkoutKm);
      const vehicleKm = Number(reservation.vehicle.currentKm);
      if (checkoutKm < vehicleKm) {
        return res.status(400).json({
          error: "Km de retirada não pode ser menor que km atual do veículo.",
        });
      }

      const user = await getCurrentAppUser(req);
      const result = await prisma.$transaction(async (tx) => {
        const usage = await tx.fleetUsage.create({
          data: {
            reservationId: id,
            vehicleId: reservation.vehicleId,
            driverId: reservation.driverId,
            checkoutAt: new Date(),
            checkoutKm,
            checkoutFuelLevel: req.body?.checkoutFuelLevel?.trim?.() ?? null,
            checkoutNotes: req.body?.checkoutNotes?.trim?.() ?? null,
            status: "CHECKED_OUT",
          },
        });
        const resUpdated = await tx.fleetReservation.update({
          where: { id },
          data: { status: "IN_USE" },
        });
        await tx.fleetVehicle.update({
          where: { id: reservation.vehicleId },
          data: { status: "IN_USE", currentKm: checkoutKm },
        });
        return { usage, reservation: resUpdated };
      });

      await writeFleetAuditLog({
        entityType: "FleetUsage",
        entityId: result.usage.id,
        action: "CHECKOUT",
        newValue: String(checkoutKm),
        userId: user?.id ?? null,
      });

      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST checkout");
    }
  });

  app.post("/api/fleet/reservations/:id/checkin", ...fleetResCreate, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reservation = await prisma.fleetReservation.findUnique({
        where: { id },
        include: { vehicle: true, usage: true },
      });
      if (!reservation) return res.status(404).json({ error: "Reserva não encontrada." });
      if (reservation.status !== "IN_USE" || !reservation.usage) {
        return res.status(400).json({ error: "Reserva não está em uso / sem retirada registrada." });
      }

      const checkinKm = parseDecimalKm(req.body?.checkinKm);
      if (checkinKm == null) return res.status(400).json({ error: "Km de devolução é obrigatório." });
      const checkoutKm = Number(reservation.usage.checkoutKm ?? 0);
      assertKmRange(checkoutKm, checkinKm);
      const kmDriven = checkinKm - checkoutKm;
      const hasPending = Boolean(req.body?.hasPending);

      const user = await getCurrentAppUser(req);
      const result = await prisma.$transaction(async (tx) => {
        const usage = await tx.fleetUsage.update({
          where: { id: reservation.usage!.id },
          data: {
            checkinAt: new Date(),
            checkinKm,
            checkinFuelLevel: req.body?.checkinFuelLevel?.trim?.() ?? null,
            checkinNotes: req.body?.checkinNotes?.trim?.() ?? null,
            kmDriven,
            status: "CHECKED_IN",
          },
        });
        const resStatus = hasPending ? "FINISHED_WITH_PENDING" : "FINISHED";
        const resUpdated = await tx.fleetReservation.update({
          where: { id },
          data: { status: resStatus },
        });
        const vehicleStatus = hasPending ? reservation.vehicle.status : "AVAILABLE";
        await tx.fleetVehicle.update({
          where: { id: reservation.vehicleId },
          data: {
            currentKm: checkinKm,
            status: hasPending ? "BLOCKED" : vehicleStatus === "IN_USE" ? "AVAILABLE" : vehicleStatus,
          },
        });
        return { usage, reservation: resUpdated };
      });

      await writeFleetAuditLog({
        entityType: "FleetUsage",
        entityId: result.usage.id,
        action: "CHECKIN",
        newValue: String(checkinKm),
        userId: user?.id ?? null,
      });

      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST checkin");
    }
  });

  // --- Maintenances ---
  app.get("/api/fleet/maintenances", ...fleetView, async (req, res) => {
    try {
      const vehicleId = String(req.query.vehicleId ?? "").trim();
      const where: Prisma.FleetMaintenanceWhereInput = {};
      if (vehicleId && isUuid(vehicleId)) where.vehicleId = vehicleId;
      const maintenances = await prisma.fleetMaintenance.findMany({
        where,
        include: { vehicle: { select: { plate: true, brand: true, model: true } } },
        orderBy: { openedAt: "desc" },
        take: 200,
      });
      res.json({
        maintenances: maintenances.map((m) => ({
          ...m,
          estimatedValue: m.estimatedValue != null ? Number(m.estimatedValue) : null,
          finalValue: m.finalValue != null ? Number(m.finalValue) : null,
          currentKm: m.currentKm != null ? Number(m.currentKm) : null,
        })),
      });
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/maintenances");
    }
  });

  app.post("/api/fleet/maintenances", ...fleetMaintManage, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });
      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (!description) return res.status(400).json({ error: "Descrição é obrigatória." });

      const estimatedValue = body.estimatedValue != null ? Number(body.estimatedValue) : null;
      const finalValue = body.finalValue != null ? Number(body.finalValue) : null;
      if (estimatedValue != null) assertNonNegativeAmount(estimatedValue);
      if (finalValue != null) assertNonNegativeAmount(finalValue);

      const blocksVehicle = Boolean(body.blocksVehicle);
      const userId = await actorId(req, getCurrentAppUser);

      const created = await prisma.$transaction(async (tx) => {
        const m = await tx.fleetMaintenance.create({
          data: {
            vehicleId,
            reservationId: isUuid(body.reservationId) ? body.reservationId : null,
            maintenanceType: body.maintenanceType?.trim?.() || "CORRETIVA",
            priority: body.priority?.trim?.() || "MEDIA",
            description,
            scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
            supplierName: body.supplierName?.trim?.() ?? null,
            estimatedValue,
            finalValue,
            currentKm: body.currentKm != null ? parseDecimalKm(body.currentKm) : null,
            blocksVehicle,
            notes: body.notes?.trim?.() ?? null,
          },
        });
        if (blocksVehicle) {
          await tx.fleetVehicle.update({
            where: { id: vehicleId },
            data: { status: "MAINTENANCE" },
          });
        }
        return m;
      });

      await writeFleetAuditLog({
        entityType: "FleetMaintenance",
        entityId: created.id,
        action: "CREATE",
        userId,
      });

      res.status(201).json({ maintenance: created });
    } catch (e) {
      fleetError(res, e, "POST /api/fleet/maintenances");
    }
  });

  // --- Settings ---
  app.get("/api/fleet/settings", ...fleetView, async (req, res) => {
    try {
      const settings = await prisma.fleetSettings.findMany({ orderBy: { key: "asc" } });
      res.json({ settings });
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/settings");
    }
  });

  app.put("/api/fleet/settings", ...fleetSettingsManage, async (req, res) => {
    try {
      const items = Array.isArray(req.body?.settings) ? req.body.settings : [];
      const userId = await actorId(req, getCurrentAppUser);

      for (const item of items) {
        const key = typeof item.key === "string" ? item.key.trim() : "";
        const value = typeof item.value === "string" ? item.value : String(item.value ?? "");
        if (!key) continue;
        await prisma.fleetSettings.upsert({
          where: { key },
          create: { key, value, description: item.description ?? null, updatedBy: userId },
          update: { value, updatedBy: userId },
        });
      }

      const settings = await prisma.fleetSettings.findMany({ orderBy: { key: "asc" } });
      res.json({ settings });
    } catch (e) {
      fleetError(res, e, "PUT /api/fleet/settings");
    }
  });
}
