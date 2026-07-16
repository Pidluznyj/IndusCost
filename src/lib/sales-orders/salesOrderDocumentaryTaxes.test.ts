import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDocumentaryHeaderTaxes,
  consolidateDocumentaryHeaderTaxes,
  dedupeDocumentaryNfesByExternalId,
  fromDocumentaryMoneyCents,
  parseDocumentaryMoney,
  resolveDocumentaryProductsNet,
  sumDocumentaryMoney,
  toDocumentaryMoneyCents,
} from "./salesOrderDocumentaryTaxes.js";

describe("salesOrderDocumentaryTaxes (TRIB-04)", () => {
  it("uma NF: extrai produtos, total, ICMS (base+valor), IPI, PIS, frete e desconto", () => {
    const header = buildDocumentaryHeaderTaxes({
      taxLines: [
        { taxType: "ICMS", scope: "HEADER", amount: 10, baseAmount: 100 },
        { taxType: "IPI", scope: "HEADER", amount: 5.5 },
        { taxType: "PIS", scope: "HEADER", amount: 0 },
      ],
      summaryTotals: {
        vCOFINS: 1.2,
        vFrete: undefined,
      },
    });

    const icms = header.find((t) => t.taxType === "ICMS");
    const ipi = header.find((t) => t.taxType === "IPI");
    const pis = header.find((t) => t.taxType === "PIS");
    const cofins = header.find((t) => t.taxType === "COFINS");

    assert.equal(icms?.amount, 10);
    assert.equal(icms?.baseAmount, 100);
    assert.equal(ipi?.amount, 5.5);
    assert.equal(pis?.amount, 0);
    assert.equal(cofins?.amount, 1.2);

    assert.equal(
      resolveDocumentaryProductsNet({ productsValue: 200, discountsValue: 20 }),
      180
    );
  });

  it("várias NF-es: consolida sem misturar HEADER e sem Number comum", () => {
    const a = buildDocumentaryHeaderTaxes({
      taxLines: [{ taxType: "IPI", scope: "HEADER", amount: 10.11 }],
    });
    const b = buildDocumentaryHeaderTaxes({
      taxLines: [{ taxType: "IPI", scope: "HEADER", amount: 10.1 }],
    });
    const consolidated = consolidateDocumentaryHeaderTaxes([a, b]);
    const ipi = consolidated.find((t) => t.taxType === "IPI");
    assert.equal(ipi?.amount, 20.21);
    assert.equal(sumDocumentaryMoney([10.11, 10.1]), 20.21);
  });

  it("NF duplicada por várias fontes: dedupe por nfeExternalId", () => {
    const deduped = dedupeDocumentaryNfesByExternalId([
      { nfeExternalId: 100, tag: "link" },
      { nfeExternalId: 100, tag: "o2c" },
      { nfeExternalId: 200, tag: "stock" },
    ]);
    assert.equal(deduped.length, 2);
    assert.equal(deduped[0]!.tag, "link");
    assert.equal(deduped[1]!.nfeExternalId, 200);
  });

  it("imposto zero oficial é preservado; campo ausente não é inventado", () => {
    const header = buildDocumentaryHeaderTaxes({
      taxLines: [
        { taxType: "ICMS", scope: "HEADER", amount: 0, baseAmount: 50 },
        // amount ausente + rate/base: não inventar
        { taxType: "IPI", scope: "HEADER", amount: null, baseAmount: 100, rate: 10 },
      ],
      summaryTotals: {
        vPIS: null,
        vCOFINS: undefined,
      },
    });

    assert.equal(header.find((t) => t.taxType === "ICMS")?.amount, 0);
    assert.equal(header.find((t) => t.taxType === "IPI"), undefined);
    assert.equal(header.find((t) => t.taxType === "PIS"), undefined);
    assert.equal(header.find((t) => t.taxType === "COFINS"), undefined);
  });

  it("frete e despesas vêm do summary sem recalcular tributo", () => {
    const header = buildDocumentaryHeaderTaxes({
      summaryTotals: {
        vIPI: 1,
        vICMS: 0,
      },
    });
    assert.equal(header.find((t) => t.taxType === "IPI")?.amount, 1);
    assert.equal(header.find((t) => t.taxType === "ICMS")?.amount, 0);
    // frete/despesas não são taxType — só totais de cabeçalho monetário
    assert.equal(parseDocumentaryMoney(12.345), 12.35);
    assert.equal(parseDocumentaryMoney(null), null);
  });

  it("arredondamento monetário em centavos", () => {
    assert.equal(sumDocumentaryMoney([0.1, 0.2]), 0.3);
    assert.equal(sumDocumentaryMoney([10.11, 10.1]), 20.21);
    assert.equal(
      fromDocumentaryMoneyCents(toDocumentaryMoneyCents(1.005) * 2),
      fromDocumentaryMoneyCents(toDocumentaryMoneyCents(1.005) * 2)
    );
  });
});
