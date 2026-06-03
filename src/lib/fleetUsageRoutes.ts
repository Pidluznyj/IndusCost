import type express from "express";
import { prisma } from "@/src/lib/prisma.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import { loadFleetSettings } from "@/src/lib/fleetService.js";
import { getReservationOrThrow } from "@/src/lib/fleetReservationOps.js";
import { resolveMobileUsageMode } from "@/src/lib/fleetMobileUsage.js";
import { getUsageByReservationId, serializeUsage, USAGE_INCLUDE } from "@/src/lib/fleetUsageOps.js";

type AuthGuards = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (p: string) => express.RequestHandler;
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

export function registerFleetUsageRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requirePermission } = auth;
  const fleetView = [requireAppAuth, requirePermission("fleet.view")] as express.RequestHandler[];

  app.get("/api/fleet/reservations/:id/usage-context", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const reservation = await getReservationOrThrow(id);
      const mode = resolveMobileUsageMode(reservation.status);
      const settings = await loadFleetSettings();
      let usage: ReturnType<typeof serializeUsage> | null = null;
      if (mode === "checkin") {
        const row = await prisma.fleetUsage.findUnique({
          where: { reservationId: id },
          include: USAGE_INCLUDE,
        });
        if (row) usage = serializeUsage(row);
      }
      res.json({
        reservation: {
          ...reservation,
          startDateTime: reservation.startDateTime.toISOString(),
          endDateTime: reservation.endDateTime.toISOString(),
          createdAt: reservation.createdAt.toISOString(),
          updatedAt: reservation.updatedAt.toISOString(),
          vehicle: reservation.vehicle
            ? { ...reservation.vehicle, currentKm: Number(reservation.vehicle.currentKm) }
            : reservation.vehicle,
          driver: reservation.driver
            ? {
                ...reservation.driver,
                cnhExpirationDate:
                  reservation.driver.cnhExpirationDate?.toISOString() ?? null,
              }
            : reservation.driver,
        },
        mode,
        usage,
        settings: {
          checklistRetiradaObrigatorio: settings.checklistRetiradaObrigatorio,
          checklistDevolucaoObrigatorio: settings.checklistDevolucaoObrigatorio,
          bloquearRetiradaCnhVencida: settings.bloquearRetiradaCnhVencida,
        },
      });
    } catch (e) {
      if (e instanceof FleetValidationError && e.message.includes("não encontrada")) {
        return res.status(404).json({ error: e.message });
      }
      fleetError(res, e, "GET usage-context");
    }
  });

  app.get("/api/fleet/reservations/:id/usage", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const usage = await getUsageByReservationId(id);
      res.json({ usage });
    } catch (e) {
      if (e instanceof FleetValidationError && e.message.includes("não encontrado")) {
        return res.status(404).json({ error: e.message });
      }
      fleetError(res, e, "GET reservation usage");
    }
  });

  app.get("/api/fleet/vehicles/:id/usages", ...fleetView, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const usages = await prisma.fleetUsage.findMany({
        where: { vehicleId: id },
        include: USAGE_INCLUDE,
        orderBy: { checkoutAt: "desc" },
        take: 100,
      });
      res.json({ usages: usages.map(serializeUsage) });
    } catch (e) {
      fleetError(res, e, "GET vehicle usages");
    }
  });
}
