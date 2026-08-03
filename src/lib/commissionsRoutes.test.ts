import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { emptyCommissionDashboard } from "./commissions/commissionDashboard.server.js";
import {
  COMMISSION_CONFIRMED_STATUSES,
  COMMISSION_FORECAST_STATUSES,
  CommissionQueryParseError,
  parseCommissionAuditQuery,
  parseCommissionConfirmedQuery,
  parseCommissionDashboardQuery,
  parseCommissionForecastQuery,
  parseCommissionPaymentsQuery,
  parseCommissionPersonsQuery,
  parseCommissionRecordsQuery,
  parseCommissionRulesQuery,
  parseCommissionReleasesQuery,
  parseUnpaidReleasedCommissionsQuery,
  parsePagination,
} from "./commissions/commissionQuery.js";
import {
  parseCommissionPersonCreateBody,
  parseCommissionRecalculateBody,
  parseCommissionRuleCreateBody,
  parseCommissionSettingsUpdateBody,
} from "./commissions/commissionApiValidation.js";
import { validateCommissionSettingsSnapshot } from "./commissions/commissionSettings.server.js";
import { CommissionValidationError } from "./commissions/commissionApiValidation.js";
import { resolveCommissionAccessScope } from "./commissions/commissionAccessScope.js";
import type { AppAuthContext } from "./appAuth.js";
import {
  COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS,
  COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS,
  COMMISSIONS_VIEW_PERMISSIONS,
} from "./commissionsPermissions.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function authStub(partial: Partial<AppAuthContext>): AppAuthContext {
  return {
    id: "u1",
    name: "Test",
    email: "t@test.com",
    role: "VIEWER",
    permissions: [],
    effectivePermissions: [],
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: "",
    updatedAt: "",
    sessionId: "s1",
    ...partial,
  };
}

