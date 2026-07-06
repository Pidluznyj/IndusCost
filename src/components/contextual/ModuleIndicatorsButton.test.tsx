import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ModuleIndicatorsButton } from "./ModuleIndicatorsButton";

describe("ModuleIndicatorsButton", () => {
  it("renderiza link Indicadores com destino correto", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ModuleIndicatorsButton to="/purchases/indicators" />
      </MemoryRouter>
    );
    assert.ok(html.includes('href="/purchases/indicators"'));
    assert.ok(html.includes("Indicadores"));
  });
});
