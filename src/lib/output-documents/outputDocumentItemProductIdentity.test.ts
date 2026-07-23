import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractOutputDocumentItemProductIdentity,
  isWeakOutputDocumentProductName,
  isWeakOutputDocumentProductSku,
  mergeOutputDocumentItemProductIdentity,
} from "./outputDocumentItemProductIdentity.js";

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

  it("prefere descricaoProduto a descricao genérica fraca", () => {
    assert.deepEqual(
      extractOutputDocumentItemProductIdentity({
        descricao: "3",
        descricaoProduto: "Mola 610.10AA",
        codigoProduto: "610.10AA",
      }),
      {
        sku: "610.10AA",
        productName: "Mola 610.10AA",
        unitCode: null,
      }
    );
  });
});

describe("mergeOutputDocumentItemProductIdentity", () => {
  it("substitui id numérico fraco pelo código comercial do pedido/catálogo", () => {
    const merged = mergeOutputDocumentItemProductIdentity(
      { sku: "397", productName: "3", unitCode: null },
      [
        {
          sku: "610.10AA",
          productName: "MOLA COMPRESSAO",
          unitCode: "UN",
        },
      ],
      397
    );
    assert.deepEqual(merged, {
      sku: "610.10AA",
      productName: "MOLA COMPRESSAO",
      unitCode: "UN",
    });
  });

  it("reconhece SKU fraco igual ao externalProductId", () => {
    assert.equal(isWeakOutputDocumentProductSku("397", 397), true);
    assert.equal(isWeakOutputDocumentProductSku("610.10AA", 397), false);
    assert.equal(isWeakOutputDocumentProductName("3"), true);
    assert.equal(isWeakOutputDocumentProductName("MOLA"), false);
  });
});
