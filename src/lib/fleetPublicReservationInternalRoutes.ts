import type express from "express";
import { createFleetRouteGuards, type FleetAuthGuards } from "@/src/lib/fleetRouteGuards.js";
import { handleFleetRouteError } from "@/src/lib/fleetErrors.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import {
  approvePublicReservationDriver,
  approvePublicReservationRequest,
  ensurePublicReservationToken,
  getInternalPublicReservationLink,
  getPublicReservationRequestOrThrow,
  listPublicReservationRequests,
  rejectPublicReservationDriver,
  rejectPublicReservationRequest,
  serializePublicRequestDriver,
  serializePublicRequestItem,
} from "@/src/lib/fleetPublicReservationService.js";
import { buildPublicReservationUrl } from "@/src/lib/fleetPublicReservationLink.js";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function registerFleetPublicReservationInternalRoutes(
  app: express.Express,
  auth: FleetAuthGuards
) {
  const { getCurrentAppUser } = auth;
  const g = createFleetRouteGuards(auth);

  app.get("/api/fleet/public-reservation/link", ...g.view, async (req, res) => {
    try {
      const origin = `${req.protocol}://${req.get("host") ?? ""}`;
      res.json(await getInternalPublicReservationLink(origin));
    } catch (e) {
      handleFleetRouteError(res, e, "GET public-reservation link", req);
    }
  });

  app.post("/api/fleet/public-reservation/regenerate-token", ...g.settingsManage, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const token = await ensurePublicReservationToken(user?.id ?? null);
      const origin = `${req.protocol}://${req.get("host") ?? ""}`;
      const link = await getInternalPublicReservationLink(origin);
      res.json({
        token,
        baseUrl: link.baseUrl,
        url: link.baseUrl ? buildPublicReservationUrl(token, link.baseUrl) : null,
      });
    } catch (e) {
      handleFleetRouteError(res, e, "POST regenerate token", req);
    }
  });

  app.get("/api/fleet/public-reservation-requests", ...g.view, async (req, res) => {
    try {
      const status = String(req.query.status ?? "").trim() || undefined;
      const page = parseInt(String(req.query.page ?? "1"), 10);
      const limit = parseInt(String(req.query.limit ?? "25"), 10);
      const result = await listPublicReservationRequests({ status, page, limit });
      res.json({
        ...result,
        items: result.items.map((item) => serializePublicRequestItem(item)),
      });
    } catch (e) {
      handleFleetRouteError(res, e, "GET public-reservation-requests", req);
    }
  });

  app.get("/api/fleet/public-reservation-requests/:id", ...g.view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const request = await getPublicReservationRequestOrThrow(id);
      res.json({ request: serializePublicRequestItem(request) });
    } catch (e) {
      handleFleetRouteError(res, e, "GET public-reservation-request", req);
    }
  });

  app.post(
    "/api/fleet/public-reservation-requests/:id/approve-driver",
    ...g.reservationsApprove,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const result = await approvePublicReservationDriver({
          id,
          reviewedByUserId: user?.id ?? null,
          reviewedByLabel: user?.email ?? user?.name ?? null,
        });
        res.json({
          request: {
            ...result.request,
            driver: serializePublicRequestDriver(result.request.driver),
          },
        });
      } catch (e) {
        handleFleetRouteError(res, e, "POST approve public request driver", req);
      }
    }
  );

  app.post(
    "/api/fleet/public-reservation-requests/:id/reject-driver",
    ...g.reservationsApprove,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const result = await rejectPublicReservationDriver({
          id,
          reason: req.body?.reason,
          reviewedByUserId: user?.id ?? null,
        });
        res.json({
          request: {
            ...result.request,
            driver: serializePublicRequestDriver(result.request.driver),
          },
        });
      } catch (e) {
        if (e instanceof FleetValidationError && e.message.includes("Motivo")) {
          res.status(400).json({ error: e.message });
          return;
        }
        handleFleetRouteError(res, e, "POST reject public request driver", req);
      }
    }
  );

  app.patch(
    "/api/fleet/public-reservation-requests/:id/approve",
    ...g.reservationsApprove,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const result = await approvePublicReservationRequest({
          id,
          vehicleId: String(req.body?.vehicleId ?? ""),
          driverId: String(req.body?.driverId ?? ""),
          reviewedByUserId: user?.id ?? null,
          reviewedByLabel: user?.email ?? user?.name ?? null,
        });
        res.json(result);
      } catch (e) {
        handleFleetRouteError(res, e, "PATCH approve public request", req);
      }
    }
  );

  app.patch(
    "/api/fleet/public-reservation-requests/:id/reject",
    ...g.reservationsApprove,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const updated = await rejectPublicReservationRequest({
          id,
          reason: req.body?.reason,
          reviewedByUserId: user?.id ?? null,
        });
        res.json({ request: updated });
      } catch (e) {
        if (e instanceof FleetValidationError && e.message.includes("Motivo")) {
          res.status(400).json({ error: e.message });
          return;
        }
        handleFleetRouteError(res, e, "PATCH reject public request", req);
      }
    }
  );
}
