import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";
import {
  cancelSupplierServiceTermination,
  createSupplierServiceTermination,
  exportSupplierServiceTerminationPdf,
  exportSupplierServiceTerminationXlsx,
  finalizeSupplierServiceTermination,
  getSupplierServiceTermination,
  listSupplierServiceTerminations,
  previewSupplierServiceTermination,
  searchCommissionReportsForSupplierTermination,
  SupplierServiceTerminationError,
  updateSupplierServiceTermination,
} from "./supplierServiceTermination.server.js";
import type { ServiceTerminationPreviewInput } from "./supplierServiceTerminationTypes.js";
import {
  SERVICE_TERMINATION_AUDIT_ACTIONS,
} from "./supplierServiceTerminationTypes.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const SERVICE_TERMINATION_VIEW_PERMISSIONS = [
  "finance.suppliers.service_termination.view",
  "suppliers.serviceTermination.view",
  "finance.suppliers.view",
  "finance.suppliers.manage",
] as const;

export const SERVICE_TERMINATION_CREATE_PERMISSIONS = [
  "finance.suppliers.service_termination.create",
  "suppliers.serviceTermination.create",
  "finance.suppliers.manage",
] as const;

export const SERVICE_TERMINATION_UPDATE_PERMISSIONS = [
  "finance.suppliers.service_termination.update",
  "suppliers.serviceTermination.update",
  "finance.suppliers.manage",
] as const;

export const SERVICE_TERMINATION_FINALIZE_PERMISSIONS = [
  "finance.suppliers.service_termination.finalize",
  "suppliers.serviceTermination.finalize",
  "finance.suppliers.manage",
] as const;

export const SERVICE_TERMINATION_EXPORT_PERMISSIONS = [
  "finance.suppliers.service_termination.export",
  "suppliers.serviceTermination.export",
  "finance.suppliers.manage",
  "finance.suppliers.service_termination.view",
] as const;

export const SERVICE_TERMINATION_CANCEL_PERMISSIONS = [
  "finance.suppliers.service_termination.cancel",
  "suppliers.serviceTermination.cancel",
  "finance.suppliers.manage",
] as const;

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function handleError(res: express.Response, error: unknown) {
  if (error instanceof SupplierServiceTerminationError) {
    return res.status(error.httpStatus).json({ error: error.message, code: error.code });
  }
  console.error("supplier service termination", error);
  return res
    .status(500)
    .json(financeApiErrorJson("Erro no encerramento de prestação de serviço.", error));
}

function parseBody(raw: unknown): ServiceTerminationPreviewInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  return {
    personName: String(b.personName ?? ""),
    personDocument: b.personDocument != null ? String(b.personDocument) : null,
    serviceRole: b.serviceRole != null ? String(b.serviceRole) : null,
    contractStartDate: String(b.contractStartDate ?? ""),
    contractEndDate: String(b.contractEndDate ?? ""),
    monthlyServiceAmount: Number(b.monthlyServiceAmount),
    monthlyHours: Number(b.monthlyHours),
    restDaysPerYear: b.restDaysPerYear != null ? Number(b.restDaysPerYear) : 20,
    calculationMode:
      b.calculationMode === "WORKED_DAYS" ? "WORKED_DAYS" : "WORKED_MONTHS",
    workedMonths: b.workedMonths != null ? Number(b.workedMonths) : null,
    workedDays: b.workedDays != null ? Number(b.workedDays) : null,
    commissionReportTotal:
      b.commissionReportTotal != null ? Number(b.commissionReportTotal) : null,
    otherCredits: b.otherCredits != null ? Number(b.otherCredits) : 0,
    otherDiscounts: b.otherDiscounts != null ? Number(b.otherDiscounts) : 0,
    notes: b.notes != null ? String(b.notes) : null,
    adjustmentNotes: b.adjustmentNotes != null ? String(b.adjustmentNotes) : null,
    commissionLinks: Array.isArray(b.commissionLinks)
      ? (b.commissionLinks as ServiceTerminationPreviewInput["commissionLinks"])
      : [],
  };
}

export function registerSupplierServiceTerminationRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;

  const viewGuard = [
    requireAppAuth,
    requireAnyPermission([...SERVICE_TERMINATION_VIEW_PERMISSIONS]),
  ] as const;
  const createGuard = [
    requireAppAuth,
    requireAnyPermission([...SERVICE_TERMINATION_CREATE_PERMISSIONS]),
  ] as const;
  const updateGuard = [
    requireAppAuth,
    requireAnyPermission([...SERVICE_TERMINATION_UPDATE_PERMISSIONS]),
  ] as const;
  const finalizeGuard = [
    requireAppAuth,
    requireAnyPermission([...SERVICE_TERMINATION_FINALIZE_PERMISSIONS]),
  ] as const;
  const exportGuard = [
    requireAppAuth,
    requireAnyPermission([...SERVICE_TERMINATION_EXPORT_PERMISSIONS]),
  ] as const;
  const cancelGuard = [
    requireAppAuth,
    requireAnyPermission([...SERVICE_TERMINATION_CANCEL_PERMISSIONS]),
  ] as const;

  app.get(
    "/api/suppliers/service-terminations/commission-reports/search",
    ...viewGuard,
    async (req, res) => {
      try {
        const searchName =
          typeof req.query.searchName === "string"
            ? req.query.searchName
            : typeof req.query.q === "string"
              ? req.query.q
              : "";
        const hits = await searchCommissionReportsForSupplierTermination({
          searchName,
          supplierId:
            typeof req.query.supplierId === "string" ? req.query.supplierId : null,
          periodFrom:
            typeof req.query.periodFrom === "string" ? req.query.periodFrom : null,
          periodTo: typeof req.query.periodTo === "string" ? req.query.periodTo : null,
        });
        res.json({ ok: true, items: hits });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.get(
    "/api/suppliers/:supplierId/service-terminations",
    ...viewGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId)) {
          return res.status(400).json({ error: "supplierId inválido." });
        }
        const items = await listSupplierServiceTerminations(req.params.supplierId);
        res.json({ ok: true, items });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.get(
    "/api/suppliers/:supplierId/service-terminations/:id",
    ...viewGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId) || !isUuid(req.params.id)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }
        const item = await getSupplierServiceTermination(
          req.params.supplierId,
          req.params.id
        );
        res.json({ ok: true, item });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.post(
    "/api/suppliers/:supplierId/service-terminations/preview",
    ...createGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId)) {
          return res.status(400).json({ error: "supplierId inválido." });
        }
        const body = parseBody(req.body);
        const preview = previewSupplierServiceTermination(body);
        const user = await getCurrentAppUser(req);
        await prisma.financialCostCenterAuditLog.create({
          data: {
            entityType: "SupplierServiceTermination",
            entityId: req.params.supplierId,
            action: SERVICE_TERMINATION_AUDIT_ACTIONS.PREVIEW,
            afterJson: {
              personName: body.personName,
              total: preview.calc.totalTerminationAmount,
            },
            userId: user?.id ?? null,
            userName: user?.name ?? null,
          },
        });
        res.json({
          ok: true,
          calc: preview.calc,
          proportionalRestDaysLabel: preview.proportionalRestDaysLabel,
        });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.post(
    "/api/suppliers/:supplierId/service-terminations",
    ...createGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId)) {
          return res.status(400).json({ error: "supplierId inválido." });
        }
        const user = await getCurrentAppUser(req);
        const item = await createSupplierServiceTermination({
          supplierId: req.params.supplierId,
          body: parseBody(req.body),
          userId: user?.id,
          userName: user?.name,
        });
        res.status(201).json({ ok: true, item });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.put(
    "/api/suppliers/:supplierId/service-terminations/:id",
    ...updateGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId) || !isUuid(req.params.id)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }
        const user = await getCurrentAppUser(req);
        const item = await updateSupplierServiceTermination({
          supplierId: req.params.supplierId,
          id: req.params.id,
          body: parseBody(req.body),
          userId: user?.id,
          userName: user?.name,
        });
        res.json({ ok: true, item });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.post(
    "/api/suppliers/:supplierId/service-terminations/:id/finalize",
    ...finalizeGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId) || !isUuid(req.params.id)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }
        const user = await getCurrentAppUser(req);
        const item = await finalizeSupplierServiceTermination({
          supplierId: req.params.supplierId,
          id: req.params.id,
          userId: user?.id,
          userName: user?.name,
        });
        res.json({ ok: true, item });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.post(
    "/api/suppliers/:supplierId/service-terminations/:id/cancel",
    ...cancelGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId) || !isUuid(req.params.id)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }
        const user = await getCurrentAppUser(req);
        const item = await cancelSupplierServiceTermination({
          supplierId: req.params.supplierId,
          id: req.params.id,
          userId: user?.id,
          userName: user?.name,
        });
        res.json({ ok: true, item });
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.get(
    "/api/suppliers/:supplierId/service-terminations/:id/pdf",
    ...exportGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId) || !isUuid(req.params.id)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }
        const user = await getCurrentAppUser(req);
        const { buffer, filename } = await exportSupplierServiceTerminationPdf({
          supplierId: req.params.supplierId,
          id: req.params.id,
          userId: user?.id,
          userName: user?.name,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(buffer);
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.get(
    "/api/suppliers/:supplierId/service-terminations/:id/xlsx",
    ...exportGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId) || !isUuid(req.params.id)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }
        const user = await getCurrentAppUser(req);
        const { buffer, filename } = await exportSupplierServiceTerminationXlsx({
          supplierId: req.params.supplierId,
          id: req.params.id,
          userId: user?.id,
          userName: user?.name,
        });
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(buffer);
      } catch (error) {
        handleError(res, error);
      }
    }
  );
}
