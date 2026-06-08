import type express from "express";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import { handleFleetRouteError } from "@/src/lib/fleetErrors.js";
import {
  assertFleetReservationsCleanupSuperAdmin,
  executeFleetReservationsCleanup,
  previewFleetReservationsCleanup,
} from "@/src/lib/fleetReservationsCleanup.js";
import type { FleetAuthGuards } from "@/src/lib/fleetRouteGuards.js";

export function registerFleetReservationsCleanupRoutes(
  app: express.Express,
  auth: FleetAuthGuards
) {
  const { requireAppAuth, getCurrentAppUser } = auth;

  app.get(
    "/api/fleet/admin/reservations-cleanup-preview",
    requireAppAuth,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        assertFleetReservationsCleanupSuperAdmin(user);
        const preview = await previewFleetReservationsCleanup();
        res.json({ preview });
      } catch (e) {
        if (e instanceof FleetValidationError) {
          return res.status(403).json({ error: e.message, code: "FLEET_CLEANUP_FORBIDDEN" });
        }
        handleFleetRouteError(res, e, "GET /api/fleet/admin/reservations-cleanup-preview", req);
      }
    }
  );

  app.post("/api/fleet/admin/reservations-cleanup", requireAppAuth, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      assertFleetReservationsCleanupSuperAdmin(user);

      const confirmation =
        typeof req.body?.confirmation === "string" ? req.body.confirmation : "";

      const result = await executeFleetReservationsCleanup({
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        confirmation,
      });

      res.json({ ok: true, deleted: result });
    } catch (e) {
      if (e instanceof FleetValidationError) {
        const status = e.message.includes("Confirmação inválida") ? 400 : 403;
        return res.status(status).json({ error: e.message, code: "FLEET_CLEANUP_VALIDATION" });
      }
      handleFleetRouteError(res, e, "POST /api/fleet/admin/reservations-cleanup", req);
    }
  });
}
