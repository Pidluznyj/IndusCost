import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractOutputDocumentItemProductIdentity } from "./outputDocumentItemProductIdentity.js";

describe("extractOutputDocumentItemProductIdentity", () => {
  it("retorna vazio para raw inválido", () => {
    assert.deepEqual(extractOutputDocumentItemProductIdentity(null), {
      sku: null,
      productName: null,
      unitCode: null,
    });
  });

  it("lê SKU, descrição e unidade do item flat", () => {
    assert.deepEqual(
      extractOutputDocumentItemProductIdentity({
        sku: "SKU-77",
        descricao: "Parafuso M6",
        unidade: "UN",
      }),
      {
        sku: "SKU-77",
        productName: "Parafuso M6",
        unitCode: "UN",
      }
    );
  });

  it("prioriza campos do produto aninhado quando o item não tem SKU", () => {
    assert.deepEqual(
      extractOutputDocumentItemProductIdentity({
        produto: {
          codigo: "COD-9",
          nome: "Arruela",
          siglaUnidade: "PC",
        },
      }),
      {
        sku: "COD-9",
        productName: "Arruela",
        unitCode: "PC",
      }
    );
  });
});
