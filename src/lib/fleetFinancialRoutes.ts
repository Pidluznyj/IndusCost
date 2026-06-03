import type express from "express";
import type { FleetFineStatus, FleetIncidentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { hasPermission, type AppAuthContext } from "@/src/lib/appAuth.js";
import { FleetValidationError, assertNonNegativeAmount, assertReasonRequired } from "@/src/lib/fleetValidation.js";
import { writeFleetAuditLog } from "@/src/lib/fleetService.js";
import { createMaintenance } from "@/src/lib/fleetMaintenanceOps.js";
import { syncVehicleStatusAfterMaintenance } from "@/src/lib/fleetMaintenanceOps.js";
import {
  FLEET_COST_TYPES,
  assertCompetence,
  assertFuelingKm,
  buildFleetFinancialDashboard,
  competenceFromDate,
  createFleetCostFromSource,
  maskFinancialData,
  parsePositiveLiters,
  serializeCostRow,
  suggestDriverForVehiclePeriod,
  resolveFineInitialStatus,
  incidentBlocksVehicle,
} from "@/src/lib/fleetFinancialOps.js";
import { parseDecimalKm, resolveMaintenanceVehicleStatus } from "@/src/lib/fleetValidation.js";

type AuthGuards = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (p: string) => express.RequestHandler;
  requireAnyPermission: (ps: string[]) => express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

function fleetError(res: express.Response, e: unknown, label: string) {
  if (e instanceof FleetValidationError) return res.status(400).json({ error: e.message });
  console.error(label, e);
  return res.status(500).json({ error: e instanceof Error ? e.message : "Erro interno." });
}

async function showFinancial(req: express.Request, getUser: AuthGuards["getCurrentAppUser"]) {
  const u = await getUser(req);
  return u ? hasPermission(u, "fleet.financial.view") || hasPermission(u, "fleet.manage") : false;
}

const COST_INCLUDE = {
  vehicle: { select: { plate: true, brand: true, model: true } },
} as const;

const FUELING_INCLUDE = {
  vehicle: { select: { plate: true, brand: true, model: true, currentKm: true } },
  driver: { select: { id: true, name: true } },
} as const;

export function registerFleetFinancialRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requirePermission, requireAnyPermission, getCurrentAppUser } = auth;
  const fleetView = [requireAppAuth, requirePermission("fleet.view")] as express.RequestHandler[];
  const fleetFinancial = [
    requireAppAuth,
    requireAnyPermission(["fleet.financial.view", "fleet.manage"]),
  ] as express.RequestHandler[];
  const fleetWrite = [
    requireAppAuth,
    requireAnyPermission(["fleet.manage", "fleet.financial.view"]),
  ] as express.RequestHandler[];

  app.get("/api/fleet/financial/dashboard", ...fleetView, async (req, res) => {
    try {
      const competence = String(req.query.competence ?? "").trim() || undefined;
      const data = await buildFleetFinancialDashboard(competence);
      const fin = await showFinancial(req, getCurrentAppUser);
      res.json(maskFinancialData(data, fin));
    } catch (e) {
      fleetError(res, e, "GET financial dashboard");
    }
  });

  // --- Costs ---
  app.get("/api/fleet/costs", ...fleetView, async (req, res) => {
    try {
      const where: Prisma.FleetCostWhereInput = {};
      const vehicleId = String(req.query.vehicleId ?? "").trim();
      const competence = String(req.query.competence ?? "").trim();
      const status = String(req.query.status ?? "").trim();
      if (vehicleId && isUuid(vehicleId)) where.vehicleId = vehicleId;
      if (competence) where.competence = competence;
      if (status && status !== "all") {
        where.status = status as Prisma.EnumFleetCostStatusFilter["equals"];
      } else if (!status) {
        where.status = "ACTIVE";
      }

      const rows = await prisma.fleetCost.findMany({
        where,
        include: COST_INCLUDE,
        orderBy: { costDate: "desc" },
        take: 500,
      });
      const fin = await showFinancial(req, getCurrentAppUser);
      res.json({ costs: maskFinancialData(rows.map(serializeCostRow), fin) });
    } catch (e) {
      fleetError(res, e, "GET costs");
    }
  });

  app.get("/api/fleet/costs/:id", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await prisma.fleetCost.findUnique({ where: { id }, include: COST_INCLUDE });
      if (!row) return res.status(404).json({ error: "Custo não encontrado." });
      const fin = await showFinancial(req, getCurrentAppUser);
      res.json({ cost: maskFinancialData(serializeCostRow(row), fin) });
    } catch (e) {
      fleetError(res, e, "GET cost");
    }
  });

  app.post("/api/fleet/costs", ...fleetWrite, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });
      const amount = Number(body.amount);
      assertNonNegativeAmount(amount);
      const costType = String(body.costType ?? "OUTRO").trim().toUpperCase();
      if (!FLEET_COST_TYPES.includes(costType as (typeof FLEET_COST_TYPES)[number])) {
        return res.status(400).json({ error: "Tipo de custo inválido." });
      }
      const costDate = body.costDate ? new Date(body.costDate) : new Date();
      const user = await getCurrentAppUser(req);
      const created = await createFleetCostFromSource({
        vehicleId,
        costType,
        amount,
        costDate,
        competence: body.competence ? assertCompetence(body.competence) : undefined,
        contractId: isUuid(body.contractId) ? body.contractId : null,
        maintenanceId: isUuid(body.maintenanceId) ? body.maintenanceId : null,
        reservationId: isUuid(body.reservationId) ? body.reservationId : null,
        supplierName: body.supplierName?.trim?.() ?? null,
        documentNumber: body.documentNumber?.trim?.() ?? null,
        notes: body.notes?.trim?.() ?? null,
        userId: user?.id ?? null,
      });
      const full = await prisma.fleetCost.findUnique({
        where: { id: created.id },
        include: COST_INCLUDE,
      });
      const fin = await showFinancial(req, getCurrentAppUser);
      res.status(201).json({
        cost: maskFinancialData(full ? serializeCostRow(full) : serializeCostRow(created as never), fin),
      });
    } catch (e) {
      fleetError(res, e, "POST cost");
    }
  });

  app.put("/api/fleet/costs/:id", ...fleetWrite, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetCost.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Custo não encontrado." });
      if (existing.status === "CANCELED") {
        return res.status(400).json({ error: "Custo cancelado não pode ser editado." });
      }
      const body = req.body ?? {};
      const amount = body.amount != null ? Number(body.amount) : Number(existing.amount);
      assertNonNegativeAmount(amount);
      const user = await getCurrentAppUser(req);
      const updated = await prisma.fleetCost.update({
        where: { id },
        data: {
          costType: body.costType ? String(body.costType).trim().toUpperCase() : undefined,
          amount: body.amount != null ? amount : undefined,
          competence: body.competence ? assertCompetence(body.competence) : undefined,
          costDate: body.costDate ? new Date(body.costDate) : undefined,
          supplierName: body.supplierName !== undefined ? body.supplierName?.trim?.() ?? null : undefined,
          documentNumber:
            body.documentNumber !== undefined ? body.documentNumber?.trim?.() ?? null : undefined,
          notes: body.notes !== undefined ? body.notes?.trim?.() ?? null : undefined,
        },
        include: COST_INCLUDE,
      });
      await writeFleetAuditLog({
        entityType: "FleetCost",
        entityId: id,
        action: "UPDATE",
        oldValue: String(existing.amount),
        newValue: String(updated.amount),
        userId: user?.id ?? null,
      });
      res.json({ cost: serializeCostRow(updated) });
    } catch (e) {
      fleetError(res, e, "PUT cost");
    }
  });

  app.patch("/api/fleet/costs/:id/cancel", ...fleetWrite, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reason = assertReasonRequired(req.body?.reason, "Motivo do cancelamento");
      const user = await getCurrentAppUser(req);
      const updated = await prisma.fleetCost.update({
        where: { id },
        data: { status: "CANCELED", notes: reason },
        include: COST_INCLUDE,
      });
      await writeFleetAuditLog({
        entityType: "FleetCost",
        entityId: id,
        action: "CANCEL",
        reason,
        userId: user?.id ?? null,
      });
      res.json({ cost: serializeCostRow(updated) });
    } catch (e) {
      fleetError(res, e, "PATCH cancel cost");
    }
  });

  // --- Fuelings ---
  app.get("/api/fleet/fuelings", ...fleetView, async (req, res) => {
    try {
      const where: Prisma.FleetFuelingWhereInput = {};
      const vehicleId = String(req.query.vehicleId ?? "").trim();
      if (vehicleId && isUuid(vehicleId)) where.vehicleId = vehicleId;
      const rows = await prisma.fleetFueling.findMany({
        where,
        include: FUELING_INCLUDE,
        orderBy: { fuelingDate: "desc" },
        take: 300,
      });
      const fin = await showFinancial(req, getCurrentAppUser);
      const mapped = rows.map((f) => ({
        ...f,
        km: Number(f.km),
        liters: Number(f.liters),
        unitPrice: f.unitPrice != null ? Number(f.unitPrice) : null,
        totalValue: Number(f.totalValue),
        fuelingDate: f.fuelingDate.toISOString(),
      }));
      res.json({ fuelings: maskFinancialData(mapped, fin) });
    } catch (e) {
      fleetError(res, e, "GET fuelings");
    }
  });

  app.post("/api/fleet/fuelings", ...fleetWrite, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });
      const liters = parsePositiveLiters(body.liters);
      const km = parseDecimalKm(body.km);
      if (km == null) return res.status(400).json({ error: "Km é obrigatório." });
      const unitPrice = body.unitPrice != null ? Number(body.unitPrice) : null;
      let totalValue = body.totalValue != null ? Number(body.totalValue) : null;
      if (totalValue == null && unitPrice != null) totalValue = liters * unitPrice;
      if (totalValue == null) return res.status(400).json({ error: "Valor total é obrigatório." });
      assertNonNegativeAmount(totalValue);
      const allowBelow = Boolean(body.allowKmBelowCurrent);
      const user = await getCurrentAppUser(req);
      const driverId = isUuid(body.driverId)
        ? body.driverId
        : await suggestDriverForVehiclePeriod(vehicleId, new Date(body.fuelingDate ?? Date.now()));

      const fueling = await prisma.$transaction(async (tx) => {
        await assertFuelingKm(vehicleId, km, allowBelow);
        const f = await tx.fleetFueling.create({
          data: {
            vehicleId,
            driverId,
            fuelingDate: body.fuelingDate ? new Date(body.fuelingDate) : new Date(),
            km,
            fuelType: body.fuelType?.trim?.() ?? null,
            liters,
            unitPrice,
            totalValue,
            stationName: body.stationName?.trim?.() ?? null,
            receiptUrl: body.receiptUrl?.trim?.() ?? null,
            notes: body.notes?.trim?.() ?? null,
          },
          include: FUELING_INCLUDE,
        });
        if (body.createCost !== false) {
          await createFleetCostFromSource({
            vehicleId,
            costType: "COMBUSTIVEL",
            amount: totalValue,
            costDate: f.fuelingDate,
            supplierName: f.stationName,
            documentNumber: f.receiptUrl,
            notes: `Abastecimento ${f.id}`,
            userId: user?.id ?? null,
          });
        }
        return f;
      });

      await writeFleetAuditLog({
        entityType: "FleetFueling",
        entityId: fueling.id,
        action: "CREATE",
        newValue: String(fueling.liters),
        userId: user?.id ?? null,
      });

      const fin = await showFinancial(req, getCurrentAppUser);
      res.status(201).json({
        fueling: maskFinancialData(
          {
            ...fueling,
            km: Number(fueling.km),
            liters: Number(fueling.liters),
            totalValue: Number(fueling.totalValue),
          },
          fin
        ),
      });
    } catch (e) {
      fleetError(res, e, "POST fueling");
    }
  });

  app.put("/api/fleet/fuelings/:id", ...fleetWrite, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      const data: Prisma.FleetFuelingUpdateInput = {};
      if (body.fuelingDate) data.fuelingDate = new Date(body.fuelingDate);
      if (body.liters != null) data.liters = parsePositiveLiters(body.liters);
      if (body.km != null) {
        const km = parseDecimalKm(body.km);
        if (km != null) data.km = km;
      }
      if (body.totalValue != null) {
        assertNonNegativeAmount(Number(body.totalValue));
        data.totalValue = Number(body.totalValue);
      }
      const updated = await prisma.fleetFueling.update({
        where: { id },
        data,
        include: FUELING_INCLUDE,
      });
      res.json({ fueling: updated });
    } catch (e) {
      fleetError(res, e, "PUT fueling");
    }
  });

  // --- Fines ---
  app.get("/api/fleet/fines", ...fleetView, async (req, res) => {
    try {
      const where: Prisma.FleetFineWhereInput = {};
      const vehicleId = String(req.query.vehicleId ?? "").trim();
      const status = String(req.query.status ?? "").trim();
      if (vehicleId && isUuid(vehicleId)) where.vehicleId = vehicleId;
      if (status) where.status = status as FleetFineStatus;
      const rows = await prisma.fleetFine.findMany({
        where,
        include: {
          vehicle: { select: { plate: true, brand: true, model: true } },
          driver: { select: { name: true } },
        },
        orderBy: { infractionDate: "desc" },
        take: 300,
      });
      const fin = await showFinancial(req, getCurrentAppUser);
      res.json({
        fines: maskFinancialData(
          rows.map((f) => ({ ...f, amount: Number(f.amount), infractionDate: f.infractionDate.toISOString() })),
          fin
        ),
      });
    } catch (e) {
      fleetError(res, e, "GET fines");
    }
  });

  app.post("/api/fleet/fines", ...fleetWrite, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });
      const amount = Number(body.amount ?? 0);
      assertNonNegativeAmount(amount);
      const infractionDate = body.infractionDate ? new Date(body.infractionDate) : new Date();
      const noticeNumber = body.noticeNumber?.trim?.() ?? null;
      let duplicateWarning: string | null = null;
      if (noticeNumber) {
        const dup = await prisma.fleetFine.findFirst({
          where: { vehicleId, noticeNumber },
        });
        if (dup) duplicateWarning = "Já existe multa com este número de auto para o veículo.";
      }
      let driverId = isUuid(body.driverId) ? body.driverId : null;
      if (!driverId) driverId = await suggestDriverForVehiclePeriod(vehicleId, infractionDate);
      const status: FleetFineStatus = resolveFineInitialStatus(driverId);

      const created = await prisma.fleetFine.create({
        data: {
          vehicleId,
          driverId,
          reservationId: isUuid(body.reservationId) ? body.reservationId : null,
          infractionDate,
          location: body.location?.trim?.() ?? null,
          noticeNumber,
          agency: body.agency?.trim?.() ?? null,
          amount,
          points: body.points != null ? Number(body.points) : null,
          status,
          attachmentUrl: body.attachmentUrl?.trim?.() ?? null,
          notes: body.notes?.trim?.() ?? null,
        },
      });
      res.status(201).json({ fine: created, duplicateWarning });
    } catch (e) {
      fleetError(res, e, "POST fine");
    }
  });

  app.put("/api/fleet/fines/:id", ...fleetWrite, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      const updated = await prisma.fleetFine.update({
        where: { id },
        data: {
          driverId: isUuid(body.driverId) ? body.driverId : undefined,
          location: body.location !== undefined ? body.location?.trim?.() ?? null : undefined,
          notes: body.notes !== undefined ? body.notes?.trim?.() ?? null : undefined,
          points: body.points != null ? Number(body.points) : undefined,
        },
      });
      res.json({ fine: updated });
    } catch (e) {
      fleetError(res, e, "PUT fine");
    }
  });

  app.patch("/api/fleet/fines/:id/status", ...fleetWrite, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      const status = body.status as FleetFineStatus;
      if (!status) return res.status(400).json({ error: "Status obrigatório." });
      const user = await getCurrentAppUser(req);
      const existing = await prisma.fleetFine.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Multa não encontrada." });

      const updated = await prisma.fleetFine.update({
        where: { id },
        data: {
          status,
          paidAt: status === "PAID" ? new Date() : undefined,
          contestReason: body.contestReason?.trim?.() ?? undefined,
        },
      });

      if (status === "PAID" && body.createCost !== false) {
        await createFleetCostFromSource({
          vehicleId: existing.vehicleId,
          costType: "MULTA",
          amount: Number(existing.amount),
          costDate: new Date(),
          reservationId: existing.reservationId,
          documentNumber: existing.noticeNumber,
          notes: `Multa ${id}`,
          userId: user?.id ?? null,
        });
      }

      await writeFleetAuditLog({
        entityType: "FleetFine",
        entityId: id,
        action: "STATUS",
        newValue: status,
        userId: user?.id ?? null,
      });

      res.json({ fine: updated });
    } catch (e) {
      fleetError(res, e, "PATCH fine status");
    }
  });

  // --- Incidents ---
  app.get("/api/fleet/incidents", ...fleetView, async (req, res) => {
    try {
      const where: Prisma.FleetIncidentWhereInput = {};
      const vehicleId = String(req.query.vehicleId ?? "").trim();
      const status = String(req.query.status ?? "").trim();
      if (vehicleId && isUuid(vehicleId)) where.vehicleId = vehicleId;
      if (status) where.status = status as FleetIncidentStatus;
      const rows = await prisma.fleetIncident.findMany({
        where,
        include: {
          vehicle: { select: { plate: true, brand: true, model: true } },
          driver: { select: { name: true } },
        },
        orderBy: { incidentDate: "desc" },
        take: 300,
      });
      const fin = await showFinancial(req, getCurrentAppUser);
      res.json({
        incidents: maskFinancialData(
          rows.map((i) => ({
            ...i,
            deductibleValue: i.deductibleValue != null ? Number(i.deductibleValue) : null,
            incidentDate: i.incidentDate.toISOString(),
          })),
          fin
        ),
      });
    } catch (e) {
      fleetError(res, e, "GET incidents");
    }
  });

  app.post("/api/fleet/incidents", ...fleetWrite, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });
      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (!description) return res.status(400).json({ error: "Descrição é obrigatória." });
      const severity = String(body.severity ?? "MEDIA").trim().toUpperCase();
      const blocksVehicle = incidentBlocksVehicle(severity, body.blocksVehicle);
      const user = await getCurrentAppUser(req);

      const incident = await prisma.$transaction(async (tx) => {
        const inc = await tx.fleetIncident.create({
          data: {
            vehicleId,
            driverId: isUuid(body.driverId) ? body.driverId : null,
            reservationId: isUuid(body.reservationId) ? body.reservationId : null,
            incidentType: body.incidentType?.trim?.() || "AVARIA",
            incidentDate: body.incidentDate ? new Date(body.incidentDate) : new Date(),
            location: body.location?.trim?.() ?? null,
            description,
            severity,
            status: "OPEN",
            insuranceClaimNumber: body.insuranceClaimNumber?.trim?.() ?? null,
            deductibleValue:
              body.deductibleValue != null ? Number(body.deductibleValue) : null,
            blocksVehicle,
            notes: body.notes?.trim?.() ?? null,
          },
        });
        if (blocksVehicle) {
          const st = resolveMaintenanceVehicleStatus("CRITICA", true) ?? "BLOCKED";
          await tx.fleetVehicle.update({ where: { id: vehicleId }, data: { status: st } });
        }
        return inc;
      });

      let maintenanceId: string | null = null;
      if (body.openMaintenance) {
        const m = await createMaintenance({
          vehicleId,
          reservationId: isUuid(body.reservationId) ? body.reservationId : null,
          body: {
            description: `Manutenção vinculada ao incidente: ${description}`,
            maintenanceType: "CORRETIVA",
            priority: "ALTA",
            blocksVehicle: true,
          },
          userId: user?.id ?? null,
        });
        maintenanceId = m.id;
      }

      await writeFleetAuditLog({
        entityType: "FleetIncident",
        entityId: incident.id,
        action: "CREATE",
        userId: user?.id ?? null,
      });

      res.status(201).json({ incident, maintenanceId });
    } catch (e) {
      fleetError(res, e, "POST incident");
    }
  });

  app.put("/api/fleet/incidents/:id", ...fleetWrite, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      const updated = await prisma.fleetIncident.update({
        where: { id },
        data: {
          description: body.description?.trim?.(),
          severity: body.severity?.trim?.(),
          location: body.location !== undefined ? body.location?.trim?.() ?? null : undefined,
          notes: body.notes !== undefined ? body.notes?.trim?.() ?? null : undefined,
          insuranceClaimNumber:
            body.insuranceClaimNumber !== undefined
              ? body.insuranceClaimNumber?.trim?.() ?? null
              : undefined,
        },
      });
      res.json({ incident: updated });
    } catch (e) {
      fleetError(res, e, "PUT incident");
    }
  });

  app.patch("/api/fleet/incidents/:id/status", ...fleetWrite, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const status = req.body?.status as FleetIncidentStatus;
      if (!status) return res.status(400).json({ error: "Status obrigatório." });
      const existing = await prisma.fleetIncident.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Incidente não encontrado." });
      const user = await getCurrentAppUser(req);
      const updated = await prisma.fleetIncident.update({
        where: { id },
        data: { status },
      });
      if (["RESOLVED", "CANCELED"].includes(status) && existing.blocksVehicle) {
        await syncVehicleStatusAfterMaintenance(existing.vehicleId);
      }
      await writeFleetAuditLog({
        entityType: "FleetIncident",
        entityId: id,
        action: "STATUS",
        newValue: status,
        userId: user?.id ?? null,
      });
      res.json({ incident: updated });
    } catch (e) {
      fleetError(res, e, "PATCH incident status");
    }
  });

  // --- Attachments (metadata + fileUrl) ---
  app.get("/api/fleet/attachments", ...fleetView, async (req, res) => {
    try {
      const where: Prisma.FleetAttachmentWhereInput = {};
      for (const key of [
        "vehicleId",
        "contractId",
        "documentId",
        "maintenanceId",
        "fineId",
        "incidentId",
        "reservationId",
      ] as const) {
        const v = String(req.query[key] ?? "").trim();
        if (v && isUuid(v)) where[key] = v;
      }
      const rows = await prisma.fleetAttachment.findMany({
        where,
        orderBy: { uploadedAt: "desc" },
        take: 200,
      });
      res.json({ attachments: rows });
    } catch (e) {
      fleetError(res, e, "GET attachments");
    }
  });

  app.post("/api/fleet/attachments", ...fleetWrite, async (req, res) => {
    try {
      const body = req.body ?? {};
      const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
      const fileUrl = typeof body.fileUrl === "string" ? body.fileUrl.trim() : "";
      if (!fileName || !fileUrl) {
        return res.status(400).json({ error: "fileName e fileUrl são obrigatórios." });
      }
      if (fileUrl.startsWith("data:")) {
        return res.status(400).json({ error: "Não enviar base64; informe URL do arquivo." });
      }
      const user = await getCurrentAppUser(req);
      const created = await prisma.fleetAttachment.create({
        data: {
          vehicleId: isUuid(body.vehicleId) ? body.vehicleId : null,
          contractId: isUuid(body.contractId) ? body.contractId : null,
          documentId: isUuid(body.documentId) ? body.documentId : null,
          maintenanceId: isUuid(body.maintenanceId) ? body.maintenanceId : null,
          fineId: isUuid(body.fineId) ? body.fineId : null,
          incidentId: isUuid(body.incidentId) ? body.incidentId : null,
          reservationId: isUuid(body.reservationId) ? body.reservationId : null,
          attachmentType: body.attachmentType?.trim?.() || "OUTRO",
          fileName,
          fileUrl,
          uploadedBy: user?.email ?? user?.name ?? null,
          notes: body.notes?.trim?.() ?? null,
        },
      });
      await writeFleetAuditLog({
        entityType: "FleetAttachment",
        entityId: created.id,
        action: "CREATE",
        userId: user?.id ?? null,
      });
      res.status(201).json({ attachment: created });
    } catch (e) {
      fleetError(res, e, "POST attachment");
    }
  });

  app.patch("/api/fleet/attachments/:id/remove", ...fleetWrite, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      await prisma.fleetAttachment.delete({ where: { id } });
      await writeFleetAuditLog({
        entityType: "FleetAttachment",
        entityId: id,
        action: "DELETE",
        userId: user?.id ?? null,
      });
      res.json({ ok: true });
    } catch (e) {
      fleetError(res, e, "PATCH remove attachment");
    }
  });
}