describe("commissionsRoutes", () => {
  const routes = () => read("src/lib/commissionsRoutes.ts");
  const server = () => read("server.ts");

  it("registrado no server", () => {
    assert.match(server(), /registerCommissionsRoutes/);
  });

  it("GET /api/commissions/dashboard exige auth e permissão", () => {
    const src = routes();
    assert.match(src, /requireAppAuth/);
    assert.match(src, /COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS/);
    assert.match(src, /\/api\/commissions\/dashboard/);
  });

  it("expõe endpoints principais do módulo", () => {
    const src = routes();
    const endpoints = [
      "/api/commissions/visual-audit",
      "/api/commissions/visual-audit/export",
      "/api/commissions/visual-audit/detail",
      "/api/commissions/monthly-closing",
      "/api/commissions/monthly-closing/export",
      "/api/commissions/receipt-closing/preview",
      "/api/commissions/receipt-closing/apply",
      "/api/commissions/receipt-closing/:year/:month",
      "/api/commissions/receipt-closing/:year/:month/export.csv",
      "/api/commissions/receipt-closing/:year/:month/export-detail.xlsx",
      "/api/commissions/receipt-closing/:year/:month/report",
      "/api/commissions/receipt-closing/:year/:month/report.xlsx",
      "/api/commissions/receipt-closing/cancel",
      "/api/commissions/receipt-closing/reprocess-preview",
      "/api/commissions/receipt-closing/reprocess-apply",
      "/api/commissions/reports",
      "/api/commissions/reports/export.xlsx",
      "/api/commissions/receivable-forecast",
      "/api/commissions/receivable-forecast/export",
      "/api/commissions/payable",
      "/api/commissions/generated",
      "/api/commissions/generated/detail",
      "/api/commissions/future",
      "/api/commissions/overdue",
      "/api/commissions/audit-trail/detail",
      "/api/commissions/exceptions",
      "/api/commissions/customer-exclusions",
      "/api/commissions/forecast",
      "/api/commissions/forecast/detail",
      "/api/commissions/confirmed",
      "/api/commissions/confirmed/detail",
      "/api/commissions/releases",
      "/api/commissions/releases/detail",
      "/api/commissions/persons",
      "/api/commissions/persons/import-from-orders",
      "/api/commissions/rules",
      "/api/commissions/rules/:id/usage",
      "/api/commissions/rules/:id/duplicate",
      "/api/commissions/recalculate",
      "/api/commissions/reprocess/preview",
      "/api/commissions/reprocess/apply",
      "/api/commissions/audit",
      "/api/commissions/audit/rerun",
      "/api/commissions/settings",
      "/api/commissions/payment-batches",
      "/api/commissions/payment-batches/unpaid-released",
    ];
    for (const ep of endpoints) {
      assert.match(src, new RegExp(ep.replace(/\//g, "\\/")));
    }
  });

  it("POST recalculate delega calculateCommissions", () => {
    assert.match(routes(), /calculateCommissions\(prisma/);
  });

  it("POST audit/rerun delega rerunCommissionAudit", () => {
    assert.match(routes(), /rerunCommissionAudit/);
    assert.match(routes(), /\/api\/commissions\/audit\/rerun/);
  });

  it("receipt-closing apply/reprocess exige guard de manage (close)", () => {
    const src = routes();
    assert.match(src, /\/api\/commissions\/receipt-closing\/apply/);
    assert.match(src, /\/api\/commissions\/receipt-closing\/reprocess-apply/);
    const applyIdx = src.indexOf('"/api/commissions/receipt-closing/apply"');
    const applySlice = src.slice(applyIdx, applyIdx + 200);
    assert.match(applySlice, /receiptClosingApplyGuard/);
  });

  it("receipt-closing cancel exige guard de reprocess e delega cancelReceiptClosingFromApi", () => {
    const src = routes();
    assert.match(src, /\/api\/commissions\/receipt-closing\/cancel/);
    const cancelIdx = src.indexOf('"/api/commissions/receipt-closing/cancel"');
    const cancelSlice = src.slice(cancelIdx, cancelIdx + 400);
    assert.match(cancelSlice, /reprocessGuard/);
    assert.match(cancelSlice, /cancelReceiptClosingFromApi/);
    assert.match(cancelSlice, /parseReceiptClosingCancelBody/);
  });

  it("payment-batches mark-paid usa markCommissionPaymentBatchPaid", () => {
    assert.match(routes(), /markCommissionPaymentBatchPaid/);
    assert.match(routes(), /COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS/);
  });
});

describe("commissionQuery parsers", () => {
  it("parsePagination defaults", () => {
    assert.deepEqual(parsePagination({}), { page: 1, pageSize: 20 });
    assert.deepEqual(parsePagination({ page: "2", pageSize: "200" }), {
      page: 2,
      pageSize: 100,
    });
  });

  it("parseCommissionDashboardQuery aceita year/month", () => {
    const q = parseCommissionDashboardQuery({ year: "2026", month: "6" });
    assert.equal(q.year, 2026);
    assert.equal(q.month, 6);
  });

  it("parseCommissionRecordsQuery rejeita status inválido", () => {
    assert.throws(
      () => parseCommissionRecordsQuery({ status: "INVALID" }),
      CommissionQueryParseError
    );
  });

  it("parseCommissionForecastQuery aceita filtros de vendedor e regra", () => {
    const q = parseCommissionForecastQuery({
      sellerId: "10",
      representativeId: "20",
      hasRule: "true",
      includeSuperseded: "true",
    });
    assert.equal(q.sellerId, 10);
    assert.equal(q.representativeId, 20);
    assert.equal(q.hasRule, true);
    assert.equal(q.includeSuperseded, true);
  });

  it("parseCommissionConfirmedQuery aceita documento de saída e canceladas", () => {
    const q = parseCommissionConfirmedQuery({
      outputDocument: "DS-100",
      includeCancelled: "true",
      nfeNumber: "12345",
    });
    assert.equal(q.outputDocument, "DS-100");
    assert.equal(q.includeCancelled, true);
    assert.equal(q.nfeNumber, "12345");
  });

  it("parseCommissionPersonsQuery aceita busca e período", () => {
    const q = parseCommissionPersonsQuery({
      search: "João",
      type: "SELLER",
      source: "NOMUS",
      active: "true",
      year: "2026",
      month: "6",
    });
    assert.equal(q.search, "João");
    assert.equal(q.type, "SELLER");
    assert.equal(q.source, "NOMUS");
    assert.equal(q.active, true);
    assert.equal(q.year, 2026);
    assert.equal(q.month, 6);
  });

  it("parseCommissionRulesQuery aceita busca e filtros de regra", () => {
    const q = parseCommissionRulesQuery({
      search: "Vendedor",
      active: "true",
      beneficiaryType: "SELLER",
      baseType: "SALES_ORDER_ITEM_NET",
      releaseRule: "EACH_RECEIVABLE_PAID",
    });
    assert.equal(q.search, "Vendedor");
    assert.equal(q.active, true);
    assert.equal(q.beneficiaryType, "SELLER");
    assert.equal(q.baseType, "SALES_ORDER_ITEM_NET");
    assert.equal(q.releaseRule, "EACH_RECEIVABLE_PAID");
  });

  it("parseCommissionAuditQuery aceita filtros de auditoria", () => {
    const q = parseCommissionAuditQuery({
      year: "2026",
      month: "6",
      severity: "CRITICAL",
      type: "NO_COMMISSION_RULE",
      resolved: "false",
      orderCode: "PV-100",
      nfeNumber: "12345",
      customer: "Cliente X",
      commissionPersonId: "550e8400-e29b-41d4-a716-446655440000",
    });
    assert.equal(q.year, 2026);
    assert.equal(q.month, 6);
    assert.equal(q.severity, "CRITICAL");
    assert.equal(q.type, "NO_COMMISSION_RULE");
    assert.equal(q.resolved, false);
    assert.equal(q.orderCode, "PV-100");
    assert.equal(q.nfeNumber, "12345");
    assert.equal(q.customer, "Cliente X");
    assert.equal(q.commissionPersonId, "550e8400-e29b-41d4-a716-446655440000");
  });

  it("parseCommissionPaymentsQuery aceita filtros de lote", () => {
    const q = parseCommissionPaymentsQuery({
      year: "2026",
      month: "3",
      status: "DRAFT",
      personType: "SELLER",
      paymentDateFrom: "2026-03-01",
      paymentDateTo: "2026-03-31",
    });
    assert.equal(q.year, 2026);
    assert.equal(q.month, 3);
    assert.equal(q.status, "DRAFT");
    assert.equal(q.personType, "SELLER");
    assert.ok(q.paymentDateFrom);
    assert.ok(q.paymentDateTo);
  });

  it("parseUnpaidReleasedCommissionsQuery exige commissionPersonId", () => {
    assert.throws(
      () => parseUnpaidReleasedCommissionsQuery({ year: "2026" }),
      CommissionQueryParseError
    );
  });

  it("parseCommissionReleasesQuery aceita filtros de vencimento e liberação", () => {
    const q = parseCommissionReleasesQuery({
      dueFrom: "2026-01-01",
      dueTo: "2026-01-31",
      receivableId: "999",
      releaseFilter: "partial",
      accountStatus: "ACTIVE",
    });
    assert.ok(q.dueFrom);
    assert.ok(q.dueTo);
    assert.equal(q.receivableId, 999);
    assert.equal(q.releaseFilter, "partial");
    assert.equal(q.accountStatus, "ACTIVE");
  });

  it("status sets previstas/confirmadas", () => {
    assert.deepEqual(COMMISSION_FORECAST_STATUSES, ["FORECAST_FROM_ORDER", "WAITING_NFE"]);
    assert.ok(COMMISSION_CONFIRMED_STATUSES.includes("RELEASED"));
  });
});

describe("commissionApiValidation", () => {
  it("rejeita percentual negativo em regra", () => {
    assert.throws(
      () =>
        parseCommissionRuleCreateBody({
          name: "R1",
          beneficiaryType: "SELLER",
          ratePercent: -1,
          baseType: "SALES_ORDER_ITEM_NET",
          releaseRule: "EACH_RECEIVABLE_PAID",
        }),
      CommissionValidationError
    );
  });

  it("parseCommissionRecalculateBody", () => {
    const body = parseCommissionRecalculateBody({
      from: "2026-06-01",
      to: "2026-06-30",
      mode: "FULL_RECALC",
    });
    assert.equal(body.mode, "FULL_RECALC");
  });

  it("parseCommissionPersonCreateBody", () => {
    const body = parseCommissionPersonCreateBody({
      name: "João",
      type: "SELLER",
    });
    assert.equal(body.name, "João");
    assert.equal(body.type, "SELLER");
  });

  it("parseCommissionSettingsUpdateBody aceita campos estendidos", () => {
    const body = parseCommissionSettingsUpdateBody({
      forecastEnabled: false,
      receivableAsDefinitiveReleaseSource: true,
      manualPaymentEnabled: true,
      calculateForSellers: true,
      releaseDefaultRule: "EACH_RECEIVABLE_PAID",
    });
    assert.equal(body.forecastEnabled, false);
    assert.equal(body.receivableAsDefinitiveReleaseSource, true);
    assert.equal(body.manualPaymentEnabled, true);
    assert.equal(body.calculateForSellers, true);
    assert.equal(body.releaseDefaultRule, "EACH_RECEIVABLE_PAID");
  });
});

describe("commissionSettings validation", () => {
  it("rejeita desativar todas as fontes de cálculo", () => {
    const result = validateCommissionSettingsSnapshot({
      releaseDefaultRule: "EACH_RECEIVABLE_PAID",
      forecastEnabled: false,
      outputDocumentSupersedesForecast: false,
      receivableAsDefinitiveReleaseSource: false,
      paidCommissionBlockAutoChange: true,
      manualPaymentEnabled: true,
      partialPaymentEnabled: true,
      requireApprovalBeforePaid: true,
      auditOrderWithoutSeller: true,
      auditOrderWithoutRepresentative: true,
      auditNfeWithoutOutputDocument: true,
      auditNfeWithoutReceivable: true,
      auditPaidWithoutRelease: true,
      calculateForSellers: true,
      calculateForRepresentatives: true,
      allowFixedPersonInRule: true,
    });
    assert.equal(result.ok, false);
  });

  it("settings routes expõem restore e manage guard", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/commissionsRoutes.ts"), "utf8");
    assert.match(src, /\/api\/commissions\/settings\/restore/);
    assert.match(src, /COMMISSIONS_SETTINGS_MANAGE_PERMISSIONS/);
  });
});

describe("commissionAccessScope", () => {
  it("ADMIN tem escopo global", () => {
    const scope = resolveCommissionAccessScope(authStub({ role: "ADMIN" }));
    assert.equal(scope.dataScope, "global");
    assert.equal(scope.sellerLocked, false);
  });

  it("SELLER vinculado tem escopo own", () => {
    const scope = resolveCommissionAccessScope(
      authStub({
        role: "SELLER",
        permissions: ["commissions.seller.own"],
        effectivePermissions: ["commissions.seller.own"],
        externalSellerId: 42,
      })
    );
    assert.equal(scope.dataScope, "own");
    assert.equal(scope.nomusSellerId, 42);
    assert.equal(scope.sellerLocked, true);
  });

  it("SELLER sem vínculo bloqueado", () => {
    const scope = resolveCommissionAccessScope(
      authStub({
        role: "SELLER",
        permissions: ["commissions.seller.own"],
        effectivePermissions: ["commissions.seller.own"],
      })
    );
    assert.equal(scope.dataScope, "none");
    assert.equal(scope.blockedReason, "SELLER_NOT_LINKED");
  });

  it("só commissions.view não abre escopo global", () => {
    const scope = resolveCommissionAccessScope(
      authStub({
        role: "VIEWER",
        permissions: ["commissions.view", "commissions.dashboard.view"],
        effectivePermissions: ["commissions.view", "commissions.dashboard.view"],
      })
    );
    assert.equal(scope.dataScope, "none");
    assert.equal(scope.blockedReason, "FORBIDDEN");
  });

  it("perfil vendedor (VIEWER + seller.own) com vínculo Nomus → own", () => {
    const scope = resolveCommissionAccessScope(
      authStub({
        role: "VIEWER",
        permissions: ["commissions.view", "commissions.seller.own"],
        effectivePermissions: ["commissions.view", "commissions.seller.own"],
        externalSellerId: 2737,
        sellerResponsibleName: "GISLENE LIMA",
      })
    );
    assert.equal(scope.dataScope, "own");
    assert.equal(scope.nomusSellerId, 2737);
    assert.equal(scope.sellerLocked, true);
  });

  it("commissions.seller.all → global", () => {
    const scope = resolveCommissionAccessScope(
      authStub({
        role: "VIEWER",
        permissions: ["commissions.view", "commissions.seller.all"],
        effectivePermissions: ["commissions.view", "commissions.seller.all"],
      })
    );
    assert.equal(scope.dataScope, "global");
    assert.equal(scope.sellerLocked, false);
  });
});

describe("commissionDashboard", () => {
  it("emptyCommissionDashboard retorna cards zerados", () => {
    const payload = emptyCommissionDashboard();
    assert.equal(payload.cards.forecastAmount, 0);
    assert.equal(payload.cards.criticalDivergencesCount, 0);
    assert.equal(payload.ytd, null);
    assert.ok(Array.isArray(payload.monthlySeries));
  });
});

describe("commissionsPermissions catalog keys", () => {
  it("permite view amplo via COMMISSIONS_VIEW_PERMISSIONS", () => {
    assert.ok(COMMISSIONS_VIEW_PERMISSIONS.includes("commissions.view"));
    assert.ok(COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS.includes("commissions.dashboard.view"));
  });
});
