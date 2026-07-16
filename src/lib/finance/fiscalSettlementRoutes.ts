/**
 * Rotas HTTP — apuração / guias / alocação fiscal (T05).
 *
 * GET  /api/finance/fiscal-settlements/apurations
 * POST /api/finance/fiscal-settlements/apurations
 * POST /api/finance/fiscal-settlements/apurations/:id/close
 * GET  /api/finance/fiscal-settlements/guides
 * POST /api/finance/fiscal-settlements/guides
 * POST /api/finance/fiscal-settlements/guides/:id/pay
 * POST /api/finance/fiscal-settlements/guides/:id/cancel
 * POST /api/finance/fiscal-settlements/guides/:id/reverse
 * POST /api/finance/fiscal-settlements/guides/:id/proofs
 * POST /api/finance/fiscal-settlements/allocations
 * GET  /api/finance/fiscal-settlements/allocations?salesOrderId=
 * GET  /api/finance/fiscal-settlements/reports
 * GET  /api/finance/fiscal-settlements/reports/export.xlsx
 * GET  /api/finance/fiscal-settlements/reports/drill
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  FISCAL_ALLOCATION_MANAGE_PERMISSIONS,
  FISCAL_SETTLEMENT_MANAGE_PERMISSIONS,
  FISCAL_SETTLEMENT_VIEW_PERMISSIONS,
} from "./fiscalSettlementPermissions.js";
import {
  addFiscalPaymentProof,
  cancelFiscalPaymentGuide,
  closeFiscalApurationPeriod,
  createFiscalAllocation,
  createFiscalApurationPeriod,
  createFiscalPaymentGuide,
  listFiscalAllocationsForOrder,
  listFiscalApurationPeriods,
  listFiscalPaymentGuides,
  registerFiscalGuidePayment,
  reverseFiscalGuidePayment,
} from "./fiscalSettlementService.server.js";
import {
  FISCAL_TAX_INTEL_DRILL_LEVELS,
  type FiscalTaxIntelDrillLevel,
} from "./fiscalTaxIntelligenceClient.js";
import {
  buildFiscalTaxIntelligenceExportBuffer,
  buildFiscalTaxIntelligenceExportFilename,
} from "./fiscalTaxIntelligenceExport.js";
import {
  buildFiscalTaxIntelligenceDrilldown,
  buildFiscalTaxIntelligenceReport,
  parseFiscalTaxIntelFilters,
} from "./fiscalTaxIntelligenceService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

function actorFromReq(req: express.Request): {
  userId?: string | null;
  userName?: string | null;
} {
  const auth = (req as { appAuth?: { userId?: string; name?: string; email?: string } })
    .appAuth;
  return {
    userId: auth?.userId ?? null,
    userName: auth?.name ?? auth?.email ?? null,
  };
}

function sendErr(res: express.Response, error: unknown): void {
  const status =
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : 500;
  const message =
    error instanceof Error ? error.message : "Erro interno fiscal settlements.";
  res.status(status).json({ error: message, message });
}

export function registerFiscalSettlementRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const viewGuard = [
    auth.requireAppAuth,
    auth.requireAnyPermission([...FISCAL_SETTLEMENT_VIEW_PERMISSIONS]),
  ];
  const manageGuard = [
    auth.requireAppAuth,
    auth.requireAnyPermission([...FISCAL_SETTLEMENT_MANAGE_PERMISSIONS]),
  ];
  const allocGuard = [
    auth.requireAppAuth,
    auth.requireAnyPermission([...FISCAL_ALLOCATION_MANAGE_PERMISSIONS]),
  ];

  app.get(
    "/api/finance/fiscal-settlements/apurations",
    ...viewGuard,
    async (req, res) => {
      try {
        const status =
          typeof req.query.status === "string" ? req.query.status : null;
        const rows = await listFiscalApurationPeriods(prisma, { status });
        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, apurations: rows });
      } catch (error) {
        console.error("GET fiscal apurations", error);
        sendErr(res, error);
      }
    }
  );

  app.post(
    "/api/finance/fiscal-settlements/apurations",
    ...manageGuard,
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const row = await createFiscalApurationPeriod(
          prisma,
          {
            companyName: body.companyName ?? null,
            jurisdiction: body.jurisdiction,
            uf: body.uf ?? null,
            periodStart: String(body.periodStart ?? ""),
            periodEnd: String(body.periodEnd ?? ""),
            notes: body.notes ?? null,
            source: body.source ?? "MANUAL",
            lines: Array.isArray(body.lines) ? body.lines : [],
          },
          actorFromReq(req)
        );
        res.status(201).json({ ok: true, apuration: row });
      } catch (error) {
        console.error("POST fiscal apuration", error);
        sendErr(res, error);
      }
    }
  );

  app.post(
    "/api/finance/fiscal-settlements/apurations/:id/close",
    ...manageGuard,
    async (req, res) => {
      try {
        const row = await closeFiscalApurationPeriod(
          prisma,
          req.params.id,
          actorFromReq(req)
        );
        res.json({ ok: true, apuration: row });
      } catch (error) {
        console.error("POST close apuration", error);
        sendErr(res, error);
      }
    }
  );

  app.get(
    "/api/finance/fiscal-settlements/guides",
    ...viewGuard,
    async (req, res) => {
      try {
        const status =
          typeof req.query.status === "string" ? req.query.status : null;
        const rows = await listFiscalPaymentGuides(prisma, { status });
        res.setHeader("Cache-Control", "no-store");
        res.json({
          ok: true,
          guides: rows,
          paymentSourceOfTruth:
            "NomusAccountsPayable quando accountsPayableExternalId está vinculado; senão amountPaid + comprovante manual.",
        });
      } catch (error) {
        console.error("GET fiscal guides", error);
        sendErr(res, error);
      }
    }
  );

  app.post(
    "/api/finance/fiscal-settlements/guides",
    ...manageGuard,
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const row = await createFiscalPaymentGuide(
          prisma,
          {
            periodId: body.periodId ?? null,
            taxType: String(body.taxType ?? ""),
            jurisdiction: body.jurisdiction,
            revenueCode: body.revenueCode ?? null,
            guideType: body.guideType,
            guideNumber: body.guideNumber ?? null,
            barcode: body.barcode ?? null,
            periodStart: String(body.periodStart ?? ""),
            periodEnd: String(body.periodEnd ?? ""),
            dueDate: body.dueDate ?? null,
            assessedAmount: Number(body.assessedAmount ?? 0),
            creditsAmount: Number(body.creditsAmount ?? 0),
            compensationsAmount: Number(body.compensationsAmount ?? 0),
            interestAmount: Number(body.interestAmount ?? 0),
            fineAmount: Number(body.fineAmount ?? 0),
            amountPaid: Number(body.amountPaid ?? 0),
            paidAt: body.paidAt ?? null,
            paymentAccount: body.paymentAccount ?? null,
            accountsPayableExternalId:
              body.accountsPayableExternalId != null
                ? Number(body.accountsPayableExternalId)
                : null,
            costCenterId: body.costCenterId ?? null,
            notes: body.notes ?? null,
            source: body.source ?? "MANUAL",
            status: body.status ?? "ISSUED",
          },
          actorFromReq(req)
        );
        res.status(201).json({ ok: true, guide: row });
      } catch (error) {
        console.error("POST fiscal guide", error);
        sendErr(res, error);
      }
    }
  );

  app.post(
    "/api/finance/fiscal-settlements/guides/:id/pay",
    ...manageGuard,
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const row = await registerFiscalGuidePayment(
          prisma,
          req.params.id,
          {
            amountPaid: Number(body.amountPaid ?? 0),
            paidAt: body.paidAt ?? null,
            paymentAccount: body.paymentAccount ?? null,
            syncFromAp: Boolean(body.syncFromAp),
          },
          actorFromReq(req)
        );
        res.json({ ok: true, guide: row });
      } catch (error) {
        console.error("POST fiscal guide pay", error);
        sendErr(res, error);
      }
    }
  );

  app.post(
    "/api/finance/fiscal-settlements/guides/:id/cancel",
    ...manageGuard,
    async (req, res) => {
      try {
        const row = await cancelFiscalPaymentGuide(
          prisma,
          req.params.id,
          actorFromReq(req)
        );
        res.json({ ok: true, guide: row });
      } catch (error) {
        console.error("POST fiscal guide cancel", error);
        sendErr(res, error);
      }
    }
  );

  app.post(
    "/api/finance/fiscal-settlements/guides/:id/reverse",
    ...manageGuard,
    async (req, res) => {
      try {
        const row = await reverseFiscalGuidePayment(
          prisma,
          req.params.id,
          actorFromReq(req)
        );
        res.json({ ok: true, guide: row });
      } catch (error) {
        console.error("POST fiscal guide reverse", error);
        sendErr(res, error);
      }
    }
  );

  app.post(
    "/api/finance/fiscal-settlements/guides/:id/proofs",
    ...manageGuard,
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const proof = await addFiscalPaymentProof(
          prisma,
          req.params.id,
          {
            fileName: String(body.fileName ?? ""),
            originalFileName: String(
              body.originalFileName ?? body.fileName ?? ""
            ),
            mimeType: String(body.mimeType ?? "application/octet-stream"),
            fileSize: Number(body.fileSize ?? 0),
            storageKey: String(body.storageKey ?? ""),
            notes: body.notes ?? null,
          },
          actorFromReq(req)
        );
        res.status(201).json({ ok: true, proof });
      } catch (error) {
        console.error("POST fiscal proof", error);
        sendErr(res, error);
      }
    }
  );

  app.get(
    "/api/finance/fiscal-settlements/allocations",
    ...viewGuard,
    async (req, res) => {
      try {
        const salesOrderId =
          typeof req.query.salesOrderId === "string"
            ? req.query.salesOrderId.trim()
            : "";
        if (!salesOrderId) {
          res.status(400).json({
            error: "salesOrderId é obrigatório.",
            message: "salesOrderId é obrigatório.",
          });
          return;
        }
        const rows = await listFiscalAllocationsForOrder(prisma, salesOrderId);
        res.setHeader("Cache-Control", "no-store");
        res.json({
          ok: true,
          allocations: rows,
          disclaimer:
            "Alocação gerencial do recolhimento — não é pagamento oficial da NF.",
        });
      } catch (error) {
        console.error("GET fiscal allocations", error);
        sendErr(res, error);
      }
    }
  );

  app.post(
    "/api/finance/fiscal-settlements/allocations",
    ...allocGuard,
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const row = await createFiscalAllocation(
          prisma,
          {
            guideId: String(body.guideId ?? body.settlementId ?? ""),
            salesOrderId: body.salesOrderId ?? null,
            nomusNfeId: body.nomusNfeId ?? body.nfeId ?? null,
            taxType: String(body.taxType ?? ""),
            allocatedAmount: Number(body.allocatedAmount ?? 0),
            allocationMethod: body.allocationMethod ?? "MANUAL",
            allocationBase:
              body.allocationBase != null ? Number(body.allocationBase) : null,
            periodStart: body.periodStart ?? null,
            periodEnd: body.periodEnd ?? null,
            manualOverride: Boolean(body.manualOverride),
            notes: body.notes ?? null,
          },
          actorFromReq(req)
        );
        res.status(201).json({
          ok: true,
          allocation: row,
          disclaimer:
            "Alocação gerencial do recolhimento — não é pagamento oficial da NF.",
        });
      } catch (error) {
        console.error("POST fiscal allocation", error);
        sendErr(res, error);
      }
    }
  );

  app.get(
    "/api/finance/fiscal-settlements/reports",
    ...viewGuard,
    async (req, res) => {
      try {
        const filters = parseFiscalTaxIntelFilters(
          req.query as Record<string, unknown>
        );
        const payload = await buildFiscalTaxIntelligenceReport(prisma, filters);
        res.setHeader("Cache-Control", "no-store");
        res.json(payload);
      } catch (error) {
        console.error("GET fiscal tax intelligence report", error);
        sendErr(res, error);
      }
    }
  );

  app.get(
    "/api/finance/fiscal-settlements/reports/export.xlsx",
    ...viewGuard,
    async (req, res) => {
      try {
        const filters = parseFiscalTaxIntelFilters(
          req.query as Record<string, unknown>
        );
        const payload = await buildFiscalTaxIntelligenceReport(prisma, filters);
        const buffer = buildFiscalTaxIntelligenceExportBuffer(payload);
        const filename = buildFiscalTaxIntelligenceExportFilename(payload);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.send(buffer);
      } catch (error) {
        console.error("GET fiscal tax intelligence export", error);
        sendErr(res, error);
      }
    }
  );

  app.get(
    "/api/finance/fiscal-settlements/reports/drill",
    ...viewGuard,
    async (req, res) => {
      try {
        const levelRaw = String(req.query.level ?? "period");
        const level = (
          FISCAL_TAX_INTEL_DRILL_LEVELS as readonly string[]
        ).includes(levelRaw)
          ? (levelRaw as FiscalTaxIntelDrillLevel)
          : "period";
        const periodStart =
          typeof req.query.periodStart === "string"
            ? req.query.periodStart
            : new Date().toISOString().slice(0, 10);
        const periodEnd =
          typeof req.query.periodEnd === "string"
            ? req.query.periodEnd
            : periodStart;
        const drill = await buildFiscalTaxIntelligenceDrilldown(prisma, {
          level,
          periodStart,
          periodEnd,
          taxType:
            typeof req.query.taxType === "string" ? req.query.taxType : null,
          guideId:
            typeof req.query.guideId === "string" ? req.query.guideId : null,
          nfeExternalId:
            req.query.nfeExternalId != null &&
            String(req.query.nfeExternalId).trim() !== ""
              ? Number(req.query.nfeExternalId)
              : null,
        });
        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, drill });
      } catch (error) {
        console.error("GET fiscal tax intelligence drill", error);
        sendErr(res, error);
      }
    }
  );
}
