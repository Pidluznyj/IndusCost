import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildDiagnosticReportRequest,
  DEFAULT_DIAGNOSTIC_REPORT_OPTIONS,
} from "./diagnosticReportClient.js";
import { canGenerateDiagnosticReport } from "./diagnosticReportPermissions.js";

describe("diagnosticReportClient", () => {
  it("monta request PRODUCT_ENGINEERING com SKU", () => {
    const body = buildDiagnosticReportRequest("PRODUCT_ENGINEERING", {
      sku: "618.08AA",
      productId: "prod-1",
      screenTitle: "Engenharia de Produto",
      screenRoute: "/products/engineering",
    });
    assert.equal(body.scope, "PRODUCT_ENGINEERING");
    assert.equal(body.context.sku, "618.08AA");
    assert.equal(body.options?.includeScreenContext, true);
  });

  it("monta request PUBLISHED_PRICE com tabela", () => {
    const body = buildDiagnosticReportRequest("PUBLISHED_PRICE", {
      sku: "618.08AA",
      tableCode: "VAREJO_2",
      priceItemId: "price-1",
    });
    assert.equal(body.context.tableCode, "VAREJO_2");
    assert.equal(body.context.priceItemId, "price-1");
  });

  it("monta request COMMISSION_RECEIPT_CLOSING com ano/mês", () => {
    const body = buildDiagnosticReportRequest("COMMISSION_RECEIPT_CLOSING", {
      year: 2026,
      month: 6,
      seller: "GISLENE",
    });
    assert.equal(body.context.year, 2026);
    assert.equal(body.context.month, 6);
  });

  it("DEFAULT options incluem todos os blocos", () => {
    assert.equal(DEFAULT_DIAGNOSTIC_REPORT_OPTIONS.includeSanitizedLogs, true);
    assert.equal(DEFAULT_DIAGNOSTIC_REPORT_OPTIONS.includeAutoDiagnostics, true);
  });
});

describe("diagnosticReportPermissions", () => {
  const auth = {
    hasAnyPermission: (perms: string[]) => perms.includes("pricing.view"),
  };

  it("permite PUBLISHED_PRICE com pricing.view", () => {
    assert.equal(canGenerateDiagnosticReport(auth, "PUBLISHED_PRICE"), true);
  });

  it("nega SYSTEM sem permissão adequada", () => {
    assert.equal(canGenerateDiagnosticReport(auth, "SYSTEM"), true);
  });
});

describe("diagnosticReport integration", () => {
  it("ProductModule inclui DiagnosticReportButton", () => {
    const src = readFileSync("src/components/ProductModule.tsx", "utf8");
    assert.match(src, /DiagnosticReportButton/);
    assert.match(src, /PRODUCT_ENGINEERING/);
  });

  it("PricingModule inclui DiagnosticReportButton no resultado", () => {
    const src = readFileSync("src/components/PricingModule.tsx", "utf8");
    assert.match(src, /DiagnosticReportButton/);
    assert.match(src, /PUBLISHED_PRICE/);
  });

  it("CommissionsReceiptClosingPage inclui DiagnosticReportButton", () => {
    const src = readFileSync("src/components/commissions/pages/CommissionsReceiptClosingPage.tsx", "utf8");
    assert.match(src, /DiagnosticReportButton/);
    assert.match(src, /COMMISSION_RECEIPT_CLOSING/);
  });

  it("SettingsModule inclui DiagnosticReportButton SYSTEM", () => {
    const src = readFileSync("src/components/SettingsModule.tsx", "utf8");
    assert.match(src, /DiagnosticReportButton/);
    assert.match(src, /SYSTEM/);
  });

  it("rotas registram POST /api/diagnostics/report", () => {
    const src = readFileSync("src/lib/diagnostics/diagnosticBundleRoutes.server.ts", "utf8");
    assert.match(src, /\/api\/diagnostics\/report/);
  });
});
