import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON,
  indexOrderBundlesByNfeId,
  indexUniqueOrderBundlesByNfeId,
  resolveUniqueSalesOrderFromNfeLinkCandidates,
} from "./commissionSalesOrderNfeLinkResolution.js";

describe("commissionSalesOrderNfeLinkResolution", () => {
  it("resolve único quando há um candidato", () => {
    const result = resolveUniqueSalesOrderFromNfeLinkCandidates([
      { salesOrderId: "order-a", orderCode: "PD02480" },
    ]);
    assert.equal(result.status, "OK");
    assert.equal(result.source, "INVOICE_SALES_ORDER");
    if (result.status === "OK") {
      assert.equal(result.salesOrderId, "order-a");
      assert.equal(result.orderCode, "PD02480");
    }
  });

  it("não resolve por múltiplos pedidos (mesmo valor/produto implícito)", () => {
    const result = resolveUniqueSalesOrderFromNfeLinkCandidates([
      { salesOrderId: "order-a", orderCode: "PD02480" },
      { salesOrderId: "order-b", orderCode: "PD02341" },
    ]);
    assert.equal(result.status, "AMBIGUOUS");
    assert.equal(result.source, "AMBIGUOUS");
    assert.equal(result.salesOrderId, null);
    if (result.status === "AMBIGUOUS") {
      assert.equal(result.candidateCount, 2);
      assert.ok(result.candidateOrderCodes.includes("PD02480"));
      assert.ok(result.candidateOrderCodes.includes("PD02341"));
    }
  });

  it("deduplica o mesmo salesOrderId", () => {
    const result = resolveUniqueSalesOrderFromNfeLinkCandidates([
      { salesOrderId: "order-a", orderCode: "PD02480" },
      { salesOrderId: "order-a", orderCode: "PD02480" },
    ]);
    assert.equal(result.status, "OK");
    assert.equal(result.salesOrderId, "order-a");
  });

  it("UNRESOLVED sem candidatos", () => {
    const result = resolveUniqueSalesOrderFromNfeLinkCandidates([]);
    assert.equal(result.status, "UNRESOLVED");
    assert.equal(result.salesOrderId, null);
  });

  it("indexUniqueOrderBundlesByNfeId não escolhe o primeiro quando NF é compartilhada", () => {
    const bundles = [
      {
        localOrderId: "order-old",
        orderCode: "PD02341",
        linkedNfes: [{ nfeExternalId: 6594 }],
      },
      {
        localOrderId: "order-new",
        orderCode: "PD02480",
        linkedNfes: [{ nfeExternalId: 6594 }],
      },
      {
        localOrderId: "order-unique",
        orderCode: "PD09999",
        linkedNfes: [{ nfeExternalId: 6844 }],
      },
    ];
    const indexed = indexUniqueOrderBundlesByNfeId(bundles);
    assert.equal(indexed.byNfeId.has(6594), false);
    assert.equal(indexed.ambiguousNfeIds.has(6594), true);
    assert.equal(indexed.byNfeId.get(6844)?.localOrderId, "order-unique");
    assert.equal(indexed.ambiguousNfeIds.has(6844), false);

    // alias legado também não escolhe o primeiro em ambiguidade
    const legacy = indexOrderBundlesByNfeId(bundles);
    assert.equal(legacy.has(6594), false);
    assert.equal(legacy.get(6844)?.localOrderId, "order-unique");
  });

  it("motivo de ambiguidade é amigável", () => {
    assert.match(COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON, /Vínculo ambíguo/);
    assert.match(COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON, /múltiplos pedidos/);
  });
});
