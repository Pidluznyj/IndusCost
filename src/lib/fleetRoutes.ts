import type express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  FleetValidationError,
  assertContractDateRange,
  assertDateRange,
  assertNonNegativeKm,
  normalizePlate,
} from "@/src/lib/fleetValidation.js";
import {
  assertUniqueActivePlate,
  serializeFleetVehicle,
  writeFleetAuditLog,
} from "@/src/lib/fleetService.js";
import {
  enrichVehiclesWithAlerts,
  registerFleetVehicleExtendedRoutes,
  buildVehicleFormData,
} from "@/src/lib/fleetVehicleRoutes.js";
import { registerFleetDriverRoutes } from "@/src/lib/fleetDriverRoutes.js";
import { registerFleetReservationRoutes } from "@/src/lib/fleetReservationRoutes.js";
import { registerFleetChecklistRoutes } from "@/src/lib/fleetChecklistRoutes.js";
import { registerFleetUsageRoutes } from "@/src/lib/fleetUsageRoutes.js";
import { registerFleetMaintenanceRoutes } from "@/src/lib/fleetMaintenanceRoutes.js";
import { registerFleetFinancialRoutes } from "@/src/lib/fleetFinancialRoutes.js";
import {
  getFleetDashboardPayload,
  registerFleetManagementRoutes,
  saveFleetSettingsWithAudit,
} from "@/src/lib/fleetManagementRoutes.js";
import { registerFleetImportRoutes } from "@/src/lib/fleetImportRoutes.js";
import { createFleetRouteGuards, type FleetAuthGuards } from "@/src/lib/fleetRouteGuards.js";
import { hasPermission, type AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildFleetListResponse,
  fleetListMeta,
  parseFleetListQuery,
} from "@/src/lib/fleetListQuery.js";
import {
  refreshDocumentStatuses,
  serializeContract,
  buildVehicleAlerts,
} from "@/src/lib/fleetVehicleOps.js";

