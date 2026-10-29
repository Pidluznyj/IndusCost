import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyNomusProposalItem } from "./nomusProposalItemClassification.ts";

const local = new Map([
  ["SKU-ATIVO", "prod-1"],
  ["SKU-INATIVO", "prod-2"],
]);
const active = new Map([
  ["SKU-ATIVO", true],
  ["SKU-INATIVO", false],
  ["SKU-INATIVO-SEM-CADASTRO", false],
]);

describe("item de proposta do Nomus na importação", () => {
  it("produto ativo com cadastro local → importa sem marca", () => {
    assert.deepEqual(classifyNomusProposalItem({ sku: "SKU-ATIVO", nomusActiveBySku: active, localProductIdBySku: local }), {
      kind: "IMPORT",
      productId: "prod-1",
      sku: "SKU-ATIVO",
      nomusProductInactive: false,
    });
  });

  it("produto inativo no Nomus com cadastro local → importa marcado (proposta não é descartada)", () => {
    assert.deepEqual(classifyNomusProposalItem({ sku: "SKU-INATIVO", nomusActiveBySku: active, localProductIdBySku: local }), {
      kind: "IMPORT",
      productId: "prod-2",
      sku: "SKU-INATIVO",
      nomusProductInactive: true,
    });
  });

  it("produto inexistente no IndusCost → pendência, sem inventar produto", () => {
    assert.deepEqual(classifyNomusProposalItem({ sku: "SKU-NOVO", nomusActiveBySku: active, localProductIdBySku: local }), {
      kind: "MISSING_PRODUCT",
      sku: "SKU-NOVO",
      nomusProductInactive: false,
    });
    assert.deepEqual(
      classifyNomusProposalItem({ sku: "SKU-INATIVO-SEM-CADASTRO", nomusActiveBySku: active, localProductIdBySku: local }),
      { kind: "MISSING_PRODUCT", sku: "SKU-INATIVO-SEM-CADASTRO", nomusProductInactive: true }
    );
  });

  it("item sem SKU → ignorado como antes", () => {
    assert.deepEqual(classifyNomusProposalItem({ sku: null, nomusActiveBySku: active, localProductIdBySku: local }), { kind: "NO_SKU" });
    assert.deepEqual(classifyNomusProposalItem({ sku: "  ", nomusActiveBySku: active, localProductIdBySku: local }), { kind: "NO_SKU" });
  });
});
