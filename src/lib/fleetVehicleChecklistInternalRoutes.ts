import type express from "express";
import { prisma } from "@/src/lib/prisma.js";
import { handleFleetRouteError } from "@/src/lib/fleetErrors.js";
import { createFleetRouteGuards, type FleetAuthGuards } from "@/src/lib/fleetRouteGuards.js";
import {
  ensureVehicleChecklistToken,
  getVehicleChecklistTokenInfo,
  listReservationChecklists,
  listVehicleReservationChecklists,
  regenerateVehicleChecklistToken,
  revokeVehicleChecklistToken,
  getReservationChecklistSummary,
} from "@/src/lib/fleetVehicleChecklistOps.js";
import { buildVehicleChecklistPublicUrl } from "@/src/lib/fleetVehicleChecklistLink.js";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function registerFleetVehicleChecklistInternalRoutes(
  app: express.Express,
  auth: FleetAuthGuards
) {
  const { getCurrentAppUser } = auth;
  const g = createFleetRouteGuards(auth);

  app.get("/api/fleet/vehicles/:vehicleId/checklist-token", ...g.view, async (req, res) => {
    try {
      const { vehicleId } = req.params;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "ID inválido." });
      const origin = `${req.protocol}://${req.get("host") ?? ""}`;
      res.json(await getVehicleChecklistTokenInfo(vehicleId, origin));
    } catch (e) {
      handleFleetRouteError(res, e, "GET vehicle checklist-token", req);
    }
  });

  app.post("/api/fleet/vehicles/:vehicleId/checklist-token", ...g.vehiclesEdit, async (req, res) => {
    try {
      const { vehicleId } = req.params;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const row = await ensureVehicleChecklistToken(vehicleId, user?.id ?? null);
      const origin = `${req.protocol}://${req.get("host") ?? ""}`;
      const info = await getVehicleChecklistTokenInfo(vehicleId, origin);
      res.status(201).json({
        token: row.publicToken,
        status: row.status,
        publicUrl: buildVehicleChecklistPublicUrl(row.publicToken, info.baseUrl),
        ...info,
      });
    } catch (e) {
      handleFleetRouteError(res, e, "POST vehicle checklist-token", req);
    }
  });

  app.post(
    "/api/fleet/vehicles/:vehicleId/checklist-token/regenerate",
    ...g.vehiclesEdit,
    async (req, res) => {
      try {
        const { vehicleId } = req.params;
        if (!isUuid(vehicleId)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const row = await regenerateVehicleChecklistToken(vehicleId, user?.id ?? null);
        const origin = `${req.protocol}://${req.get("host") ?? ""}`;
        const info = await getVehicleChecklistTokenInfo(vehicleId, origin);
        res.json({
          token: row.publicToken,
          status: row.status,
          publicUrl: buildVehicleChecklistPublicUrl(row.publicToken, info.baseUrl),
          ...info,
        });
      } catch (e) {
        handleFleetRouteError(res, e, "POST regenerate vehicle checklist-token", req);
      }
    }
  );

  app.post(
    "/api/fleet/vehicles/:vehicleId/checklist-token/revoke",
    ...g.vehiclesEdit,
    async (req, res) => {
      try {
        const { vehicleId } = req.params;
        if (!isUuid(vehicleId)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const row = await revokeVehicleChecklistToken(vehicleId, user?.id ?? null);
        res.json({ status: row.status, revokedAt: row.revokedAt?.toISOString() ?? null });
      } catch (e) {
        handleFleetRouteError(res, e, "POST revoke vehicle checklist-token", req);
      }
    }
  );

  app.get("/api/fleet/reservations/:id/checklists", ...g.view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const [checklists, summary] = await Promise.all([
        listReservationChecklists(id),
        getReservationChecklistSummary(id),
      ]);
      res.json({ checklists, summary });
    } catch (e) {
      handleFleetRouteError(res, e, "GET reservation checklists", req);
    }
  });

  app.get("/api/fleet/vehicles/:vehicleId/checklists", ...g.view, async (req, res) => {
    try {
      const { vehicleId } = req.params;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "ID inválido." });
      const checklists = await listVehicleReservationChecklists(vehicleId);
      res.json({ checklists });
    } catch (e) {
      handleFleetRouteError(res, e, "GET vehicle checklists", req);
    }
  });

  app.get("/api/fleet/reservation-checklists/:id", ...g.view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await prisma.fleetReservationChecklist.findUnique({
        where: { id },
        include: {
          items: { orderBy: { code: "asc" } },
          driver: { select: { id: true, name: true, cpf: true } },
          reservation: {
            select: {
              id: true,
              status: true,
              startDateTime: true,
              endDateTime: true,
              destination: true,
            },
          },
          vehicle: { select: { id: true, plate: true, brand: true, model: true } },
          triggeredByChecklist: { select: { id: true, type: true, reservationId: true } },
        },
      });
      if (!row) return res.status(404).json({ error: "Checklist não encontrado." });
      const { serializeReservationChecklist } = await import("@/src/lib/fleetVehicleChecklistOps.js");
      res.json({ checklist: serializeReservationChecklist(row) });
    } catch (e) {
      handleFleetRouteError(res, e, "GET reservation-checklist detail", req);
    }
  });
}
