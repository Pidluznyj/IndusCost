/**
 * TRIB-08 — Release candidate: fixtures PD 02781 + validações cruzadas.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesOrderTributosTab } from "@/src/components/sales/SalesOrderTributosTab";
import {
  attachSalesOrderFiscalTaxesContract,
} from "./salesOrderFiscalTaxesContract.js";
import {
  canViewSalesOrderFiscalTaxesFromAuth,
  canViewSalesOrderFiscalTaxesFromPermissions,
} from "./salesOrderFiscalTaxesPermissions.js";
import { emptySalesOrderFiscalSettlementsBlock } from "./salesOrderFiscalTaxesClient.js";
import { resolveSalesOrderRelatedNfes } from "./salesOrderRelatedNfeResolver.js";
import {
  buildSalesOrderTaxesAuditReport,
  scanSalesOrderTaxesAuditSource,
} from "./salesOrderTaxesAudit.js";
import {
  PD_02781_FIXTURE_ORDER,
  PD_02781_SCENARIO_IDS,
  PD_02781_SCENARIOS,
} from "./salesOrderTributosPd02781Fixtures.js";
import {
  SALES_ORDER_TRIBUTOS_VIEWPORTS,
  resolveSalesOrderTributosTabViewState,
  salesOrderTributosViewportClass,
} from "./salesOrderTributosTabUi.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const READ_ONLY_SCAN_FILES = [
  "scripts/auditSalesOrderTaxes.ts",
  "src/lib/sales-orders/salesOrderTaxesAudit.server.ts",
  "src/lib/sales-orders/salesOrderRelatedNfeResolver.server.ts",
  "src/lib/sales-orders/salesOrderFiscalTaxes.server.ts",
] as const;

describe("TRIB-08 — fixtures PD 02781 (7 cenários)", () => {
  for (const id of PD_02781_SCENARIO_IDS) {
    const scenario = PD_02781_SCENARIOS[id];

    it(`${scenario.id}: ${scenario.label}`, () => {
      const resolved = resolveSalesOrderRelatedNfes(scenario.resolveInput);
      assert.equal(resolved.salesOrderId, PD_02781_FIXTURE_ORDER.id);
      assert.equal(resolved.nfes.length, scenario.expected.uniqueNfes);
      assert.equal(
        resolved.nfeExternalIdsForTaxTotals.length,
        scenario.expected.validNfes
      );

      if (scenario.expected.primaryOrigin) {
        assert.equal(
          resolved.nfes[0]?.primaryOrigin,
          scenario.expected.primaryOrigin
        );
      }

      const report = buildSalesOrderTaxesAuditReport(scenario.auditInput);
      assert.equal(report.mode, "READ_ONLY");
      assert.equal(report.counts.uniqueNfes, scenario.expected.uniqueNfes);
      assert.equal(report.counts.validNfes, scenario.expected.validNfes);
      assert.equal(report.counts.cancelledNfes, scenario.expected.cancelledNfes);
      assert.equal(report.status, scenario.expected.status);
      assert.equal(report.guarantees.databaseWrites, false);
      assert.equal(report.guarantees.nomusCalls, false);

      if (scenario.expected.hasIpi) {
        assert.ok(
          report.consolidatedTaxes.some((tax) => tax.taxType === "IPI"),
          "espera IPI documental consolidado"
        );
        const ipi = report.consolidatedTaxes.find((tax) => tax.taxType === "IPI");
        assert.equal(ipi?.amount, 5);
      } else if (scenario.expected.status === "available") {
        // available sem IPI não se aplica aos fixtures atuais
      } else {
        assert.ok(
          !report.consolidatedTaxes.some((tax) => tax.taxType === "IPI" && tax.amount === 80),
          "IPI de NF cancelada não entra no consolidado"
        );
      }

      if (scenario.id === "cancelledNf") {
        assert.equal(resolved.nfes[0]?.includeInTaxTotals, false);
        assert.equal(resolved.nfes[0]?.isCanceled, true);
        assert.match(report.exactUnavailableReason ?? "", /cancelad/i);
      }

      if (scenario.id === "orderWithoutNf") {
        assert.match(report.exactUnavailableReason ?? "", /Nenhuma NF-e/i);
      }

      if (scenario.id === "partialNf") {
        assert.equal(report.nfes[0]?.fiscalSource, "MISSING");
        assert.ok((report.nfes[0]?.fieldsMissing.length ?? 0) > 0);
      }

      const viewState = resolveSalesOrderTributosTabViewState({
        fiscalTaxesAccess: "allowed",
        fiscalTaxes: {
          status: report.status,
          statusReason: report.exactUnavailableReason,
          warnings: [],
          linkOrigins: [],
          summary: {
            orderActiveValue: PD_02781_FIXTURE_ORDER.activeOrderValue,
            productsValue: 0,
            discountsValue: 0,
            freightValue: 0,
            insuranceValue: 0,
            otherExpensesValue: 0,
            nfeValidTotal: 0,
            amountToInvoice: PD_02781_FIXTURE_ORDER.activeOrderValue,
            financialBalance: null,
            financialBalanceLabel: "Sem CR gerado",
            validNfeCount: report.counts.validNfes,
            cancelledNfeCount: report.counts.cancelledNfes,
            compositionIncomplete: report.status === "partial",
            compositionIncompleteReason: null,
            sourceLabel: "XML NF-e",
            lastParsedAt: null,
            parserVersion: "trib-08",
          },
          highlightedTaxes: report.consolidatedTaxes.map((tax) => ({
            taxType: tax.taxType,
            label: tax.taxType,
            amount: tax.amount,
          })),
          nfes: [],
          cancelledNfes: [],
          itemTaxLines: [],
          settlements: emptySalesOrderFiscalSettlementsBlock(
            "2026-07-16T00:00:00.000Z"
          ),
          technical: {
            source: "trib-08-fixture",
            note: "Release candidate",
            doNotSumHeaderAndItem: true,
          },
        },
      });
      assert.equal(
        viewState,
        report.status === "unavailable"
          ? "unavailable"
          : report.status === "partial"
            ? "partial"
            : "available"
      );
    });
  }

  it("deduplica a mesma NF vista por vínculo + DS + O2C", () => {
    const resolved = resolveSalesOrderRelatedNfes({
      salesOrderId: PD_02781_FIXTURE_ORDER.id,
      links: [
        {
          nfeExternalId: 27810,
          nfeNumber: "2781",
          linkId: "link-multi",
        },
      ],
      o2cFacts: [
        {
          nfeExternalId: 27810,
          nfeNumber: "2781",
          stockDocumentExternalId: 7001,
          stockDocumentIdNfe: 27810,
        },
      ],
      stockDocuments: [
        { stockDocumentExternalId: 7001, idNfe: 27810 },
      ],
      nfeStatusHints: [{ nfeExternalId: 27810, status: 100 }],
    });
    assert.equal(resolved.nfes.length, 1);
    assert.ok(resolved.nfes[0]!.origins.includes("SALES_ORDER_NFE_LINK"));
    assert.ok(resolved.nfes[0]!.origins.includes("STOCK_DOCUMENT"));
    assert.ok(resolved.nfes[0]!.origins.includes("ORDER_TO_CASH"));
    assert.equal(resolved.nfes[0]!.primaryOrigin, "SALES_ORDER_NFE_LINK");
    assert.ok(resolved.nfes[0]!.sources.length >= 3);
  });
});

describe("TRIB-08 — contrato: zero ≠ ausente; billing=false não força partial", () => {
  it("NF ativa inelegível a totais com source MISSING não altera available", () => {
    const attached = attachSalesOrderFiscalTaxesContract({
      summary: {
        orderActiveValue: 115,
        productsValue: 100,
        discountsValue: 0,
        freightValue: 10,
        insuranceValue: 0,
        otherExpensesValue: 0,
        nfeValidTotal: 115,
        amountToInvoice: 0,
        financialBalance: null,
        financialBalanceLabel: "Sem CR gerado",
        validNfeCount: 1,
        cancelledNfeCount: 0,
        compositionIncomplete: false,
        compositionIncompleteReason: null,
        sourceLabel: "XML NF-e",
        lastParsedAt: "2026-07-16T00:00:00.000Z",
        parserVersion: "trib-08",
      },
      highlightedTaxes: [{ taxType: "IPI", label: "IPI", amount: 5 }],
      nfes: [
        {
          nomusNfeId: "valid",
          nfeExternalId: 27810,
          numero: "2781",
          serie: "1",
          chave: null,
          emissionDate: null,
          status: 100,
          statusLabel: "Autorizada",
          isCancelled: false,
          isValidForTotals: true,
          finalidade: 1,
          productsValue: 100,
          discountsValue: 0,
          freightValue: 10,
          insuranceValue: 0,
          otherExpensesValue: 0,
          taxesTotalHeader: 5,
          highlightedTaxesFallback: null,
          totalValue: 115,
          compositionIncomplete: false,
          source: "FISCAL_SUMMARY",
          parsedAt: null,
          parserVersion: null,
          headerTaxes: [{ taxType: "IPI", label: "IPI", amount: 5 }],
          itemTaxLines: [],
        },
        {
          nomusNfeId: "billing-false",
          nfeExternalId: 27899,
          numero: "27899",
          serie: "1",
          chave: null,
          emissionDate: null,
          status: 100,
          statusLabel: "Autorizada",
          isCancelled: false,
          isValidForTotals: false,
          finalidade: 1,
          productsValue: null,
          discountsValue: null,
          freightValue: null,
          insuranceValue: null,
          otherExpensesValue: null,
          taxesTotalHeader: null,
          highlightedTaxesFallback: null,
          totalValue: null,
          compositionIncomplete: true,
          source: "MISSING",
          parsedAt: null,
          parserVersion: null,
          headerTaxes: [],
          itemTaxLines: [],
        },
      ],
      cancelledNfes: [],
      itemTaxLines: [],
      settlements: emptySalesOrderFiscalSettlementsBlock(
        "2026-07-16T00:00:00.000Z"
      ),
      technical: {
        source: "test",
        note: "trib-08",
        doNotSumHeaderAndItem: true,
      },
    });
    assert.equal(attached.status, "available");
    assert.equal(attached.highlightedTaxes[0]!.amount, 5);
  });

  it("amount 0 documental permanece 0 (não vira null/ausente)", () => {
    const attached = attachSalesOrderFiscalTaxesContract({
      summary: {
        orderActiveValue: 100,
        productsValue: 100,
        discountsValue: 0,
        freightValue: 0,
        insuranceValue: 0,
        otherExpensesValue: 0,
        nfeValidTotal: 100,
        amountToInvoice: 0,
        financialBalance: null,
        financialBalanceLabel: "Sem CR gerado",
        validNfeCount: 1,
        cancelledNfeCount: 0,
        compositionIncomplete: false,
        compositionIncompleteReason: null,
        sourceLabel: "XML NF-e",
        lastParsedAt: null,
        parserVersion: "trib-08",
      },
      highlightedTaxes: [
        { taxType: "ICMS", label: "ICMS", amount: 0 },
        { taxType: "IPI", label: "IPI", amount: null },
      ],
      nfes: [
        {
          nomusNfeId: "z",
          nfeExternalId: 1,
          numero: "1",
          serie: "1",
          chave: null,
          emissionDate: null,
          status: 100,
          statusLabel: "Autorizada",
          isCancelled: false,
          isValidForTotals: true,
          finalidade: 1,
          productsValue: 100,
          discountsValue: 0,
          freightValue: 0,
          insuranceValue: 0,
          otherExpensesValue: 0,
          taxesTotalHeader: 0,
          highlightedTaxesFallback: null,
          totalValue: 100,
          compositionIncomplete: false,
          source: "FISCAL_SUMMARY",
          parsedAt: null,
          parserVersion: null,
          headerTaxes: [
            { taxType: "ICMS", label: "ICMS", amount: 0 },
            { taxType: "IPI", label: "IPI", amount: null },
          ],
          itemTaxLines: [],
        },
      ],
      cancelledNfes: [],
      itemTaxLines: [],
      settlements: emptySalesOrderFiscalSettlementsBlock(
        "2026-07-16T00:00:00.000Z"
      ),
      technical: {
        source: "test",
        note: "trib-08",
        doNotSumHeaderAndItem: true,
      },
    });
    assert.equal(attached.status, "available");
    assert.equal(attached.highlightedTaxes.find((t) => t.taxType === "ICMS")!.amount, 0);
    assert.equal(attached.highlightedTaxes.find((t) => t.taxType === "IPI")!.amount, null);
    assert.equal(attached.nfes[0]!.freightValue, 0);
  });
});

describe("TRIB-08 — permissão da aba", () => {
  it("SUPER_ADMIN e detail.view liberam; bag sem detail/invoice bloqueia", () => {
    assert.equal(
      canViewSalesOrderFiscalTaxesFromAuth({
        role: "SUPER_ADMIN",
        permissions: [],
        effectivePermissions: [],
      }),
      true
    );
    assert.equal(
      canViewSalesOrderFiscalTaxesFromPermissions([
        "sales_orders.detail.view",
      ]),
      true
    );
    assert.equal(
      canViewSalesOrderFiscalTaxesFromPermissions(["sales_orders.view"]),
      false
    );
  });
});

describe("TRIB-08 — viewports 1366×768 e 1920×1080", () => {
  it("preserva classes e dimensões sem alterar o modal", () => {
    assert.deepEqual(
      SALES_ORDER_TRIBUTOS_VIEWPORTS.map((v) => ({
        id: v.id,
        width: v.width,
        height: v.height,
      })),
      [
        { id: "1366", width: 1366, height: 768 },
        { id: "1920", width: 1920, height: 1080 },
      ]
    );

    for (const viewport of SALES_ORDER_TRIBUTOS_VIEWPORTS) {
      const html = renderToStaticMarkup(
        <div
          data-testid={`sales-order-tributos-viewport-${viewport.id}`}
          className={salesOrderTributosViewportClass(viewport.id)}
          style={{ width: viewport.width, maxHeight: viewport.height }}
        >
          <SalesOrderTributosTab
            fiscalTaxes={{
              status: "unavailable",
              statusReason: "sem NF",
              warnings: [],
              linkOrigins: [],
              summary: {
                orderActiveValue: 115,
                productsValue: 0,
                discountsValue: 0,
                freightValue: 0,
                insuranceValue: 0,
                otherExpensesValue: 0,
                nfeValidTotal: 0,
                amountToInvoice: 115,
                financialBalance: null,
                financialBalanceLabel: "Sem CR gerado",
                validNfeCount: 0,
                cancelledNfeCount: 0,
                compositionIncomplete: false,
                compositionIncompleteReason: null,
                sourceLabel: "XML NF-e",
                lastParsedAt: null,
                parserVersion: "trib-08",
              },
              highlightedTaxes: [],
              nfes: [],
              cancelledNfes: [],
              itemTaxLines: [],
              settlements: emptySalesOrderFiscalSettlementsBlock(
                "2026-07-16T00:00:00.000Z"
              ),
              technical: {
                source: "trib-08",
                note: "viewport",
                doNotSumHeaderAndItem: true,
              },
            }}
            fiscalTaxesAccess="allowed"
          />
        </div>
      );
      assert.match(html, new RegExp(`viewport-${viewport.id}`));
      assert.match(html, /sales-order-tributos-no-nfe/);
      assert.match(html, /data-view-state="unavailable"/);
      assert.doesNotMatch(html, /max-w-\[(?:90|95)vw\]/);
    }
  });
});

describe("TRIB-08 — read-only e ausência de Nomus HTTP", () => {
  it("loaders de tributos/resolver/auditoria sem escrita Prisma nem cliente Nomus", () => {
    for (const relative of READ_ONLY_SCAN_FILES) {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");
      assert.deepEqual(
        scanSalesOrderTaxesAuditSource(source),
        [],
        `${relative} deve permanecer read-only / sem Nomus HTTP`
      );
    }
  });

  it("resolver puro e fixtures não importam cliente HTTP Nomus", () => {
    for (const relative of [
      "src/lib/sales-orders/salesOrderRelatedNfeResolver.ts",
      "src/lib/sales-orders/salesOrderDocumentaryTaxes.ts",
      "src/lib/sales-orders/salesOrderTributosPd02781Fixtures.ts",
    ]) {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");
      assert.doesNotMatch(source, /\bfetchNomus\b|\bnomusFetch\b|\bNomusApiClient\b/);
      assert.doesNotMatch(source, /\.create\(|\.update\(|\.delete\(/);
    }
  });
});
