/**
 * Resolvedor ponto-no-tempo da tabela comercial.
 *
 * O motor antigo consultava só `status: "PUBLISHED"`, então uma venda passada
 * era avaliada contra a tabela publicada hoje e versões ARCHIVED válidas na
 * época ficavam invisíveis.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveHistoricalCommercialPrice,
  type CommercialProductPriceCandidate,
  type PriceTableVersionCandidate,
} from "./commissionHistoricalPriceTable.js";

const PROD = "prod-630-01AA";
const VENDA = new Date("2026-07-10T00:00:00.000Z");

function version(
  over: Partial<PriceTableVersionCandidate> = {}
): PriceTableVersionCandidate {
  return {
    tableId: "t1",
    tableCode: "ATACADO",
    versionId: "v-hist",
    versionNumber: 24,
    status: "ARCHIVED",
    effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...over,
  };
}

function price(
  over: Partial<CommercialProductPriceCandidate> = {}
): CommercialProductPriceCandidate {
  return {
    versionId: "v-hist",
    productId: PROD,
    productSku: "630.01AA",
    salePrice: 250,
    commissionPercent: 1.5,
    ...over,
  };
}

describe("resolvedor histórico — vigência na data da venda", () => {
  it("versão ARCHIVED válida na data É resolvida", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version()],
      prices: [price()],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.versionStatus, "ARCHIVED");
    assert.equal(r.salePrice, 250);
    assert.equal(r.resolutionSource, "POINT_IN_TIME");
  });

  it("PUBLISHED atual que NÃO vigorava na data não é usada", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [
        version({
          versionId: "v-atual",
          versionNumber: 47,
          status: "PUBLISHED",
          effectiveFrom: new Date("2026-08-03T00:00:00.000Z"),
          effectiveTo: null,
        }),
      ],
      prices: [price({ versionId: "v-atual" })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "NO_EFFECTIVE_PRICE_TABLE_FOR_SALE_DATE");
  });

  it("entre histórica e atual, escolhe a que vigorava na data", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [
        version(),
        version({
          versionId: "v-atual",
          versionNumber: 47,
          status: "PUBLISHED",
          effectiveFrom: new Date("2026-08-03T00:00:00.000Z"),
          effectiveTo: null,
        }),
      ],
      prices: [price(), price({ versionId: "v-atual", salePrice: 999 })],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.versionId, "v-hist");
    assert.equal(r.salePrice, 250);
  });

  it("vigência aberta (effectiveTo null) cobre datas seguintes", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [
        version({
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: null,
          status: "PUBLISHED",
        }),
      ],
      prices: [price()],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.resolutionSource, "OPEN_ENDED_CURRENT");
  });

  it("limite superior é EXCLUSIVO — versão que termina no dia não cobre o dia", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version({ effectiveTo: VENDA })],
      prices: [price()],
    });
    assert.equal(r.ok, false);
  });

  it("DRAFT nunca vigora", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version({ status: "DRAFT" })],
      prices: [price()],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "NO_EFFECTIVE_PRICE_TABLE_FOR_SALE_DATE");
  });
});

describe("resolvedor histórico — ambiguidade e vigência quebrada", () => {
  it("duas versões vigentes geram diagnóstico, não escolha silenciosa", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version(), version({ versionId: "v2", versionNumber: 25 })],
      prices: [price(), price({ versionId: "v2" })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "MULTIPLE_EFFECTIVE_PRICE_TABLE_VERSIONS");
    assert.equal((r.diagnostic.evidence.versions as unknown[]).length, 2);
  });

  it("vigência de largura zero é inconsistência, não ausência", () => {
    const d = new Date("2026-06-30T00:00:00.000Z");
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version({ effectiveFrom: d, effectiveTo: d })],
      prices: [price()],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "INVALID_PRICE_TABLE_VALIDITY");
  });

  it("effectiveTo anterior a effectiveFrom também é inconsistência", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [
        version({
          effectiveFrom: new Date("2026-06-30T00:00:00.000Z"),
          effectiveTo: new Date("2025-12-31T00:00:00.000Z"),
        }),
      ],
      prices: [price()],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "INVALID_PRICE_TABLE_VALIDITY");
  });
});

describe("resolvedor histórico — produto e preço", () => {
  it("produto ausente da versão gera código específico, não NO_MARGIN", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version()],
      prices: [price({ productId: "outro" })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "PRODUCT_NOT_FOUND_IN_PRICE_TABLE");
    assert.equal(r.diagnostic.evidence.versionNumber, 24);
  });

  it("produto duplicado bloqueia o cálculo", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version()],
      prices: [price(), price({ salePrice: 300 })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "PRODUCT_DUPLICATED_IN_PRICE_TABLE");
  });

  it("preço ausente NÃO vira NO_MARGIN", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version()],
      prices: [price({ salePrice: null })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "COMMERCIAL_PRICE_MISSING");
    assert.notEqual(r.diagnostic.code, "MARGIN_INVALID");
  });

  it("preço zero é inválido, e é causa distinta de ausente", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version()],
      prices: [price({ salePrice: 0 })],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "COMMERCIAL_PRICE_INVALID");
  });
});

describe("PD 02747 — venda em 10/07/2026", () => {
  it("com versão histórica cobrindo a data e o produto, o cálculo é possível", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version()],
      prices: [price({ salePrice: 250, commissionPercent: 1.5 })],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.commissionPercent, 1.5);
  });

  it("sem versão cobrindo 10/07, a causa é explícita — não 'margem indisponível'", () => {
    const r = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [
        version({
          effectiveFrom: new Date("2026-08-03T00:00:00.000Z"),
          effectiveTo: null,
          status: "PUBLISHED",
        }),
      ],
      prices: [price()],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.diagnostic.code, "NO_EFFECTIVE_PRICE_TABLE_FOR_SALE_DATE");
    assert.match(r.diagnostic.userMessage, /vigente para a data da venda/i);
    assert.equal(r.diagnostic.category, "PRICE_TABLE");
  });

  it("o resultado depende do fixture — não força comissão positiva", () => {
    const semProduto = resolveHistoricalCommercialPrice({
      referenceDate: VENDA,
      productId: PROD,
      versions: [version()],
      prices: [],
    });
    assert.equal(semProduto.ok, false);
  });
});
