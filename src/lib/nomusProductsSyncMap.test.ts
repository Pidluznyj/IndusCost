import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSku } from "./nomusBomComparison.js";
import {
  buildNomusProductFixture52022,
  findNomusProductRowsByCode,
  inferProductTypeWithConfidence,
  isNomusBomComponentScope,
  isNomusRawMaterialScope,
  mapNomusProductsFromApiRows,
  nomusProductSkuFromRow,
} from "./nomusProductsSyncMap.js";

describe("nomusProductsSyncMap", () => {
  const fixture = buildNomusProductFixture52022();

  it("1. produto com código 520.22-- é aceito", () => {
    const { eligible, blocked } = mapNomusProductsFromApiRows([fixture], new Set());
    assert.equal(blocked.length, 0);
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0]!.sku, "520.22--");
  });

  it("2. código com -- não é corrompido", () => {
    assert.equal(nomusProductSkuFromRow(fixture), "520.22--");
    assert.equal(normalizeSku("520.22--"), "520.22--");
    const mapped = mapNomusProductsFromApiRows([fixture], new Set());
    assert.equal(mapped.eligible[0]!.sku, "520.22--");
  });

  it("3. busca por 520.22-- encontra o item", () => {
    const found = findNomusProductRowsByCode([fixture], "520.22--");
    assert.equal(found.length, 1);
  });

  it("4. busca por 520.22 encontra com normalização de traços finais", () => {
    const found = findNomusProductRowsByCode([fixture], "520.22");
    assert.equal(found.length, 1);
  });

  it("5. busca por código secundário 3.14.117.0014 encontra o item", () => {
    const found = findNomusProductRowsByCode([fixture], "3.14.117.0014");
    assert.equal(found.length, 1);
  });

  it("6. produto industrializado comprado não é descartado", () => {
    const { eligible, blocked } = mapNomusProductsFromApiRows([fixture], new Set());
    assert.equal(blocked.length, 0);
    assert.equal(eligible[0]!.type, "COMPONENT");
    assert.equal(eligible[0]!.typeInferenceConfidence, "HIGH");
  });

  it("7. grupo BOM - Lista de materiais não é descartado", () => {
    const row = { ...fixture, nomeGrupoProduto: "BOM - Lista de materiais" };
    const { blocked } = mapNomusProductsFromApiRows([row], new Set());
    assert.equal(blocked.length, 0);
  });

  it("8. família 5 - Outros componentes não é descartada", () => {
    const row = { ...fixture, nomeFamiliaProduto: "5 - Outros componentes" };
    const { blocked } = mapNomusProductsFromApiRows([row], new Set());
    assert.equal(blocked.length, 0);
  });

  it("9. lista de materiais não confunde com matéria-prima", () => {
    assert.equal(
      isNomusRawMaterialScope("Produto industrializado", "BOM - Lista de materiais", "5 - Outros componentes"),
      false
    );
  });

  it("10. escopo BOM/componente comprado reconhecido", () => {
    assert.equal(
      isNomusBomComponentScope(
        "Produto industrializado",
        "BOM - Lista de materiais",
        "5 - Outros componentes",
        "Comprado"
      ),
      true
    );
    const inferred = inferProductTypeWithConfidence(fixture);
    assert.equal(inferred.type, "COMPONENT");
    assert.equal(inferred.confidence, "HIGH");
  });

  it("11. UNSAFE_PRODUCT_TYPE para industrializado comprado corrigido", () => {
    const { blocked } = mapNomusProductsFromApiRows([fixture], new Set());
    const unsafe = blocked.flatMap((b) => b.reasons).includes("UNSAFE_PRODUCT_TYPE");
    assert.equal(unsafe, false);
  });

  it("12. matéria-prima explícita continua bloqueada", () => {
    const row = {
      ...fixture,
      codigo: "MP-001",
      nomeTipoProduto: "Matéria-prima",
      nomeGrupoProduto: "Insumos",
    };
    const { blocked } = mapNomusProductsFromApiRows([row], new Set());
    assert.ok(blocked.some((b) => b.reasons.includes("RAW_MATERIAL_NOT_PRODUCT")));
  });

  it("13. paginação — find em lote grande preserva código com --", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      codigo: `999.${i}`,
    }));
    rows.push(fixture);
    const found = findNomusProductRowsByCode(rows, "520.22--");
    assert.equal(found.length, 1);
  });
});
