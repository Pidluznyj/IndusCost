import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveMaterialMarketQuoteExchange,
  previewMaterialMarketQuotePtax,
} from "./materialMarketQuoteExchange.js";

const QUOTE_DATE = new Date("2026-07-05T12:00:00");

describe("materialMarketQuoteExchange", () => {
  it("BRL: netPriceBrl = netPrice, ptaxVenda null, ptaxFetchStatus SKIPPED", async () => {
    const result = await resolveMaterialMarketQuoteExchange(
      {
        currency: "BRL",
        quoteDate: QUOTE_DATE,
        price: 100,
        netPrice: 115,
      },
      { canManualExchange: false }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.ptaxVenda, null);
    assert.equal(result.value.ptaxFetchStatus, "SKIPPED");
    assert.equal(result.value.priceBrl, 100);
    assert.equal(result.value.netPriceBrl, 115);
    assert.equal(result.value.exchangeOrigin, null);
  });

  it("USD com PTAX venda 5.50 e preço 100 → netPriceBrl 550", async () => {
    const result = await resolveMaterialMarketQuoteExchange(
      {
        currency: "USD",
        quoteDate: QUOTE_DATE,
        price: 100,
        netPrice: 100,
      },
      {
        canManualExchange: false,
        fetchPtax: async () => ({
          ok: true,
          ptaxVenda: 5.5,
          referenceDate: "2026-07-05",
        }),
      }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.exchangeOrigin, "BCB_PTAX");
    assert.equal(result.value.ptaxVenda, 5.5);
    assert.equal(result.value.priceBrl, 550);
    assert.equal(result.value.netPriceBrl, 550);
    assert.equal(result.value.ptaxFetchStatus, "SUCCESS");
  });

  it("USD com frete/imposto: conversão aplica sobre netPrice", async () => {
    const result = await resolveMaterialMarketQuoteExchange(
      {
        currency: "USD",
        quoteDate: QUOTE_DATE,
        price: 100,
        netPrice: 115,
      },
      {
        canManualExchange: false,
        fetchPtax: async () => ({
          ok: true,
          ptaxVenda: 5.5,
          referenceDate: "2026-07-05",
        }),
      }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.priceBrl, 550);
    assert.equal(result.value.netPriceBrl, 632.5);
  });

  it("fallback de fim de semana via fetchPtax com data de referência anterior", async () => {
    const result = await resolveMaterialMarketQuoteExchange(
      {
        currency: "USD",
        quoteDate: new Date("2026-07-05T12:00:00"),
        price: 10,
        netPrice: 10,
      },
      {
        canManualExchange: false,
        fetchPtax: async () => ({
          ok: true,
          ptaxVenda: 5.2,
          referenceDate: "2026-07-04",
        }),
      }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.ptaxVenda, 5.2);
    assert.equal(result.value.ptaxReferenceDate?.toISOString().slice(0, 10), "2026-07-04");
    assert.equal(result.value.netPriceBrl, 52);
  });

  it("PTAX indisponível sem permissão manual: salva com falha e sem BRL", async () => {
    const result = await resolveMaterialMarketQuoteExchange(
      {
        currency: "USD",
        quoteDate: QUOTE_DATE,
        price: 100,
        netPrice: 100,
      },
      {
        canManualExchange: false,
        fetchPtax: async () => ({
          ok: false,
          reason: "PTAX indisponível para 2026-07-05.",
        }),
      }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.ptaxFetchStatus, "FAILED");
    assert.equal(result.value.priceBrl, null);
    assert.equal(result.value.netPriceBrl, null);
    assert.match(result.warning ?? "", /PTAX indisponível/i);
  });

  it("PTAX indisponível com permissão manual exige taxa e justificativa", async () => {
    const withoutRate = await resolveMaterialMarketQuoteExchange(
      {
        currency: "USD",
        quoteDate: QUOTE_DATE,
        price: 100,
        netPrice: 100,
      },
      {
        canManualExchange: true,
        fetchPtax: async () => ({ ok: false, reason: "PTAX falhou." }),
      }
    );
    assert.equal(withoutRate.ok, false);
    if (withoutRate.ok) return;
    assert.equal(withoutRate.code, "MANUAL_EXCHANGE_RATE_INVALID");

    const withoutJustification = await resolveMaterialMarketQuoteExchange(
      {
        currency: "USD",
        quoteDate: QUOTE_DATE,
        price: 100,
        netPrice: 100,
        manualExchangeRate: 5.5,
      },
      {
        canManualExchange: true,
        fetchPtax: async () => ({ ok: false, reason: "PTAX falhou." }),
      }
    );
    assert.equal(withoutJustification.ok, false);
    if (withoutJustification.ok) return;
    assert.equal(withoutJustification.code, "MANUAL_EXCHANGE_JUSTIFICATION_REQUIRED");

    const manualOk = await resolveMaterialMarketQuoteExchange(
      {
        currency: "USD",
        quoteDate: QUOTE_DATE,
        price: 100,
        netPrice: 100,
        manualExchangeRate: 5.5,
        manualExchangeJustification: "PTAX não publicada no dia.",
      },
      {
        canManualExchange: true,
        userId: "user-1",
        fetchPtax: async () => ({ ok: false, reason: "PTAX falhou." }),
      }
    );
    assert.equal(manualOk.ok, true);
    if (!manualOk.ok) return;
    assert.equal(manualOk.value.exchangeOrigin, "MANUAL");
    assert.equal(manualOk.value.netPriceBrl, 550);
    assert.equal(manualOk.value.manualExchangeBy, "user-1");
  });

  it("previewMaterialMarketQuotePtax reflete sucesso e falha", async () => {
    const ok = await previewMaterialMarketQuotePtax(QUOTE_DATE, {
      canManualExchange: true,
      fetchPtax: async () => ({
        ok: true,
        ptaxVenda: 5.5,
        referenceDate: "2026-07-05",
      }),
    });
    assert.equal(ok.status, "SUCCESS");
    assert.equal(ok.ptaxVenda, 5.5);

    const fail = await previewMaterialMarketQuotePtax(QUOTE_DATE, {
      canManualExchange: false,
      fetchPtax: async () => ({ ok: false, reason: "BCB offline." }),
    });
    assert.equal(fail.status, "FAILED");
    assert.equal(fail.ptaxVenda, null);
    assert.equal(fail.canManualExchange, false);
  });
});
