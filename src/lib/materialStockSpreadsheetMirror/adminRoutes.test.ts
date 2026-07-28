import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE } from "./adminRoutes.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("materialStockSpreadsheetMirror adminRoutes", () => {
  it("expõe API admin com permissões dedicadas (não operador)", () => {
    const src = readFileSync(join(here, "adminRoutes.ts"), "utf8");
    assert.equal(
      MATERIAL_STOCK_SPREADSHEET_MIRROR_ADMIN_BASE,
      "/api/admin/material-stock-spreadsheet-mirror"
    );
    assert.match(src, /settings\.material_stock_mirror\.view/);
    assert.match(src, /settings\.material_stock_mirror\.manage/);
    assert.match(src, /outbox\/:id\/retry/);
    assert.doesNotMatch(src, /stock-tablet\/conference/);
  });

  it("UI admin não está na workspace operacional de conferência", () => {
    const workspace = readFileSync(
      join(here, "../../components/materials/MaterialStockConferenceWorkspace.tsx"),
      "utf8"
    );
    assert.doesNotMatch(
      workspace,
      /material-stock-spreadsheet-mirror|MaterialStockSpreadsheetMirrorAdminCard/
    );
  });
});
