import type express from "express";
import { prisma } from "@/src/lib/prisma.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  FleetValidationError,
  assertBlockReason,
  fleetValidationHttpStatus,
} from "@/src/lib/fleetValidation.js";
import {
  assertUniqueActiveDriverCpf,
  loadFleetSettings,
  writeFleetAuditLog,
} from "@/src/lib/fleetService.js";
import {
  buildDriverAlerts,
  buildDriverAlertsSync,
  buildDriverCnhWhere,
  buildDriverListWhere,
  changeDriverStatus,
  getDriverOrThrow,
  parseDriverInput,
  serializeDriver,
} from "@/src/lib/fleetDriverOps.js";
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

async function actorId(req: express.Request, getCurrentAppUser: AuthGuards["getCurrentAppUser"]) {
  const u = await getCurrentAppUser(req);
  return u?.id ?? u?.email ?? null;
}

export function registerFleetDriverRoutes(app: express.Express, auth: AuthGuards) {
  const { getCurrentAppUser } = auth;
  const g = createFleetRouteGuards(auth);

  app.get("/api/fleet/drivers", ...g.view, async (req, res) => {
    try {
      const list = parseFleetListQuery(req.query as Record<string, unknown>);
      const cnhFilter = String(req.query.cnhFilter ?? "").trim();
      const settings = await loadFleetSettings();
      const alertDays = Number(settings.diasAlertaCnh ?? "30") || 30;

      const where = buildDriverListWhere({
        status: list.status,
        unit: list.unit,
        costCenter: list.costCenter,
        search: list.search,
      });
      const cnhWhere = buildDriverCnhWhere(cnhFilter, alertDays);
      if (cnhWhere) Object.assign(where, cnhWhere);

      const orderBy =
        list.sortBy === "cpf"
          ? { cpf: list.sortOrder }
          : { name: list.sortOrder };

      const [total, drivers] = await Promise.all([
        prisma.fleetDriver.count({ where }),
        prisma.fleetDriver.findMany({
          where,
          orderBy,
          skip: list.skip,
          take: list.limit,
        }),
      ]);

      const enriched = drivers.map((d) => ({
        ...serializeDriver(d, alertDays),
        alerts: buildDriverAlertsSync(d, alertDays),
      }));
      res.json(buildFleetListResponse("drivers", enriched, fleetListMeta(total, list.page, list.limit)));
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/drivers");
    }
  });

  app.get("/api/fleet/drivers/:id", ...g.view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const driver = await getDriverOrThrow(id);
      const settings = await loadFleetSettings();
      const alertDays = Number(settings.diasAlertaCnh ?? "30") || 30;
      const logs = await prisma.fleetAuditLog.findMany({
        where: { entityType: "FleetDriver", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      res.json({
        driver: { ...serializeDriver(driver, alertDays), alerts: await buildDriverAlerts(driver) },
        auditLogs: logs,
      });
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/drivers/:id");
    }
  });

  app.post("/api/fleet/drivers", ...g.driversManage, async (req, res) => {
    try {
      const data = parseDriverInput(req.body ?? {});
      await assertUniqueActiveDriverCpf(data.cpf);
      const userId = await actorId(req, getCurrentAppUser);
      const created = await prisma.fleetDriver.create({
        data: {
          name: data.name,
          cpf: data.cpf,
          cnhNumber: data.cnhNumber ?? null,
          cnhCategory: data.cnhCategory ?? null,
          cnhExpirationDate:
            data.cnhExpirationDate !== undefined ? data.cnhExpirationDate : null,
          phone: data.phone ?? null,
          email: data.email ?? null,
          unit: data.unit ?? null,
          costCenter: data.costCenter ?? null,
          status: data.status ?? "PENDING",
          notes: data.notes ?? null,
        },
      });
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

  app.put("/api/fleet/drivers/:id", ...g.driversManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await getDriverOrThrow(id);
      const data = parseDriverInput(req.body ?? {}, existing);
      if (data.cpf !== existing.cpf) await assertUniqueActiveDriverCpf(data.cpf, id);
      const userId = await actorId(req, getCurrentAppUser);
      const updated = await prisma.fleetDriver.update({
        where: { id },
        data: {
          name: data.name,
          cpf: data.cpf,
          cnhNumber: data.cnhNumber,
          cnhCategory: data.cnhCategory,
          cnhExpirationDate: data.cnhExpirationDate,
          phone: data.phone,
          email: data.email,
          unit: data.unit,
          costCenter: data.costCenter,
          status: data.status,
          notes: data.notes,
        },
      });
      await writeFleetAuditLog({
        entityType: "FleetDriver",
        entityId: id,
        action: "UPDATE",
        oldValue: JSON.stringify({ status: existing.status }),
        newValue: JSON.stringify({ status: updated.status }),
        userId,
      });
      res.json({ driver: updated });
    } catch (e) {
      fleetError(res, e, "PUT /api/fleet/drivers/:id");
    }
  });

  app.post("/api/fleet/drivers/:id/block", ...g.driversManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reason = assertBlockReason(req.body?.reason);
      const userId = await actorId(req, getCurrentAppUser);
      const updated = await changeDriverStatus(id, "BLOCKED", userId, "BLOCK", reason);
      res.json({ driver: updated });
    } catch (e) {
      fleetError(res, e, "POST block driver");
    }
  });

  app.post("/api/fleet/drivers/:id/unblock", ...g.driversManage, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reason = assertBlockReason(req.body?.reason);
      const userId = await actorId(req, getCurrentAppUser);
      const updated = await changeDriverStatus(id, "AUTHORIZED", userId, "UNBLOCK", reason);
      res.json({ driver: updated });
    } catch (e) {
      fleetError(res, e, "POST unblock driver");
    }
  });
}
