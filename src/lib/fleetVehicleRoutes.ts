import type express from "express";
import type { FleetVehicle } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { hasPermission, type AppAuthContext } from "@/src/lib/appAuth.js";
import {
  FleetValidationError,
  assertBlockReason,
  normalizePlate,
} from "@/src/lib/fleetValidation.js";
import {
  assertUniqueActivePlate,
  writeFleetAuditLog,
} from "@/src/lib/fleetService.js";
import {
  assertNoFutureActiveReservations,
  buildVehicleAlerts,
  buildVehicleFormData,
  changeVehicleStatus,
  disposeVehicle,
  getVehicleOrThrow,
  listRelatedVehicleAudit,
  parseContractInput,
  parseDocumentInput,
  refreshDocumentStatuses,
  serializeContract,
  serializeFleetVehicle,
} from "@/src/lib/fleetVehicleOps.js";

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
  if (e instanceof FleetValidationError) {
    return res.status(400).json({ error: e.message });
  }
  console.error(logLabel, e);
  const msg = e instanceof Error ? e.message : "Erro interno.";
  return res.status(500).json({ error: msg });
}

async function actorId(
  req: express.Request,
  getCurrentAppUser: AuthGuards["getCurrentAppUser"]
) {
  const u = await getCurrentAppUser(req);
  return u?.id ?? u?.email ?? null;
}

async function canViewFinancial(
  req: express.Request,
  getCurrentAppUser: AuthGuards["getCurrentAppUser"]
) {
  const u = await getCurrentAppUser(req);
  return u
    ? hasPermission(u, "fleet.financial.view") || hasPermission(u, "fleet.manage")
    : false;
}

export function registerFleetVehicleExtendedRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requirePermission, requireAnyPermission, getCurrentAppUser } = auth;

  const fleetView = [requireAppAuth, requirePermission("fleet.view")] as express.RequestHandler[];
  const fleetVehiclesEdit = [
    requireAppAuth,
    requireAnyPermission(["fleet.vehicles.edit", "fleet.manage"]),
  ] as express.RequestHandler[];
  const fleetManageOnly = [requireAppAuth, requirePermission("fleet.manage")] as express.RequestHandler[];

  const lifecycleHandler =
    (
      action: string,
      targetStatus: FleetVehicle["status"],
      options?: { dispose?: boolean }
    ) =>
    async (req: express.Request, res: express.Response) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const reason =
          action === "BLOCK" || action === "UNBLOCK"
            ? assertBlockReason(req.body?.reason)
            : typeof req.body?.reason === "string"
              ? req.body.reason.trim() || null
              : null;

        const userId = await actorId(req, getCurrentAppUser);
        const updated = options?.dispose
          ? await disposeVehicle(
              id,
              targetStatus as "INACTIVE" | "SOLD" | "RETURNED",
              userId,
              action,
              reason
            )
          : await changeVehicleStatus(id, targetStatus, userId, action, reason);

        res.json({ vehicle: serializeFleetVehicle(updated) });
      } catch (e) {
        fleetError(res, e, `POST vehicle ${action}`);
      }
    };

  app.post("/api/fleet/vehicles/:id/block", ...fleetManageOnly, lifecycleHandler("BLOCK", "BLOCKED"));
  app.post(
    "/api/fleet/vehicles/:id/unblock",
    ...fleetManageOnly,
    lifecycleHandler("UNBLOCK", "AVAILABLE")
  );
  app.post(
    "/api/fleet/vehicles/:id/deactivate",
    ...fleetManageOnly,
    lifecycleHandler("DEACTIVATE", "INACTIVE", { dispose: true })
  );
  app.post(
    "/api/fleet/vehicles/:id/sell",
    ...fleetManageOnly,
    lifecycleHandler("SELL", "SOLD", { dispose: true })
  );
  app.post(
    "/api/fleet/vehicles/:id/return-to-lessor",
    ...fleetManageOnly,
    lifecycleHandler("RETURN_TO_LESSOR", "RETURNED", { dispose: true })
  );

  app.get("/api/fleet/vehicles/:id/audit", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      await getVehicleOrThrow(id);
      const logs = await listRelatedVehicleAudit(id);
      res.json({ auditLogs: logs });
    } catch (e) {
      fleetError(res, e, "GET vehicle audit");
    }
  });

  // --- Contracts ---
  app.get("/api/fleet/vehicles/:id/contracts", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      await getVehicleOrThrow(id);
      const financial = await canViewFinancial(req, getCurrentAppUser);
      const contracts = await prisma.fleetVehicleContract.findMany({
        where: { vehicleId: id },
        orderBy: { startDate: "desc" },
      });
      res.json({
        contracts: contracts.map((c) => serializeContract(c, financial)),
      });
    } catch (e) {
      fleetError(res, e, "GET contracts");
    }
  });

  app.post("/api/fleet/vehicles/:id/contracts", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      await getVehicleOrThrow(id);
      const data = parseContractInput(req.body ?? {});
      const userId = await actorId(req, getCurrentAppUser);
      const created = await prisma.fleetVehicleContract.create({
        data: { vehicleId: id, ...data },
      });
      await writeFleetAuditLog({
        entityType: "FleetVehicleContract",
        entityId: created.id,
        action: "CREATE",
        newValue: JSON.stringify({ contractNumber: created.contractNumber, status: created.status }),
        userId,
      });
      const financial = await canViewFinancial(req, getCurrentAppUser);
      res.status(201).json({ contract: serializeContract(created, financial) });
    } catch (e) {
      fleetError(res, e, "POST contract");
    }
  });

  app.put("/api/fleet/contracts/:id", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetVehicleContract.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Contrato não encontrado." });
      const data = parseContractInput({
        supplierName: existing.supplierName,
        supplierDocument: existing.supplierDocument,
        contractNumber: existing.contractNumber,
        contractType: existing.contractType,
        startDate: existing.startDate,
        endDate: existing.endDate,
        monthlyValue: existing.monthlyValue != null ? Number(existing.monthlyValue) : null,
        billingDay: existing.billingDay,
        kmFranchise: existing.kmFranchise != null ? Number(existing.kmFranchise) : null,
        excessKmValue: existing.excessKmValue != null ? Number(existing.excessKmValue) : null,
        status: existing.status,
        notes: existing.notes,
        ...(req.body ?? {}),
      });
      const userId = await actorId(req, getCurrentAppUser);
      const updated = await prisma.fleetVehicleContract.update({
        where: { id },
        data,
      });
      await writeFleetAuditLog({
        entityType: "FleetVehicleContract",
        entityId: id,
        action: "UPDATE",
        oldValue: JSON.stringify({ status: existing.status }),
        newValue: JSON.stringify({ status: updated.status }),
        userId,
      });
      const financial = await canViewFinancial(req, getCurrentAppUser);
      res.json({ contract: serializeContract(updated, financial) });
    } catch (e) {
      fleetError(res, e, "PUT contract");
    }
  });

  app.patch("/api/fleet/contracts/:id/cancel", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetVehicleContract.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Contrato não encontrado." });
      const userId = await actorId(req, getCurrentAppUser);
      const updated = await prisma.fleetVehicleContract.update({
        where: { id },
        data: { status: "INACTIVE" },
      });
      await writeFleetAuditLog({
        entityType: "FleetVehicleContract",
        entityId: id,
        action: "CANCEL",
        oldValue: existing.status,
        newValue: updated.status,
        reason: typeof req.body?.reason === "string" ? req.body.reason : null,
        userId,
      });
      const financial = await canViewFinancial(req, getCurrentAppUser);
      res.json({ contract: serializeContract(updated, financial) });
    } catch (e) {
      fleetError(res, e, "PATCH contract cancel");
    }
  });

  // --- Documents ---
  app.get("/api/fleet/vehicles/:id/documents", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      await getVehicleOrThrow(id);
      await refreshDocumentStatuses(id);
      const documents = await prisma.fleetVehicleDocument.findMany({
        where: { vehicleId: id },
        orderBy: [{ status: "asc" }, { expirationDate: "asc" }],
      });
      res.json({ documents });
    } catch (e) {
      fleetError(res, e, "GET documents");
    }
  });

  app.post("/api/fleet/vehicles/:id/documents", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      await getVehicleOrThrow(id);
      const { loadFleetSettings } = await import("@/src/lib/fleetService.js");
      const settings = await loadFleetSettings();
      const alertDays = Number(settings.diasAlertaDocumento ?? "30") || 30;
      const data = parseDocumentInput(req.body ?? {}, alertDays);
      const userId = await actorId(req, getCurrentAppUser);
      const created = await prisma.fleetVehicleDocument.create({
        data: { vehicleId: id, ...data },
      });
      await writeFleetAuditLog({
        entityType: "FleetVehicleDocument",
        entityId: created.id,
        action: "CREATE",
        newValue: JSON.stringify({ documentType: created.documentType, status: created.status }),
        userId,
      });
      res.status(201).json({ document: created });
    } catch (e) {
      fleetError(res, e, "POST document");
    }
  });

  app.put("/api/fleet/documents/:id", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetVehicleDocument.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Documento não encontrado." });
      if (existing.status === "REPLACED") {
        return res.status(400).json({ error: "Documento substituído não pode ser editado." });
      }
      const { loadFleetSettings } = await import("@/src/lib/fleetService.js");
      const settings = await loadFleetSettings();
      const alertDays = Number(settings.diasAlertaDocumento ?? "30") || 30;
      const data = parseDocumentInput({ ...existing, ...req.body }, alertDays);
      const userId = await actorId(req, getCurrentAppUser);
      const updated = await prisma.fleetVehicleDocument.update({
        where: { id },
        data,
      });
      await writeFleetAuditLog({
        entityType: "FleetVehicleDocument",
        entityId: id,
        action: "UPDATE",
        oldValue: JSON.stringify({ status: existing.status }),
        newValue: JSON.stringify({ status: updated.status }),
        userId,
      });
      res.json({ document: updated });
    } catch (e) {
      fleetError(res, e, "PUT document");
    }
  });

  app.patch("/api/fleet/documents/:id/replace", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetVehicleDocument.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Documento não encontrado." });
      if (existing.status === "REPLACED") {
        return res.status(400).json({ error: "Documento já foi substituído." });
      }

      const { loadFleetSettings } = await import("@/src/lib/fleetService.js");
      const settings = await loadFleetSettings();
      const alertDays = Number(settings.diasAlertaDocumento ?? "30") || 30;
      const data = parseDocumentInput(req.body ?? {}, alertDays);
      const userId = await actorId(req, getCurrentAppUser);

      const [replaced, created] = await prisma.$transaction([
        prisma.fleetVehicleDocument.update({
          where: { id },
          data: { status: "REPLACED" },
        }),
        prisma.fleetVehicleDocument.create({
          data: {
            vehicleId: existing.vehicleId,
            ...data,
          },
        }),
      ]);

      await writeFleetAuditLog({
        entityType: "FleetVehicleDocument",
        entityId: id,
        action: "REPLACE",
        oldValue: existing.status,
        newValue: "REPLACED",
        reason: `Substituído por ${created.id}`,
        userId,
      });
      await writeFleetAuditLog({
        entityType: "FleetVehicleDocument",
        entityId: created.id,
        action: "CREATE_REPLACEMENT",
        newValue: JSON.stringify({ documentType: created.documentType }),
        userId,
      });

      res.json({ replacedDocument: replaced, document: created });
    } catch (e) {
      fleetError(res, e, "PATCH document replace");
    }
  });

  app.patch("/api/fleet/documents/:id/inactivate", ...fleetVehiclesEdit, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const existing = await prisma.fleetVehicleDocument.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Documento não encontrado." });
      const userId = await actorId(req, getCurrentAppUser);
      const updated = await prisma.fleetVehicleDocument.update({
        where: { id },
        data: { status: "REPLACED", notes: existing.notes ?? "Inativado" },
      });
      await writeFleetAuditLog({
        entityType: "FleetVehicleDocument",
        entityId: id,
        action: "INACTIVATE",
        oldValue: existing.status,
        newValue: updated.status,
        userId,
      });
      res.json({ document: updated });
    } catch (e) {
      fleetError(res, e, "PATCH document inactivate");
    }
  });
}

/** Enriquece resposta da listagem de veículos com alertas. */
export async function enrichVehiclesWithAlerts<
  T extends {
    id: string;
    origin: import("@prisma/client").FleetVehicleOrigin;
    status: import("@prisma/client").FleetVehicleStatus;
  },
>(vehicles: T[]) {
  return Promise.all(
    vehicles.map(async (v) => ({
      ...v,
      alerts: await buildVehicleAlerts(v),
    }))
  );
}

export { buildVehicleAlerts, buildVehicleFormData, assertUniqueActivePlate, normalizePlate };
