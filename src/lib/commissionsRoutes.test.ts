import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { emptyCommissionDashboard } from "./commissions/commissionDashboard.server.js";
import {
  COMMISSION_CONFIRMED_STATUSES,
  COMMISSION_FORECAST_STATUSES,
  CommissionQueryParseError,
  parseCommissionConfirmedQuery,
  parseCommissionDashboardQuery,
  parseCommissionForecastQuery,
  parseCommissionPersonsQuery,
  parseCommissionRecordsQuery,
  parseCommissionRulesQuery,
  parseCommissionReleasesQuery,
  parsePagination,
} from "./commissions/commissionQuery.js";
import {
  parseCommissionPersonCreateBody,
  parseCommissionRecalculateBody,
  parseCommissionRuleCreateBody,
} from "./commissions/commissionApiValidation.js";
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
    isActive: true,
    externalSellerId: null,
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
      "/api/commissions/records",
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
      "/api/commissions/audit",
      "/api/commissions/settings",
      "/api/commissions/payment-batches",
    ];
    for (const ep of endpoints) {
      assert.match(src, new RegExp(ep.replace(/\//g, "\\/")));
    }
  });

  it("POST recalculate delega calculateCommissions", () => {
    assert.match(routes(), /calculateCommissions\(prisma/);
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
});

describe("commissionDashboard", () => {
  it("emptyCommissionDashboard retorna cards zerados", () => {
    const payload = emptyCommissionDashboard();
    assert.equal(payload.cards.forecastAmount, 0);
    assert.equal(payload.cards.criticalDivergencesCount, 0);
    assert.ok(Array.isArray(payload.monthlySeries));
  });
});

describe("commissionsPermissions catalog keys", () => {
  it("permite view amplo via COMMISSIONS_VIEW_PERMISSIONS", () => {
    assert.ok(COMMISSIONS_VIEW_PERMISSIONS.includes("commissions.view"));
    assert.ok(COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS.includes("commissions.dashboard.view"));
  });
});
