import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("projectsEngineeringTree", () => {
  it("importação recursiva existe em projectsProductEngineeringSnapshot", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "projectsProductEngineeringSnapshot.ts"),
      "utf8"
    );
    assert.match(src, /buildBomTreeProduct/);
    assert.match(src, /MAX_ENGINEERING_TREE_DEPTH/);
    assert.match(src, /Ciclo detectado/);
    assert.match(src, /parentLineId/);
  });
});
