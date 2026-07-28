import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("BOM line layout — item legível", () => {
  it("prioriza largura do item e reduz perda/observações (só layout)", () => {
    const mod = read("src/components/ProductModule.tsx");
    assert.match(mod, /data-testid="bom-line-row"/);
    assert.match(mod, /data-testid="bom-line-item"/);
    assert.match(mod, /col-span-6 min-w-0 space-y-1\.5" data-testid="bom-line-item"/);
    assert.match(mod, /col-span-1 space-y-1\.5" data-testid="bom-line-loss"/);
    assert.match(mod, /col-span-2 min-w-0 space-y-1\.5" data-testid="bom-line-notes"/);
    assert.match(mod, /Item \(matéria-prima, produto ou componente\)/);
    assert.match(mod, /updateBOMItem\(idx, "lossPercentage"/);
    assert.match(mod, /updateBOMItem\(idx, "notes"/);
    assert.match(mod, /setBomLineMaterialOrChild\(idx, val\)/);
    assert.doesNotMatch(
      mod,
      /col-span-4 space-y-1\.5">\s*<label[^>]*>\s*Item \(matéria-prima/
    );
  });
});
