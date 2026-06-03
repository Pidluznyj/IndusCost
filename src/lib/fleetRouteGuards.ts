import type express from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";

/** Guards reutilizáveis para todas as rotas /api/fleet/*. */
export type FleetAuthGuards = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (p: string) => express.RequestHandler;
  requireAnyPermission: (ps: string[]) => express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export type FleetRouteGuardSet = {
  /** Leitura geral: exige fleet.view + autenticação. */
  view: express.RequestHandler[];
  vehiclesEdit: express.RequestHandler[];
  manage: express.RequestHandler[];
  driversManage: express.RequestHandler[];
  reservationsCreate: express.RequestHandler[];
  reservationsApprove: express.RequestHandler[];
  maintenanceManage: express.RequestHandler[];
  /** Escrita financeira (custos, multas, abastecimentos, etc.). */
  financialWrite: express.RequestHandler[];
  settingsManage: express.RequestHandler[];
  checklistOps: express.RequestHandler[];
  attachmentWrite: express.RequestHandler[];
  importManage: express.RequestHandler[];
};

export function createFleetRouteGuards(auth: FleetAuthGuards): FleetRouteGuardSet {
  const { requireAppAuth, requirePermission, requireAnyPermission } = auth;

  const withAuth = (handlers: express.RequestHandler[]) =>
    handlers as express.RequestHandler[];

  return {
    view: withAuth([requireAppAuth, requirePermission("fleet.view")]),
    vehiclesEdit: withAuth([
      requireAppAuth,
      requireAnyPermission(["fleet.vehicles.edit", "fleet.manage"]),
    ]),
    manage: withAuth([requireAppAuth, requirePermission("fleet.manage")]),
    driversManage: withAuth([requireAppAuth, requirePermission("fleet.manage")]),
    reservationsCreate: withAuth([
      requireAppAuth,
      requireAnyPermission(["fleet.reservations.create", "fleet.manage"]),
    ]),
    reservationsApprove: withAuth([
      requireAppAuth,
      requireAnyPermission(["fleet.reservations.approve", "fleet.manage"]),
    ]),
    maintenanceManage: withAuth([
      requireAppAuth,
      requireAnyPermission(["fleet.maintenance.manage", "fleet.manage"]),
    ]),
    financialWrite: withAuth([
      requireAppAuth,
      requireAnyPermission(["fleet.financial.view", "fleet.manage"]),
    ]),
    settingsManage: withAuth([requireAppAuth, requirePermission("fleet.settings.manage")]),
    checklistOps: withAuth([
      requireAppAuth,
      requireAnyPermission(["fleet.reservations.create", "fleet.manage"]),
    ]),
    attachmentWrite: withAuth([
      requireAppAuth,
      requireAnyPermission([
        "fleet.manage",
        "fleet.financial.view",
        "fleet.reservations.create",
        "fleet.maintenance.manage",
      ]),
    ]),
    importManage: withAuth([requireAppAuth, requirePermission("fleet.manage")]),
  };
}
