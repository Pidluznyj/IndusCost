import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BomCostDetailRow, FABRICATED_BOM_COMPONENT_TOOLTIP } from "./BomCostDetailRow";

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

  it("componente fabricado exibe tooltip de conciliação", () => {
    const html = renderToStaticMarkup(
      <BomCostDetailRow
        item={{
          description: "Boia",
          requiredQty: 1,
          basePrice: 2.215878,
          unitCost: 2.215878,
          sku: "640.09AA",
        }}
        isFabricatedComponent
      />
    );
    assert.ok(html.includes("title="));
    assert.ok(html.includes(FABRICATED_BOM_COMPONENT_TOOLTIP.slice(0, 40)));
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
