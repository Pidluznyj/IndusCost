import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInPortal } from "./renderInPortal.js";

describe("renderInPortal", () => {
  it("sem document (SSR/testes sem jsdom), devolve o node inline", () => {
    assert.equal(typeof document, "undefined");
    const node = React.createElement("div", { "data-testid": "x" }, "conteúdo");
    const result = renderInPortal(node);
    const html = renderToStaticMarkup(result as React.ReactElement);
    assert.ok(html.includes("conteúdo"));
    assert.ok(html.includes('data-testid="x"'));
  });
});
