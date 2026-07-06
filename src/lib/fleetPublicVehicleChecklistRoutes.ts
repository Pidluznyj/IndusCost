import type express from "express";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import { handleFleetRouteError } from "@/src/lib/fleetErrors.js";
import {
  getPublicVehicleChecklistConfig,
  identifyPublicVehicleChecklistDriver,
  submitPublicVehicleChecklist,
} from "@/src/lib/fleetPublicVehicleChecklistService.js";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_POST = 20;
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

function publicTokenError(reason: string, res: express.Response): void {
  if (reason === "revoked") {
    res.status(403).json({ error: "QR Code revogado. Solicite um novo código à frota." });
    return;
  }
  if (reason === "vehicle_unavailable") {
    res.status(403).json({ error: "Veículo indisponível para checklist no momento." });
    return;
  }
  res.status(404).json({ error: "QR Code inválido ou veículo não encontrado." });
}

export function registerFleetPublicVehicleChecklistRoutes(app: express.Express) {
  app.get("/api/public/fleet/vehicle-checklist/:token", async (req, res) => {
    try {
      const result = await getPublicVehicleChecklistConfig(String(req.params.token ?? ""));
      if (result.ok === false) {
        publicTokenError(result.reason, res);
        return;
      }
      res.json({
        vehicle: result.vehicle,
        template: result.template,
        itemStatuses: result.itemStatuses,
        responsibilityText: result.responsibilityText,
        fuelLevelHint: result.fuelLevelHint,
      });
    } catch (e) {
      handleFleetRouteError(res, e, "GET public vehicle-checklist config", req);
    }
  });

  app.post("/api/public/fleet/vehicle-checklist/:token/identify", async (req, res) => {
    try {
      if (!checkPostRateLimit(req)) {
        res.status(429).json({ error: "Muitas tentativas. Aguarde um momento." });
        return;
      }
      const token = String(req.params.token ?? "");
      const config = await getPublicVehicleChecklistConfig(token);
      if (config.ok === false) {
        publicTokenError(config.reason, res);
        return;
      }
      const result = await identifyPublicVehicleChecklistDriver(token, req.body?.cpf);
      if (result.ok === false) {
        publicTokenError(result.reason, res);
        return;
      }
      res.json(result);
    } catch (e) {
      if (e instanceof FleetValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
      handleFleetRouteError(res, e, "POST public vehicle-checklist identify", req);
    }
  });

  app.post("/api/public/fleet/vehicle-checklist/:token/submit", async (req, res) => {
    try {
      if (!checkPostRateLimit(req)) {
        res.status(429).json({ error: "Muitas tentativas. Aguarde um momento." });
        return;
      }
      const token = String(req.params.token ?? "");
      const result = await submitPublicVehicleChecklist(token, req.body ?? {});
      if (result.ok === false) {
        publicTokenError(result.reason, res);
        return;
      }
      res.status(201).json(result);
    } catch (e) {
      if (e instanceof FleetValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
      handleFleetRouteError(res, e, "POST public vehicle-checklist submit", req);
    }
  });
}
