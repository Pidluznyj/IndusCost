import type express from "express";
import { handleFleetRouteError } from "@/src/lib/fleetErrors.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import {
  createPublicReservationRequest,
  getPublicReservationAvailability,
  getPublicReservationConfig,
  identifyPublicDriverByCpf,
  listPublicReservationVehicles,
  registerPublicDriver,
  resolvePublicReservationLinkBySlug,
  tryPublicReservationShortLinkRedirect,
  type FleetPublicTokenFailure,
} from "@/src/lib/fleetPublicReservationService.js";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_POST = 15;
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

export function registerFleetPublicReservationShortLinkMiddleware(app: express.Express) {
  app.use(async (req, res, next) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/@") || req.path.startsWith("/src")) {
        return next();
      }
      if (/\.[a-zA-Z0-9]{1,8}$/.test(req.path)) return next();

      const target = await tryPublicReservationShortLinkRedirect(req.path);
      if (!target) return next();

      if (req.method === "HEAD") {
        res.status(302).location(target).end();
        return;
      }
      res.redirect(302, target);
    } catch (e) {
      next(e);
    }
  });
}

export function registerFleetPublicReservationRoutes(app: express.Express) {
  const handleReservationLinkSlug = async (
    req: express.Request,
    res: express.Response
  ): Promise<void> => {
    try {
      const slug = req.params.sub
        ? `${String(req.params.slug ?? "")}/${String(req.params.sub ?? "")}`
        : String(req.params.slug ?? "");
      const origin = `${req.protocol}://${req.get("host") ?? ""}`;
      const result = await resolvePublicReservationLinkBySlug(slug, origin);
      if (result.ok === false) {
        if (result.reason === "disabled") {
          res.status(403).json({ error: "Solicitação pública desativada." });
          return;
        }
        if (result.reason === "invalid_slug") {
          res.status(400).json({ error: "Slug inválido." });
          return;
        }
        res.status(404).json({ error: "Link não encontrado." });
        return;
      }
      res.json({
        enabled: true,
        targetUrl: result.targetPath,
        targetAbsoluteUrl: result.targetUrl,
      });
    } catch (e) {
      handleFleetRouteError(res, e, "GET public reservation-link slug", req);
    }
  };

  app.get("/api/public/fleet/reservation-link/:slug/:sub", handleReservationLinkSlug);
  app.get("/api/public/fleet/reservation-link/:slug", handleReservationLinkSlug);

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

  app.post("/api/public/fleet/reservation/:token/identify", async (req, res) => {
    try {
      if (!checkPostRateLimit(req)) {
        res.status(429).json({ error: "Muitas tentativas. Aguarde um momento." });
        return;
      }
      const token = String(req.params.token ?? "");
      const tokenResult = await getPublicReservationConfig(token);
      if (tokenResult.ok === false) {
        publicTokenStatus(tokenResult, res);
        return;
      }
      const result = await identifyPublicDriverByCpf(req.body?.cpf);
      res.json(result);
    } catch (e) {
      if (e instanceof FleetValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
      handleFleetRouteError(res, e, "POST public identify", req);
    }
  });

  app.post("/api/public/fleet/reservation/:token/register", async (req, res) => {
    try {
      if (!checkPostRateLimit(req)) {
        res.status(429).json({ error: "Muitas tentativas. Aguarde um momento." });
        return;
      }
      const token = String(req.params.token ?? "");
      const tokenResult = await getPublicReservationConfig(token);
      if (tokenResult.ok === false) {
        publicTokenStatus(tokenResult, res);
        return;
      }
      const body = req.body ?? {};
      const result = await registerPublicDriver({
        cpf: body.cpf,
        driverId: body.driverId,
        name: body.name,
        phone: body.phone,
        email: body.email,
        department: body.department,
        cnhNumber: body.cnhNumber,
        cnhCategory: body.cnhCategory,
        cnhExpirationDate: body.cnhExpirationDate,
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (e) {
      if (e instanceof FleetValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
      handleFleetRouteError(res, e, "POST public register", req);
    }
  });

  app.get("/api/public/fleet/reservation/:token/vehicles", async (req, res) => {
    try {
      const result = await listPublicReservationVehicles(String(req.params.token ?? ""));
      if (result.ok === false) {
        publicTokenStatus(result, res);
        return;
      }
      res.json({ vehicles: result.vehicles });
    } catch (e) {
      handleFleetRouteError(res, e, "GET public vehicles", req);
    }
  });

  app.get("/api/public/fleet/reservation/:token/availability", async (req, res) => {
    try {
      const vehicleId = String(req.query.vehicleId ?? "").trim();
      const from = String(req.query.from ?? req.query.date ?? "").trim();
      const days = parseInt(String(req.query.days ?? "7"), 10);
      const result = await getPublicReservationAvailability(
        String(req.params.token ?? ""),
        vehicleId,
        from,
        Number.isFinite(days) ? days : 7
      );
      if (result.ok === false) {
        publicTokenStatus(result, res);
        return;
      }
      res.json({
        vehicleId: result.vehicleId,
        from: result.from,
        days: result.days,
        dates: result.dates,
      });
    } catch (e) {
      if (e instanceof FleetValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
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
        cpf: body.cpf,
        driverId: body.driverId,
        requesterName: body.requesterName,
        requesterEmail: body.requesterEmail,
        requesterPhone: body.requesterPhone,
        requesterDepartment: body.requesterDepartment,
        responsibilityAccepted: body.responsibilityAccepted,
        requestedDate: body.requestedDate,
        startTime: body.startTime,
        endTime: body.endTime,
        reason: body.reason,
        destination: body.destination,
        notes: body.notes,
        passengersCount: body.passengersCount,
        vehicleId: body.vehicleId,
      });

      if (result.ok === false) {
        publicTokenStatus(result, res);
        return;
      }

      res.status(201).json({
        publicCode: result.request.publicCode,
        status: result.request.status,
        requiresDriverApproval: result.requiresDriverApproval,
        message: result.successMessage,
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
