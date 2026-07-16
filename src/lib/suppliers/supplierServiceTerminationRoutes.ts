import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";
import {
  cancelSupplierServiceTermination,
  createNewVersionFromCanceledTermination,
  createSupplierServiceTermination,
  exportSupplierServiceTerminationPdf,
  exportSupplierServiceTerminationXlsx,
  finalizeSupplierServiceTermination,
  getSupplierServiceTermination,
  listSupplierServiceTerminations,
  previewSupplierServiceTermination,
  searchCommissionReportsForSupplierTermination,
  SupplierServiceTerminationError,
  transitionSupplierServiceTerminationStatus,
  updateSupplierServiceTermination,
} from "./supplierServiceTermination.server.js";
import type {
  ServiceTerminationPreviewInput,
  ServiceTerminationStatusDto,
} from "./supplierServiceTerminationTypes.js";
import {
  SERVICE_TERMINATION_AUDIT_ACTIONS,
} from "./supplierServiceTerminationTypes.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

const SERVICE_TERMINATION_RESOURCE = "finance.suppliers.service_termination";

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

function optString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
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
    averageWorkedDaysPerMonth:
      b.averageWorkedDaysPerMonth != null ? Number(b.averageWorkedDaysPerMonth) : 30,
    hoursPerDay: b.hoursPerDay != null ? Number(b.hoursPerDay) : 8,
    monthlyHours: b.monthlyHours != null ? Number(b.monthlyHours) : null,
    restDaysPerYear: b.restDaysPerYear != null ? Number(b.restDaysPerYear) : 20,
    calculationMode:
      b.calculationMode === "WORKED_DAYS" ? "WORKED_DAYS" : "WORKED_MONTHS",
    workedMonths: b.workedMonths != null ? Number(b.workedMonths) : null,
    workedDays: b.workedDays != null ? Number(b.workedDays) : null,
    extraWorkedDays: b.extraWorkedDays != null ? Number(b.extraWorkedDays) : 0,
    noticePenaltyAmount:
      b.noticePenaltyAmount != null ? Number(b.noticePenaltyAmount) : 0,
    commissionReportTotal:
      b.commissionReportTotal != null ? Number(b.commissionReportTotal) : null,
    otherCredits: b.otherCredits != null ? Number(b.otherCredits) : 0,
    otherDiscounts: b.otherDiscounts != null ? Number(b.otherDiscounts) : 0,
    notes: b.notes != null ? String(b.notes) : null,
    adjustmentNotes: b.adjustmentNotes != null ? String(b.adjustmentNotes) : null,
    commissionLinks: Array.isArray(b.commissionLinks)
      ? (b.commissionLinks as ServiceTerminationPreviewInput["commissionLinks"])
      : [],
    documentCode: optString(b.documentCode),
    documentVersion: b.documentVersion != null ? Number(b.documentVersion) : 1,
    supersedesId: optString(b.supersedesId),
    originalContractDate: optString(b.originalContractDate),
    originalContractReference: optString(b.originalContractReference),
    contractingPartyName: optString(b.contractingPartyName),
    contractingPartyDocument: optString(b.contractingPartyDocument),
    contractingPartyRepName: optString(b.contractingPartyRepName),
    contractingPartyRepRole: optString(b.contractingPartyRepRole),
    contractingPartyRepDocument: optString(b.contractingPartyRepDocument),
    contractedPartyName: optString(b.contractedPartyName),
    contractedPartyDocument: optString(b.contractedPartyDocument),
    contractedPartyRepName: optString(b.contractedPartyRepName),
    contractedPartyRepDocument: optString(b.contractedPartyRepDocument),
    contractedServiceDescription: optString(b.contractedServiceDescription),
    signaturePlace: optString(b.signaturePlace),
    terminationModality:
      b.terminationModality === "MUTUAL_AGREEMENT" ||
      b.terminationModality === "CONTRACTOR_INITIATIVE" ||
      b.terminationModality === "CONTRACTED_INITIATIVE"
        ? b.terminationModality
        : null,
    terminationReason: optString(b.terminationReason),
    paymentDueDate: optString(b.paymentDueDate),
    paymentMethod: optString(b.paymentMethod),
    paymentTransactionId: optString(b.paymentTransactionId),
    paymentEffectiveDate: optString(b.paymentEffectiveDate),
    paymentConfirmedAmount:
      b.paymentConfirmedAmount != null ? Number(b.paymentConfirmedAmount) : null,
    paymentProofStorageKey: optString(b.paymentProofStorageKey),
    paymentProofFileName: optString(b.paymentProofFileName),
    paymentProofWaiverReason: optString(b.paymentProofWaiverReason),
    commissionTreatment:
      b.commissionTreatment === "NONE_PENDING" ||
      b.commissionTreatment === "HAS_PENDING" ||
      b.commissionTreatment === "NEGOTIATED_INCLUDED"
        ? b.commissionTreatment
        : null,
    commissionPendingNotes: optString(b.commissionPendingNotes),
    commissionNegotiatedAmount:
      b.commissionNegotiatedAmount != null ? Number(b.commissionNegotiatedAmount) : null,
    commissionNegotiatedOrders: optString(b.commissionNegotiatedOrders),
    commissionNegotiatedJustification: optString(b.commissionNegotiatedJustification),
    commissionNegotiatedApprover: optString(b.commissionNegotiatedApprover),
    noticePenaltyOrigin:
      b.noticePenaltyOrigin === "CONTRACT_CLAUSE" ||
      b.noticePenaltyOrigin === "AGREEMENT" ||
      b.noticePenaltyOrigin === "OTHER"
        ? b.noticePenaltyOrigin
        : null,
    noticePenaltyClauseNumber: optString(b.noticePenaltyClauseNumber),
    noticePenaltyClauseDescription: optString(b.noticePenaltyClauseDescription),
    proportionalCompensationJustification: optString(
      b.proportionalCompensationJustification
    ),
    extraServicesDescription: optString(b.extraServicesDescription),
    otherDiscountsDescription: optString(b.otherDiscountsDescription),
    contractualNotes: optString(b.contractualNotes),
    pendingObligationsNotes: optString(b.pendingObligationsNotes),
    hasPendingObligations: Boolean(b.hasPendingObligations),
    witness1Name: optString(b.witness1Name),
    witness1Document: optString(b.witness1Document),
    witness2Name: optString(b.witness2Name),
    witness2Document: optString(b.witness2Document),
    contractTypeConfirmedPj: Boolean(b.contractTypeConfirmedPj),
  };
}

export function registerSupplierServiceTerminationRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;

  const viewGuard = [
    requireAppAuth,
    requireResource(SERVICE_TERMINATION_RESOURCE, "view"),
  ] as const;
  const createGuard = [
    requireAppAuth,
    requireResource(SERVICE_TERMINATION_RESOURCE, "create"),
  ] as const;
  const updateGuard = [
    requireAppAuth,
    requireResource(SERVICE_TERMINATION_RESOURCE, "update"),
  ] as const;
  const finalizeGuard = [
    requireAppAuth,
    requireResource(SERVICE_TERMINATION_RESOURCE, "execute"),
  ] as const;
  const exportGuard = [
    requireAppAuth,
    requireResource(SERVICE_TERMINATION_RESOURCE, "export"),
  ] as const;
  const cancelGuard = [
    requireAppAuth,
    requireResource(SERVICE_TERMINATION_RESOURCE, "manage"),
  ] as const;

  app.get(
    "/api/suppliers/service-terminations/commission-reports/search",
    ...viewGuard,
    async (req, res) => {
      try {
        const yearRaw =
          typeof req.query.year === "string"
            ? Number(req.query.year)
            : new Date().getFullYear();
        const result = await searchCommissionReportsForSupplierTermination({
          year: yearRaw,
          months: typeof req.query.months === "string" ? req.query.months : "all",
          sellerId: typeof req.query.sellerId === "string" ? req.query.sellerId : "all",
          search:
            typeof req.query.search === "string"
              ? req.query.search
              : typeof req.query.q === "string"
                ? req.query.q
                : null,
          searchName:
            typeof req.query.searchName === "string" ? req.query.searchName : null,
          page: typeof req.query.page === "string" ? Number(req.query.page) : 1,
          pageSize:
            typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : 100,
        });
        res.json({ ok: true, ...result });
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
    "/api/suppliers/:supplierId/service-terminations/:id/status",
    ...finalizeGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId) || !isUuid(req.params.id)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }
        const target = String((req.body as { status?: string })?.status ?? "");
        const allowed: ServiceTerminationStatusDto[] = [
          "DRAFT",
          "AWAITING_SIGNATURE",
          "SIGNED_AWAITING_PAYMENT",
          "PAID_AND_SETTLED",
          "CANCELED",
        ];
        if (!allowed.includes(target as ServiceTerminationStatusDto)) {
          return res.status(400).json({ error: "Status alvo inválido." });
        }
        const user = await getCurrentAppUser(req);
        const item = await transitionSupplierServiceTerminationStatus({
          supplierId: req.params.supplierId,
          id: req.params.id,
          targetStatus: target as ServiceTerminationStatusDto,
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
    "/api/suppliers/:supplierId/service-terminations/:id/new-version",
    ...createGuard,
    async (req, res) => {
      try {
        if (!isUuid(req.params.supplierId) || !isUuid(req.params.id)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }
        const user = await getCurrentAppUser(req);
        const item = await createNewVersionFromCanceledTermination({
          supplierId: req.params.supplierId,
          id: req.params.id,
          userId: user?.id,
          userName: user?.name,
        });
        res.status(201).json({ ok: true, item });
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
