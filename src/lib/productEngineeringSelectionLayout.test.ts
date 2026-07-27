import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Engenharia > Produtos — layout com seleção", () => {
  it("toolbar empilha filtros e ações em coluna full-width (sem flex-row que estoura)", () => {
    const mod = read("src/components/ProductModule.tsx");
    const toolbarIdx = mod.indexOf('data-tour="products-toolbar"');
    assert.ok(toolbarIdx > 0);
    const toolbarWindow = mod.slice(Math.max(0, toolbarIdx - 180), toolbarIdx + 220);
    assert.match(toolbarWindow, /flex w-full min-w-0 flex-col gap-3/);
    assert.doesNotMatch(toolbarWindow, /lg:flex-row lg:items-end/);
  });

  it("ações em lote não usam translate-x (evita scroll horizontal ao selecionar)", () => {
    const mod = read("src/components/ProductModule.tsx");
    assert.match(mod, /data-testid="bulk-refresh-cost-snapshot"/);
    assert.match(mod, /data-testid="bulk-publish-production-cost"/);
    assert.doesNotMatch(mod, /initial=\{\{\s*opacity:\s*0,\s*x:\s*20\s*\}\}/);
  });

  it("root e tabela contêm overflow horizontal", () => {
    const mod = read("src/components/ProductModule.tsx");
    assert.match(mod, /data-tour="products-root"/);
    assert.match(mod, /min-w-0 max-w-full space-y-6/);
    assert.match(mod, /data-tour="products-table"/);
    assert.match(mod, /min-w-0 max-w-full overflow-x-auto/);
  });
});
