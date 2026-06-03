import type express from "express";
import {
  getEffectivePermissions,
  type AppAuthContext,
} from "@/src/lib/appAuth.js";
import {
  canFleet,
  FLEET_FORBIDDEN_MESSAGE,
  FLEET_ROUTE_GUARDS,
  type FleetRouteGuardKey,
} from "@/src/lib/fleetPermissionResolve.js";

/** Guards reutilizáveis para todas as rotas /api/fleet/*. */
export type FleetAuthGuards = {
  requireAppAuth: express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export type FleetRouteGuardSet = {
  view: express.RequestHandler[];
  vehiclesEdit: express.RequestHandler[];
  manage: express.RequestHandler[];
  driversManage: express.RequestHandler[];
  reservationsCreate: express.RequestHandler[];
  reservationsApprove: express.RequestHandler[];
  reservationsManage: express.RequestHandler[];
  maintenanceManage: express.RequestHandler[];
  financialWrite: express.RequestHandler[];
  settingsManage: express.RequestHandler[];
  checklistOps: express.RequestHandler[];
  attachmentWrite: express.RequestHandler[];
  importManage: express.RequestHandler[];
};

function fleetPermissionDenied(res: express.Response): void {
  res.status(403).json({ error: FLEET_FORBIDDEN_MESSAGE });
}

function createRequireFleetAny(
  getCurrentAppUser: FleetAuthGuards["getCurrentAppUser"],
  guard: FleetRouteGuardKey
): express.RequestHandler {
  const required = FLEET_ROUTE_GUARDS[guard];
  return async (req, res, next) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        fleetPermissionDenied(res);
        return;
      }
      const perms = user.effectivePermissions ?? getEffectivePermissions(user);
      if (!canFleet(perms, required)) {
        fleetPermissionDenied(res);
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function createFleetRouteGuards(auth: FleetAuthGuards): FleetRouteGuardSet {
  const { requireAppAuth, getCurrentAppUser } = auth;

  const chain = (guard: FleetRouteGuardKey): express.RequestHandler[] => [
    requireAppAuth,
    createRequireFleetAny(getCurrentAppUser, guard),
  ];

  return {
    view: chain("view"),
    vehiclesEdit: chain("vehiclesEdit"),
    manage: chain("manage"),
    driversManage: chain("driversManage"),
    reservationsCreate: chain("reservationsCreate"),
    reservationsApprove: chain("reservationsApprove"),
    reservationsManage: chain("reservationsManage"),
    maintenanceManage: chain("maintenanceManage"),
    financialWrite: chain("financialWrite"),
    settingsManage: chain("settingsManage"),
    checklistOps: chain("checklistOps"),
    attachmentWrite: chain("attachmentWrite"),
    importManage: chain("importManage"),
  };
}
