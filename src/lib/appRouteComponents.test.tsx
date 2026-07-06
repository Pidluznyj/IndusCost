import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { SIDEBAR_MENU_ITEM_ICONS } from "../components/layout/Sidebar.tsx";
import { SIDEBAR_MODULE_ORDER } from "./modulePermissions.js";

function isRenderableReactComponentType(value: unknown): boolean {
  return typeof value === "function" || (typeof value === "object" && value != null);
}

describe("appRouteComponents — React #130 guard", () => {
  it("sidebar define ícone Lucide para cada AppModuleId", () => {
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      const Icon = SIDEBAR_MENU_ITEM_ICONS[moduleId];
      assert.ok(
        isRenderableReactComponentType(Icon),
        `missing sidebar icon for ${moduleId} (causes React minified error #130)`
      );
      const html = renderToStaticMarkup(React.createElement(Icon as React.ElementType, { "aria-hidden": true }));
      assert.match(html, /<svg/, `icon for ${moduleId} must render a valid SVG element`);
    }
  });

  it("operations-performance icon exists after module registration", () => {
    const Icon = SIDEBAR_MENU_ITEM_ICONS["operations-performance"];
    assert.ok(isRenderableReactComponentType(Icon));
  });
});
