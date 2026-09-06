import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PurchaseModuleHeaderActions } from "./PurchaseModuleHeaderActions";

describe("PurchaseModuleHeaderActions", () => {
  it("renderiza Indicadores ao lado de Solicitações IndusCost", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PurchaseModuleHeaderActions />
      </MemoryRouter>
    );
    assert.ok(html.includes('href="/purchases/indicators"'));
    assert.ok(html.includes("Indicadores"));
    assert.ok(html.includes("Solicitações IndusCost"));
    assert.ok(html.includes('data-testid="purchases-induscost-requests-menu"'));
    assert.equal(html.includes("/purchases/quotations"), false);
  });
});
