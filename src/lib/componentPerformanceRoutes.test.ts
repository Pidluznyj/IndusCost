import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("componentPerformanceRoutes", () => {
  it("registra endpoints de operações/performance", () => {
    const routes = read("src/lib/componentPerformanceRoutes.ts");
    assert.match(routes, /GET \/api\/operations\/performance\/components/);
    assert.match(routes, /GET \/api\/operations\/performance\/components\/:id/);
    assert.match(routes, /PATCH \/api\/operations\/performance\/components\/:id/);
    assert.match(routes, /GET \/api\/operations\/performance\/components\/:id\/history/);
  });

  it("server registra registerComponentPerformanceRoutes", () => {
    assert.match(read("server.ts"), /registerComponentPerformanceRoutes/);
  });

  it("permissões catalogadas", () => {
    const catalog = read("src/lib/permissionCatalog.ts");
    assert.match(catalog, /operations\.component-performance\.view/);
    assert.match(catalog, /operations\.component-performance\.edit/);
  });
});
