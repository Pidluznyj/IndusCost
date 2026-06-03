import type express from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import {
  FLEET_IMPORT_CONFIRM_TOKEN,
  applyDriverCsvImport,
  applyVehicleCsvImport,
  previewDriverCsvImport,
  previewVehicleCsvImport,
} from "@/src/lib/fleetCsvImport.js";

type AuthGuards = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (p: string) => express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function fleetError(res: express.Response, e: unknown, label: string) {
  if (e instanceof FleetValidationError) return res.status(400).json({ error: e.message });
  console.error(label, e);
  return res.status(500).json({ error: e instanceof Error ? e.message : "Erro interno." });
}

function readCsvBody(body: Record<string, unknown>): string {
  const csv = typeof body.csv === "string" ? body.csv.trim() : "";
  if (!csv) throw new FleetValidationError("Campo csv é obrigatório (UTF-8).");
  return csv;
}

function readAllowUpdate(body: Record<string, unknown>): boolean {
  return body.allowUpdate === true || body.allowUpdate === "true";
}

function assertApplyConfirm(body: Record<string, unknown>) {
  const confirm = typeof body.confirm === "string" ? body.confirm.trim() : "";
  if (confirm !== FLEET_IMPORT_CONFIRM_TOKEN) {
    throw new FleetValidationError(
      `Confirmação obrigatória: informe confirm="${FLEET_IMPORT_CONFIRM_TOKEN}".`
    );
  }
}

export function registerFleetImportRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requirePermission, getCurrentAppUser } = auth;
  const fleetManage = [requireAppAuth, requirePermission("fleet.manage")] as express.RequestHandler[];

  app.post("/api/fleet/import/vehicles/preview", ...fleetManage, async (req, res) => {
    try {
      const csv = readCsvBody(req.body ?? {});
      const result = await previewVehicleCsvImport(csv, {
        allowUpdate: readAllowUpdate(req.body ?? {}),
      });
      if ("error" in result) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST import vehicles preview");
    }
  });

  app.post("/api/fleet/import/vehicles/apply", ...fleetManage, async (req, res) => {
    try {
      const body = req.body ?? {};
      assertApplyConfirm(body);
      const csv = readCsvBody(body);
      const user = await getCurrentAppUser(req);
      const result = await applyVehicleCsvImport(csv, {
        allowUpdate: readAllowUpdate(body),
        userId: user?.id ?? null,
      });
      if ("error" in result) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST import vehicles apply");
    }
  });

  app.post("/api/fleet/import/drivers/preview", ...fleetManage, async (req, res) => {
    try {
      const csv = readCsvBody(req.body ?? {});
      const result = await previewDriverCsvImport(csv, {
        allowUpdate: readAllowUpdate(req.body ?? {}),
      });
      if ("error" in result) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST import drivers preview");
    }
  });

  app.post("/api/fleet/import/drivers/apply", ...fleetManage, async (req, res) => {
    try {
      const body = req.body ?? {};
      assertApplyConfirm(body);
      const csv = readCsvBody(body);
      const user = await getCurrentAppUser(req);
      const result = await applyDriverCsvImport(csv, {
        allowUpdate: readAllowUpdate(body),
        userId: user?.id ?? null,
      });
      if ("error" in result) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      fleetError(res, e, "POST import drivers apply");
    }
  });
}
