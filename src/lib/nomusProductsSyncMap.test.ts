import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSku } from "./nomusBomComparison.js";
import {
  buildNomusProductFixture52022,
  extractNomusNcm,
  findNomusProductRowsByCode,
  inferOperationalTypeFromSku,
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

  it("14. NCM do payload chega em ncmFromNomus como texto", () => {
    const row = { ...fixture, ncm: "39269090" };
    const { eligible } = mapNomusProductsFromApiRows([row], new Set());
    assert.strictEqual(eligible[0]!.ncmFromNomus, "39269090");
  });

  it("15. NCM com zero à esquerda é preservado — nunca parseInt/Number", () => {
    assert.strictEqual(extractNomusNcm({ ncm: "01234567" }), "01234567");
    const row = { ...fixture, ncm: "01234567" };
    const { eligible } = mapNomusProductsFromApiRows([row], new Set());
    assert.strictEqual(eligible[0]!.ncmFromNomus, "01234567");
  });

  it("16. NCM ausente/vazio/whitespace → null (não inventa NCM)", () => {
    assert.strictEqual(extractNomusNcm({}), null);
    assert.strictEqual(extractNomusNcm({ ncm: null }), null);
    assert.strictEqual(extractNomusNcm({ ncm: "" }), null);
    assert.strictEqual(extractNomusNcm({ ncm: "   " }), null);
    const { eligible } = mapNomusProductsFromApiRows([fixture], new Set());
    assert.strictEqual(eligible[0]!.ncmFromNomus, null);
  });

  it("17. NCM com espaços nas bordas é trim()ado, conteúdo intacto", () => {
    assert.strictEqual(extractNomusNcm({ ncm: " 39269090 " }), "39269090");
  });
});

function nomusCatalogRow(
  sku: string,
  nomeTipoProduto: string,
  nomeGrupoProduto: string,
  nomeFamiliaProduto: string
) {
  return {
    id: 1,
    codigo: sku,
    nome: `Descrição comercial ${sku}`,
    descricao: `Descrição comercial ${sku}`,
    nomeTipoProduto,
    nomeGrupoProduto,
    nomeFamiliaProduto,
    nomeTipoRessuprimento: "Fabricado",
    ativo: true,
    template: false,
  };
}

describe("família operacional IndusCost na classificação de Product novo", () => {
  it("622.03AA acabado com lista de materiais → PRODUCT HIGH", () => {
    const inferred = inferProductTypeWithConfidence(
      nomusCatalogRow("622.03AA", "Produto acabado", "Lista de materiais", "Produto acabado")
    );
    assert.equal(inferred.type, "PRODUCT");
    assert.equal(inferred.confidence, "HIGH");
    assert.equal(inferred.reason, "INDUSCOST_OPERATIONAL_FAMILY_6XX");
  });

  it("611.80AA acabado com lista de materiais → PRODUCT HIGH", () => {
    const inferred = inferProductTypeWithConfidence(
      nomusCatalogRow("611.80AA", "Produto acabado", "Lista de materiais", "Produto acabado")
    );
    assert.equal(inferred.type, "PRODUCT");
    assert.equal(inferred.confidence, "HIGH");
    assert.equal(inferred.reason, "INDUSCOST_OPERATIONAL_FAMILY_6XX");
  });

  it("301.37AA acabado, lista de materiais e peça injetada → COMPONENT HIGH", () => {
    const inferred = inferProductTypeWithConfidence(
      nomusCatalogRow("301.37AA", "Produto acabado", "Lista de materiais", "Peça injetada")
    );
    assert.equal(inferred.type, "COMPONENT");
    assert.equal(inferred.confidence, "HIGH");
    assert.equal(inferred.reason, "INDUSCOST_OPERATIONAL_FAMILY_3XX");
  });

  it("301.28AA acabado com lista de materiais → COMPONENT HIGH", () => {
    const inferred = inferProductTypeWithConfidence(
      nomusCatalogRow("301.28AA", "Produto acabado", "Lista de materiais", "Produto acabado")
    );
    assert.equal(inferred.type, "COMPONENT");
    assert.equal(inferred.confidence, "HIGH");
    assert.equal(inferred.reason, "INDUSCOST_OPERATIONAL_FAMILY_3XX");
  });

  it("315.14AA acabado com lista de materiais → COMPONENT HIGH", () => {
    const inferred = inferProductTypeWithConfidence(
      nomusCatalogRow("315.14AA", "Produto acabado", "Lista de materiais", "Produto acabado")
    );
    assert.equal(inferred.type, "COMPONENT");
    assert.equal(inferred.confidence, "HIGH");
    assert.equal(inferred.reason, "INDUSCOST_OPERATIONAL_FAMILY_3XX");
  });

  it("651.23AA semi-acabado Nomus continua PRODUCT HIGH pela família 6xx", () => {
    const inferred = inferProductTypeWithConfidence(
      nomusCatalogRow("651.23AA", "Produto semi-acabado", "Lista de materiais", "Produto acabado")
    );
    assert.equal(inferred.type, "PRODUCT");
    assert.equal(inferred.confidence, "HIGH");
    assert.equal(inferred.reason, "INDUSCOST_OPERATIONAL_FAMILY_6XX");
  });

  it("grupo Lista de materiais sozinho não classifica COMPONENT", () => {
    const row = nomusCatalogRow("160.08--", "", "Lista de materiais", "");
    const inferred = inferProductTypeWithConfidence(row);
    assert.equal(inferred.confidence, "LOW");
    assert.equal(inferred.reason, "LOW_CONFIDENCE");
    assert.notEqual(inferred.type, "COMPONENT");
    assert.equal(
      isNomusBomComponentScope("", "BOM - Lista de materiais", "", null),
      false
    );
    const mapped = mapNomusProductsFromApiRows([row], new Set());
    assert.equal(mapped.eligible.length, 0);
    assert.ok(
      mapped.blocked.some((b) => b.reasons.includes("UNSAFE_PRODUCT_TYPE"))
    );
  });

  it("010.19AA fica fora da família operacional e segue a regra semântica", () => {
    assert.equal(inferOperationalTypeFromSku("010.19AA").type, null);
    const inferred = inferProductTypeWithConfidence(
      nomusCatalogRow("010.19AA", "Produto acabado", "Lista de materiais", "Produto acabado")
    );
    assert.equal(inferred.type, "PRODUCT");
    assert.equal(inferred.confidence, "HIGH");
    assert.equal(inferred.reason, "NOMUS_FINISHED_PRODUCT");
  });
});
