import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderDetailIndustrialResult MP via BOM Open Book", () => {
  it("server explode BOM Open Book em vez de snapshot publicado vazio", () => {
    const server = read("src/lib/sales-orders/salesOrderDetailIndustrialResult.server.ts");
    assert.match(server, /explodeProductRawMaterialsPerUnit/);
    assert.match(server, /scaleOpenBookExplosionRowForOrderItem/);
    assert.doesNotMatch(server, /readBomLinesFromSnapshot|snapshot publicado sem linhas/);
    assert.match(server, /openBookRawMaterialExplosion\.server/);
  });

  it("UI mostra Código, Descrição, Qtde, Valor por quilo, Valor total", () => {
    const ui = read("src/components/sales/SalesOrderDetailResultadoTab.tsx");
    assert.match(ui, />Código</);
    assert.match(ui, />Descrição</);
    assert.match(ui, />Qtde</);
    assert.match(ui, /Valor por quilo/);
    assert.match(ui, /Valor total/);
    assert.match(ui, /Inteligência de Matéria-Prima|explosão da BOM/i);
    assert.doesNotMatch(ui, /snapshot de custo publicado/);
  });

  it("helper de explosão reutiliza merge/add Open Book", () => {
    const explosion = read("src/lib/openBookRawMaterialExplosion.server.ts");
    assert.match(explosion, /mergeExplosionMaps/);
    assert.match(explosion, /addDirectMaterialRow/);
    assert.match(explosion, /createProductCostAnalysisEngine/);
    assert.match(explosion, /ProductBOM/);
  });
});
