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
import { FLEET_FORBIDDEN_CODE } from "@/src/lib/fleetErrors.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";

/** Guards reutilizáveis para todas as rotas /api/fleet/*. */
export type FleetAuthGuards = {
  requireAppAuth: express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
  /** P16: gate canônico operations.fleet antes das permissões granulares. */
  requireResource?: (resourceKey: string, action?: string) => express.RequestHandler;
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
  res.status(403).json({
    error: FLEET_FORBIDDEN_MESSAGE,
    code: FLEET_FORBIDDEN_CODE,
    retryable: false,
  });
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

const VIEW_GUARDS: ReadonlySet<FleetRouteGuardKey> = new Set(["view"]);

export function createFleetRouteGuards(auth: FleetAuthGuards): FleetRouteGuardSet {
  const { requireAppAuth, getCurrentAppUser, requireResource } = auth;

  const chain = (guard: FleetRouteGuardKey): express.RequestHandler[] => {
    const resourceAction = VIEW_GUARDS.has(guard)
      ? OPERATIONS_ACTIONS.view
      : OPERATIONS_ACTIONS.manage;
    const handlers: express.RequestHandler[] = [requireAppAuth];
    if (typeof requireResource === "function") {
      handlers.push(
        requireResource(OPERATIONS_RESOURCE_KEYS.fleet, resourceAction)
      );
    }
    handlers.push(createRequireFleetAny(getCurrentAppUser, guard));
    return handlers;
  };

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
