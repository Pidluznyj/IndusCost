/**
 * TRIB-06 — Estados visuais da aba Tributos + viewports 1366×768 / 1920×1080.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesOrderTributosTab } from "@/src/components/sales/SalesOrderTributosTab";
import {
  emptySalesOrderFiscalSettlementsBlock,
  type SalesOrderFiscalTaxesPayload,
} from "./salesOrderFiscalTaxesClient.js";
import {
  SALES_ORDER_TRIBUTOS_DENIED_MESSAGE,
  SALES_ORDER_TRIBUTOS_EMPTY_MESSAGE,
  SALES_ORDER_TRIBUTOS_ERROR_FALLBACK_MESSAGE,
  SALES_ORDER_TRIBUTOS_LOADING_MESSAGE,
  SALES_ORDER_TRIBUTOS_NO_VALID_NFE_MESSAGE,
  SALES_ORDER_TRIBUTOS_PARTIAL_WARNING,
  SALES_ORDER_TRIBUTOS_PRIMARY_TAX_TYPES,
  SALES_ORDER_TRIBUTOS_VIEWPORTS,
  buildPrimaryHighlightedTaxCards,
  formatSalesOrderTributosLinkOrigins,
  resolveSalesOrderTributosTabViewState,
  salesOrderTributosAdditiveExists,
  salesOrderTributosErrorMessage,
  salesOrderTributosViewportClass,
} from "./salesOrderTributosTabUi.js";

function basePayload(
  overrides: Partial<SalesOrderFiscalTaxesPayload> = {}
): SalesOrderFiscalTaxesPayload {
  return {
    status: "available",
    statusReason: null,
    warnings: [],
    linkOrigins: [
      {
        nfeExternalId: 100,
        numero: "100",
        origins: ["SALES_ORDER_NFE_LINK"],
        primaryOrigin: "SALES_ORDER_NFE_LINK",
      },
    ],
    summary: {
      orderActiveValue: 1000,
      productsValue: 900,
      discountsValue: 10,
      freightValue: 20,
      insuranceValue: 0,
      otherExpensesValue: 5,
      nfeValidTotal: 950,
      amountToInvoice: 50,
      financialBalance: null,
      financialBalanceLabel: "Sem CR gerado",
      validNfeCount: 1,
      cancelledNfeCount: 0,
      compositionIncomplete: false,
      compositionIncompleteReason: null,
      sourceLabel: "XML NF-e",
      lastParsedAt: "2026-07-16T12:00:00.000Z",
      parserVersion: "test",
    },
    highlightedTaxes: [
      { taxType: "ICMS", label: "ICMS", amount: 100 },
      { taxType: "IPI", label: "IPI", amount: 50 },
      { taxType: "PIS", label: "PIS", amount: 10 },
      { taxType: "COFINS", label: "COFINS", amount: 40 },
    ],
    nfes: [
      {
        nomusNfeId: "n1",
        nfeExternalId: 100,
        numero: "100",
        serie: "1",
        chave: null,
        emissionDate: "2026-07-01T00:00:00.000Z",
        status: 100,
        statusLabel: "Autorizada",
        isCancelled: false,
        isValidForTotals: true,
        finalidade: 1,
        productsValue: 900,
        discountsValue: 10,
        freightValue: 20,
        insuranceValue: 0,
        otherExpensesValue: 5,
        taxesTotalHeader: 200,
        highlightedTaxesFallback: null,
        totalValue: 950,
        compositionIncomplete: false,
        source: "FISCAL_SUMMARY",
        parsedAt: "2026-07-16T12:00:00.000Z",
        parserVersion: "test",
        linkOrigin: "SALES_ORDER_NFE_LINK",
        linkOrigins: ["SALES_ORDER_NFE_LINK"],
        headerTaxes: [
          { taxType: "ICMS", label: "ICMS", amount: 100 },
          { taxType: "IPI", label: "IPI", amount: 50 },
        ],
        itemTaxLines: [],
      },
    ],
    cancelledNfes: [],
    itemTaxLines: [],
    settlements: emptySalesOrderFiscalSettlementsBlock("2026-07-16T12:00:00.000Z"),
    technical: {
      source: "test",
      note: "Tributos documentais",
      doNotSumHeaderAndItem: true,
    },
    ...overrides,
  };
}

function TributosViewportShell({
  viewport,
  children,
}: {
  viewport: "1366" | "1920";
  children: React.ReactNode;
}): JSX.Element {
  const meta = SALES_ORDER_TRIBUTOS_VIEWPORTS.find((v) => v.id === viewport)!;
  return (
    <div
      data-testid={`sales-order-tributos-viewport-${viewport}`}
      data-viewport={viewport}
      data-viewport-label={meta.label}
      className={salesOrderTributosViewportClass(viewport)}
      style={{ width: meta.width, maxHeight: meta.height }}
    >
      {children}
    </div>
  );
}

describe("TRIB-06 — resolveSalesOrderTributosTabViewState", () => {
  it("distingue loading, denied, error, empty, unavailable, partial, available", () => {
    assert.equal(
      resolveSalesOrderTributosTabViewState({ loading: true }),
      "loading"
    );
    assert.equal(
      resolveSalesOrderTributosTabViewState({
        fiscalTaxesAccess: "denied",
        fiscalTaxes: null,
      }),
      "denied"
    );
    assert.equal(
      resolveSalesOrderTributosTabViewState({ error: "falha" }),
      "error"
    );
    assert.equal(
      resolveSalesOrderTributosTabViewState({
        fiscalTaxes: basePayload({ status: "error", statusReason: "x" }),
      }),
      "error"
    );
    assert.equal(
      resolveSalesOrderTributosTabViewState({ fiscalTaxes: null }),
      "empty"
    );
    assert.equal(
      resolveSalesOrderTributosTabViewState({
        fiscalTaxes: basePayload({ status: "unavailable", nfes: [] }),
      }),
      "unavailable"
    );
    assert.equal(
      resolveSalesOrderTributosTabViewState({
        fiscalTaxes: basePayload({ status: "partial", warnings: ["w"] }),
      }),
      "partial"
    );
    assert.equal(
      resolveSalesOrderTributosTabViewState({
        fiscalTaxes: basePayload({ status: "available" }),
      }),
      "available"
    );
  });

  it("mensagens de estado são distintas", () => {
    const msgs = [
      SALES_ORDER_TRIBUTOS_LOADING_MESSAGE,
      SALES_ORDER_TRIBUTOS_DENIED_MESSAGE,
      SALES_ORDER_TRIBUTOS_ERROR_FALLBACK_MESSAGE,
      SALES_ORDER_TRIBUTOS_EMPTY_MESSAGE,
      SALES_ORDER_TRIBUTOS_NO_VALID_NFE_MESSAGE,
      SALES_ORDER_TRIBUTOS_PARTIAL_WARNING,
    ];
    assert.equal(new Set(msgs).size, msgs.length);
    assert.equal(
      SALES_ORDER_TRIBUTOS_NO_VALID_NFE_MESSAGE,
      "Não há NF-e válida vinculada a este pedido para apresentação dos tributos documentais."
    );
  });

  it("buildPrimaryHighlightedTaxCards cobre ICMS/IPI/PIS/COFINS/ICMS-ST", () => {
    const cards = buildPrimaryHighlightedTaxCards([
      { taxType: "IPI", label: "IPI", amount: 1 },
    ]);
    for (const taxType of SALES_ORDER_TRIBUTOS_PRIMARY_TAX_TYPES) {
      assert.ok(cards.some((c) => c.taxType === taxType));
    }
    assert.equal(cards.find((c) => c.taxType === "IPI")!.amount, 1);
    assert.equal(cards.find((c) => c.taxType === "ICMS")!.amount, null);
  });

  it("additive exists e link origins", () => {
    assert.equal(salesOrderTributosAdditiveExists(0), true);
    assert.equal(salesOrderTributosAdditiveExists(null), false);
    assert.match(
      formatSalesOrderTributosLinkOrigins(basePayload().linkOrigins) ?? "",
      /SALES_ORDER_NFE_LINK/
    );
    assert.match(
      salesOrderTributosErrorMessage({
        fiscalTaxes: basePayload({
          status: "error",
          statusReason: "boom técnico",
        }),
      }),
      /boom/
    );
  });
});

describe("TRIB-06 — SalesOrderTributosTab estados", () => {
  it("loading", () => {
    const html = renderToStaticMarkup(
      <SalesOrderTributosTab fiscalTaxes={null} loading />
    );
    assert.match(html, /sales-order-tributos-loading/);
    assert.ok(html.includes(SALES_ORDER_TRIBUTOS_LOADING_MESSAGE));
    assert.match(html, /data-view-state="loading"/);
  });

  it("acesso negado", () => {
    const html = renderToStaticMarkup(
      <SalesOrderTributosTab
        fiscalTaxes={null}
        denied
        fiscalTaxesAccess="denied"
      />
    );
    assert.match(html, /sales-order-tributos-denied/);
    assert.ok(html.includes(SALES_ORDER_TRIBUTOS_DENIED_MESSAGE));
    assert.doesNotMatch(html, new RegExp(SALES_ORDER_TRIBUTOS_NO_VALID_NFE_MESSAGE));
  });

  it("erro técnico", () => {
    const html = renderToStaticMarkup(
      <SalesOrderTributosTab
        fiscalTaxes={basePayload({
          status: "error",
          statusReason: "Falha ao montar payload",
        })}
      />
    );
    assert.match(html, /sales-order-tributos-error/);
    assert.ok(html.includes("Falha ao montar payload"));
    assert.doesNotMatch(html, new RegExp(SALES_ORDER_TRIBUTOS_NO_VALID_NFE_MESSAGE));
  });

  it("nenhuma NF válida", () => {
    const html = renderToStaticMarkup(
      <SalesOrderTributosTab
        fiscalTaxes={basePayload({
          status: "unavailable",
          statusReason: "sem nf",
          nfes: [],
          highlightedTaxes: [],
          summary: {
            ...basePayload().summary,
            validNfeCount: 0,
            nfeValidTotal: 0,
            freightValue: 0,
            discountsValue: 0,
            otherExpensesValue: 0,
          },
        })}
      />
    );
    assert.match(html, /sales-order-tributos-no-nfe/);
    assert.ok(html.includes(SALES_ORDER_TRIBUTOS_NO_VALID_NFE_MESSAGE));
    assert.match(html, /data-view-state="unavailable"/);
  });

  it("dados parciais: aviso neutro + valores disponíveis", () => {
    const html = renderToStaticMarkup(
      <SalesOrderTributosTab
        fiscalTaxes={basePayload({
          status: "partial",
          warnings: ["Resumo fiscal oficial ausente"],
          summary: {
            ...basePayload().summary,
            compositionIncomplete: true,
          },
        })}
      />
    );
    assert.match(html, /sales-order-tributos-warnings/);
    assert.ok(html.includes(SALES_ORDER_TRIBUTOS_PARTIAL_WARNING));
    assert.match(html, /sales-order-tributos-summary/);
    assert.match(html, /sales-order-tributos-highlighted/);
    assert.match(html, /data-tax-type="ICMS"/);
    assert.match(html, /data-tax-type="IPI"/);
    assert.doesNotMatch(html, /impostos pagos/i);
  });

  it("dados disponíveis: cards, NF, tributos e origem documental", () => {
    const html = renderToStaticMarkup(
      <SalesOrderTributosTab fiscalTaxes={basePayload()} showTechnical={false} />
    );
    assert.match(html, /data-view-state="available"/);
    assert.match(html, /sales-order-tributos-summary/);
    assert.match(html, /sales-order-tributos-highlighted/);
    assert.match(html, /Tributos destacados/);
    assert.match(html, /sales-order-tributos-nfes/);
    assert.match(html, /sales-order-tributos-nfe-row-100/);
    assert.match(html, /sales-order-tributos-documentary-origin/);
    assert.match(html, /Origem documental/);
    assert.match(html, /Descontos/);
    assert.match(html, /Frete/);
    assert.match(html, /Outras despesas \/ acréscimos/);
    for (const taxType of SALES_ORDER_TRIBUTOS_PRIMARY_TAX_TYPES) {
      assert.match(html, new RegExp(`data-tax-type="${taxType}"`));
    }
    assert.doesNotMatch(html, /impostos pagos/i);
  });
});

describe("TRIB-06 — viewports 1366×768 e 1920×1080", () => {
  it("shells de validação visual preservam conteúdo da aba", () => {
    for (const vp of SALES_ORDER_TRIBUTOS_VIEWPORTS) {
      const html = renderToStaticMarkup(
        <TributosViewportShell viewport={vp.id}>
          <SalesOrderTributosTab fiscalTaxes={basePayload()} showTechnical={false} />
        </TributosViewportShell>
      );
      assert.ok(html.includes(`data-viewport="${vp.id}"`));
      assert.ok(html.includes(`sales-order-tributos-viewport-${vp.id}`));
      assert.ok(html.includes(vp.label));
      assert.ok(html.includes(salesOrderTributosViewportClass(vp.id).split(" ")[0]!));
      assert.match(html, /sales-order-tributos-tab/);
      assert.match(html, /sales-order-tributos-summary/);
    }
  });

  it("modal de detalhe preserva cabeçalho, abas e dimensões", () => {
    const dialog = readFileSync(
      new URL("../../components/sales/SalesOrderDetailDialog.tsx", import.meta.url),
      "utf8"
    );
    assert.match(dialog, /sales-order-detail-tabs/);
    assert.match(dialog, /sales-order-detail-tab-tributos/);
    assert.match(dialog, /SalesOrderTributosTab/);
    assert.match(dialog, /fiscalTaxesAccess/);
    assert.doesNotMatch(dialog, /w-\[1366px\]/);
    assert.doesNotMatch(dialog, /w-\[1920px\]/);
    assert.match(dialog, /max-w-|max-h-|h-\[|min-h-/);
  });
});
