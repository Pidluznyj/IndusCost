import type express from "express";
import { handleFleetRouteError } from "@/src/lib/fleetErrors.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import {
  createPublicReservationRequest,
  getPublicReservationAvailability,
  getPublicReservationConfig,
  type FleetPublicTokenFailure,
} from "@/src/lib/fleetPublicReservationService.js";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_POST = 10;
const postHits = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: express.Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

function checkPostRateLimit(req: express.Request): boolean {
  const key = clientKey(req);
  const now = Date.now();
  const entry = postHits.get(key);
  if (!entry || now >= entry.resetAt) {
    postHits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX_POST) return false;
  entry.count += 1;
  return true;
}

function publicTokenStatus(resolved: FleetPublicTokenFailure, res: express.Response): void {
  if (resolved.reason === "disabled") {
    res.status(403).json({ error: "Solicitação pública desativada." });
    return;
  }
  res.status(404).json({ error: "Link inválido ou expirado." });
}

export function registerFleetPublicReservationRoutes(app: express.Express) {
  app.get("/api/public/fleet/reservation/:token/config", async (req, res) => {
    try {
      const result = await getPublicReservationConfig(String(req.params.token ?? ""));
      if (result.ok === false) {
        publicTokenStatus(result, res);
        return;
      }
      res.json(result.config);
    } catch (e) {
      handleFleetRouteError(res, e, "GET public reservation config", req);
    }
  });

  app.get("/api/public/fleet/reservation/:token/availability", async (req, res) => {
    try {
      const date = String(req.query.date ?? "").trim();
      const vehicleId = String(req.query.vehicleId ?? "").trim() || undefined;
      const result = await getPublicReservationAvailability(
        String(req.params.token ?? ""),
        date,
        vehicleId
      );
      if (result.ok === false) {
        publicTokenStatus(result, res);
        return;
      }
      res.json({
        date: result.date,
        slots: result.slots.map((s) => ({
          start: s.start,
          end: s.end,
          label: s.label,
          available: s.available,
          vehiclesAvailable: s.vehiclesAvailable,
        })),
        vehicles: result.vehicles,
      });
    } catch (e) {
      handleFleetRouteError(res, e, "GET public reservation availability", req);
    }
  });

  app.post("/api/public/fleet/reservation/:token/request", async (req, res) => {
    try {
      if (!checkPostRateLimit(req)) {
        res.status(429).json({ error: "Muitas solicitações. Tente novamente em instantes." });
        return;
      }

      const body = req.body ?? {};
      const result = await createPublicReservationRequest(String(req.params.token ?? ""), {
        requesterName: body.requesterName,
        requesterEmail: body.requesterEmail,
        requesterPhone: body.requesterPhone,
        requesterDepartment: body.requesterDepartment,
        requesterEmployeeId: body.requesterEmployeeId,
        responsibilityAccepted: body.responsibilityAccepted,
        requestedDate: body.requestedDate,
        startTime: body.startTime,
        endTime: body.endTime,
        reason: body.reason,
        destination: body.destination,
        notes: body.notes,
        passengersCount: body.passengersCount,
        hasCargo: body.hasCargo,
        cargoDescription: body.cargoDescription,
        vehicleId: body.vehicleId,
      });

      if (result.ok === false) {
        publicTokenStatus(result, res);
        return;
      }

      res.status(201).json({
        publicCode: result.request.publicCode,
        status: result.request.status,
        message:
          "Sua solicitação foi enviada e será analisada pela equipe responsável.",
      });
    } catch (e) {
      if (e instanceof FleetValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
      handleFleetRouteError(res, e, "POST public reservation request", req);
    }
  });
}
