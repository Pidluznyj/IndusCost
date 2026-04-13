import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BomCostDetailRow } from "./BomCostDetailRow";

describe("BomCostDetailRow", () => {
  it("linha excluída usa fundo vermelho e não mostra valores como custo válido", () => {
    const html = renderToStaticMarkup(
      <BomCostDetailRow
        item={{
          description: "Teste",
          requiredQty: 1,
          basePrice: 0,
          unitCost: 0,
          excludedFromCost: true,
          errorCode: "ROUTING_MISSING",
          message: "Sem processo",
          detailChain: "ROUTING_MISSING: Sem processo",
          sku: "308.03AA",
          name: "Item",
        }}
      />
    );
    assert.ok(html.includes("bg-red-500"));
    assert.ok(html.includes("Não incluído no custo"));
    assert.ok(html.includes("—"));
    assert.ok(html.includes("title="));
    assert.ok(html.includes("ROUTING_MISSING"));
  });

  it("linha normal não marca exclusão", () => {
    const html = renderToStaticMarkup(
      <BomCostDetailRow
        item={{
          description: "MP ok",
          requiredQty: 1,
          basePrice: 10,
          unitCost: 10,
        }}
      />
    );
    assert.ok(!html.includes("bg-red-500"));
    assert.ok(!html.includes("Não incluído no custo"));
  });
});
