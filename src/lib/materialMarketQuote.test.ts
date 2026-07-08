import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketQuoteListResponse,
  calculateMaterialMarketQuoteNetPrice,
  parseMaterialMarketQuoteInput,
  sortMaterialMarketQuotesChronologically,
} from "./materialMarketQuote.js";

describe("materialMarketQuote", () => {
  it("calcula preço líquido com frete e imposto", () => {
    assert.equal(
      calculateMaterialMarketQuoteNetPrice({
        price: 100,
        freightValue: 10,
        taxValue: 5,
      }),
      115
    );
  });

  it("preço líquido sem frete/imposto igual ao preço base", () => {
    assert.equal(
      calculateMaterialMarketQuoteNetPrice({
        price: 42.5,
      }),
      42.5
    );
  });

  it("parse exige fornecedor e data", () => {
    const missingSupplier = parseMaterialMarketQuoteInput(
      { quoteDate: "2026-03-01", price: 10, unit: "kg" },
      { unit: "kg" }
    );
    assert.equal(missingSupplier.ok, false);

    const ok = parseMaterialMarketQuoteInput({
      supplierName: "Fornecedor A",
      quoteDate: "2026-03-01",
      price: 100,
      freightValue: 8,
      taxValue: 2,
      unit: "kg",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.netPrice, 110);
      assert.equal(ok.value.supplierName, "Fornecedor A");
    }
  });

  it("lista mantém ordem cronológica decrescente", () => {
    const rows = buildMaterialMarketQuoteListResponse([
      {
        id: "1",
        materialId: "m1",
        quoteDate: "2026-01-01",
        price: 10,
        currency: "BRL",
        unit: "kg",
        netPrice: 10,
        status: "ACTIVE",
        createdAt: "2026-01-02T10:00:00Z",
        updatedAt: "2026-01-02T10:00:00Z",
      },
      {
        id: "2",
        materialId: "m1",
        quoteDate: "2026-03-01",
        price: 12,
        currency: "BRL",
        unit: "kg",
        netPrice: 12,
        status: "ACTIVE",
        createdAt: "2026-03-02T10:00:00Z",
        updatedAt: "2026-03-02T10:00:00Z",
      },
      {
        id: "3",
        materialId: "m1",
        quoteDate: "2026-02-01",
        price: 11,
        currency: "BRL",
        unit: "kg",
        netPrice: 11,
        status: "ACTIVE",
        createdAt: "2026-02-02T10:00:00Z",
        updatedAt: "2026-02-02T10:00:00Z",
      },
    ]);
    assert.deepEqual(rows.items.map((i) => i.id), ["2", "3", "1"]);
  });

  it("desempate por createdAt na mesma quoteDate", () => {
    const sorted = sortMaterialMarketQuotesChronologically([
      { quoteDate: "2026-03-01", createdAt: "2026-03-01T08:00:00Z" },
      { quoteDate: "2026-03-01", createdAt: "2026-03-01T12:00:00Z" },
    ]);
    assert.equal(sorted[0]?.createdAt, "2026-03-01T12:00:00Z");
  });

  it("serializa aliases de conversão congelada (original/converted)", () => {
    const { items } = buildMaterialMarketQuoteListResponse([
      {
        id: "usd-1",
        materialId: "m1",
        quoteDate: "2026-07-05",
        price: 100,
        currency: "USD",
        unit: "kg",
        netPrice: 100,
        status: "ACTIVE",
        exchangeOrigin: "BCB_PTAX",
        ptaxVenda: 5.5,
        priceBrl: 550,
        netPriceBrl: 550,
        createdAt: "2026-07-05T10:00:00Z",
        updatedAt: "2026-07-05T10:00:00Z",
      },
      {
        id: "brl-1",
        materialId: "m1",
        quoteDate: "2026-07-04",
        price: 80,
        currency: "BRL",
        unit: "kg",
        netPrice: 80,
        status: "ACTIVE",
        ptaxFetchStatus: "SKIPPED",
        priceBrl: 80,
        netPriceBrl: 80,
        createdAt: "2026-07-04T10:00:00Z",
        updatedAt: "2026-07-04T10:00:00Z",
      },
    ]);

    const usd = items.find((i) => i.id === "usd-1");
    assert.ok(usd);
    assert.equal(usd.originalCurrency, "USD");
    assert.equal(usd.originalPrice, 100);
    assert.equal(usd.exchangeRateUsed, 5.5);
    assert.equal(usd.convertedPriceBRL, 550);

    const brl = items.find((i) => i.id === "brl-1");
    assert.ok(brl);
    assert.equal(brl.originalCurrency, "BRL");
    assert.equal(brl.originalPrice, 80);
    assert.equal(brl.exchangeRateUsed, null);
    assert.equal(brl.convertedPriceBRL, 80);
  });
});