type AuthGuards = FleetAuthGuards;

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
  const { getCurrentAppUser } = auth;
  const g = createFleetRouteGuards(auth);

  // --- Dashboard ---
  app.get("/api/fleet/dashboard", ...g.view, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const showFinancial =
        user != null &&
        (hasPermission(user, "fleet.financial.view") || hasPermission(user, "fleet.manage"));
      res.json(await getFleetDashboardPayload(showFinancial));
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/dashboard");
    }
  });

  // --- Vehicles ---
  app.get("/api/fleet/vehicles", ...g.view, async (req, res) => {
    try {
      const list = parseFleetListQuery(req.query as Record<string, unknown>);
      const includeAlerts =
        String(req.query.includeAlerts ?? "true").trim().toLowerCase() !== "false";

      const where: Prisma.FleetVehicleWhereInput = {};
      if (list.status) where.status = list.status as Prisma.EnumFleetVehicleStatusFilter["equals"];
      if (list.origin) where.origin = list.origin as Prisma.EnumFleetVehicleOriginFilter["equals"];
      if (list.unit) where.unit = { contains: list.unit, mode: "insensitive" };
      if (list.costCenter) where.costCenter = { contains: list.costCenter, mode: "insensitive" };
      if (list.search) {
        where.OR = [
          { plate: { contains: list.search, mode: "insensitive" } },
          { brand: { contains: list.search, mode: "insensitive" } },
          { model: { contains: list.search, mode: "insensitive" } },
        ];
      }

      const orderBy: Prisma.FleetVehicleOrderByWithRelationInput[] =
        list.sortBy === "brand"
          ? [{ brand: list.sortOrder }, { model: list.sortOrder }]
          : [{ plate: list.sortOrder }, { brand: "asc" }];

      const [total, vehicles] = await Promise.all([
        prisma.fleetVehicle.count({ where }),
        prisma.fleetVehicle.findMany({
          where,
          orderBy,
          skip: list.skip,
          take: list.limit,
        }),
      ]);

      const serialized = vehicles.map((v) => ({
        ...serializeFleetVehicle(v),
        id: v.id,
        origin: v.origin,
        status: v.status,
      }));
      const withAlerts = await enrichVehiclesWithAlerts(serialized, { includeAlerts });
      res.json(buildFleetListResponse("vehicles", withAlerts, fleetListMeta(total, list.page, list.limit)));
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/vehicles");
    }
  });

  app.get("/api/fleet/vehicles/:id", ...g.view, async (req, res) => {
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
      await refreshDocumentStatuses(id);
      const authUser = await getCurrentAppUser(req);
      const financial =
        authUser != null &&
        (hasPermission(authUser, "fleet.financial.view") || hasPermission(authUser, "fleet.manage"));
      const docs = await prisma.fleetVehicleDocument.findMany({
        where: { vehicleId: id },
        orderBy: [{ expirationDate: "asc" }],
      });
      const alerts = await buildVehicleAlerts(vehicle);
      res.json({
        vehicle: {
          ...serializeFleetVehicle(vehicle),
          alerts,
          contracts: vehicle.contracts.map((c) => serializeContract(c, financial)),
          documents: docs,
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

  app.post("/api/fleet/vehicles", ...g.vehiclesEdit, async (req, res) => {
    try {
      const body = req.body ?? {};
      const form = buildVehicleFormData(body);
      await assertUniqueActivePlate(form.plate ?? null);

      const userId = await actorId(req, getCurrentAppUser);
      const status = body.status === "BLOCKED" ? "BLOCKED" : "AVAILABLE";

      const created = await prisma.fleetVehicle.create({
        data: {
          plate: form.plate,
          renavam: form.renavam ?? null,
          chassis: form.chassis ?? null,
          brand: form.brand,
          model: form.model,
          modelYear: form.modelYear ?? null,
          manufactureYear: form.manufactureYear ?? null,
          color: form.color ?? null,
          vehicleType: form.vehicleType ?? null,
          fuelType: form.fuelType ?? null,
          origin: form.origin ?? "OWNED",
          status,
          ownershipType: form.ownershipType ?? null,
          currentKm: form.currentKm,
          initialKm: form.initialKm,
          unit: form.unit ?? null,
          costCenter: form.costCenter ?? null,
          responsibleUserId:
            form.responsibleUserId && isUuid(form.responsibleUserId)
              ? form.responsibleUserId
              : null,
          notes: form.notes ?? null,
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

  app.put("/api/fleet/vehicles/:id", ...g.vehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetVehicle.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Veículo não encontrado." });

      const form = buildVehicleFormData(req.body ?? {}, existing);
      if (form.plate !== existing.plate) await assertUniqueActivePlate(form.plate ?? null, id);

      const userId = await actorId(req, getCurrentAppUser);
      const updated = await prisma.fleetVehicle.update({
        where: { id },
        data: {
          plate: form.plate,
          renavam: form.renavam,
          chassis: form.chassis,
          brand: form.brand,
          model: form.model,
          modelYear: form.modelYear,
          manufactureYear: form.manufactureYear,
          color: form.color,
          vehicleType: form.vehicleType,
          fuelType: form.fuelType,
          origin: form.origin,
          ownershipType: form.ownershipType,
          currentKm: form.currentKm,
          initialKm: form.initialKm,
          unit: form.unit,
          costCenter: form.costCenter,
          responsibleUserId:
            form.responsibleUserId !== undefined
              ? form.responsibleUserId && isUuid(form.responsibleUserId)
                ? form.responsibleUserId
                : null
              : undefined,
          notes: form.notes,
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

  app.patch("/api/fleet/vehicles/:id/status", ...g.vehiclesEdit, async (req, res) => {
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

  registerFleetVehicleExtendedRoutes(app, auth);
  registerFleetDriverRoutes(app, auth);
  registerFleetReservationRoutes(app, auth);
  registerFleetChecklistRoutes(app, auth);
  registerFleetUsageRoutes(app, auth);
  registerFleetMaintenanceRoutes(app, auth);
  registerFleetFinancialRoutes(app, auth);
  registerFleetManagementRoutes(app, auth);
  registerFleetImportRoutes(app, auth);

  // --- Settings ---
  app.get("/api/fleet/settings", ...g.view, async (req, res) => {
    try {
      const settings = await prisma.fleetSettings.findMany({ orderBy: { key: "asc" } });
      res.json({ settings });
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/settings");
    }
  });

  app.put("/api/fleet/settings", ...g.settingsManage, async (req, res) => {
    try {
      const items = Array.isArray(req.body?.settings) ? req.body.settings : [];
      const userId = await actorId(req, getCurrentAppUser);
      const settings = await saveFleetSettingsWithAudit(items, userId);
      res.json({ settings });
    } catch (e) {
      fleetError(res, e, "PUT /api/fleet/settings");
    }
  });
}
