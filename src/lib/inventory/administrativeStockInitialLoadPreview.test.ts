import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMINISTRATIVE_STOCK_ITEM_TYPE,
  ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
  classifyAdministrativeStockPreview,
  mapAdministrativeStockCsvRecords,
  parseAdministrativeStockCsvText,
  type AdministrativeStockItemSnapshot,
  type AdministrativeStockWarehouseSnapshot,
} from "./administrativeStockInitialLoadPreview.ts";

const warehouse: AdministrativeStockWarehouseSnapshot = {
  id: "wh-adm",
  code: ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
  name: "Estoque Administrativo",
  status: "ACTIVE",
  allowsMovements: true,
};

function item(overrides: Partial<AdministrativeStockItemSnapshot> = {}): AdministrativeStockItemSnapshot {
  return {
    id: "item-1",
    code: "ADM-001",
    description: "Caneta",
    itemType: ADMINISTRATIVE_STOCK_ITEM_TYPE,
    unit: "UN",
    status: "ACTIVE",
    controlsStock: true,
    defaultWarehouseId: warehouse.id,
    defaultLocationId: null,
    ...overrides,
  };
}

test("CSV UTF-8 BOM com ; mapeia colunas oficiais e ignora extras", () => {
  const csv =
    "\uFEFFcodigo;descricao;categoria;subcategoria;unidade_estoque;estoque_minimo;estoque_maximo;ponto_reposicao;fornecedor_preferencial;custo_unitario_referencia;observacao;gtin_ean;ncm;marca_preferencial;unidade_compra;fator_conversao_compra;permite_retirada\r\n" +
    "ADM-001;Caneta azul;Escritorio;Canetas;UN;10;100;20;Fornecedor X;1,50;Uso geral;789;4901;BIC;CX;12;sim\r\n";
  const parsed = parseAdministrativeStockCsvText(csv);
  const mapped = mapAdministrativeStockCsvRecords(parsed.records);
  assert.equal(mapped.invalid.length, 0);
  assert.equal(mapped.rows.length, 1);
  assert.equal(mapped.rows[0]?.code, "ADM-001");
  assert.equal(mapped.rows[0]?.description, "Caneta azul");
  assert.equal(mapped.rows[0]?.family, "Escritorio");
  assert.equal(mapped.rows[0]?.group, "Canetas");
  assert.equal(mapped.rows[0]?.unit, "UN");
  assert.equal(mapped.rows[0]?.minimumStock, 10);
  assert.equal(mapped.rows[0]?.maximumStock, 100);
  assert.equal(mapped.rows[0]?.reorderPoint, 20);
  assert.equal(mapped.rows[0]?.preferredSupplierName, "Fornecedor X");
  assert.equal(mapped.rows[0]?.lastKnownCost, 1.5);
  assert.equal(mapped.rows[0]?.notes, "Uso geral");
  assert.equal(mapped.rows[0]?.status, "ACTIVE");
  assert.equal(mapped.rows[0]?.raw.gtin_ean, "789");
});

test("status inativo no CSV vira INACTIVE", () => {
  const csv =
    "codigo;descricao;categoria;subcategoria;unidade_estoque;estoque_minimo;estoque_maximo;ponto_reposicao;fornecedor_preferencial;custo_unitario_referencia;observacao;status\r\n" +
    "ADM-002;Item parado;Cat;Sub;UN;;;;;;;inativo\r\n";
  const parsed = parseAdministrativeStockCsvText(csv);
  const mapped = mapAdministrativeStockCsvRecords(parsed.records);
  assert.equal(mapped.rows[0]?.status, "INACTIVE");
});

test("classifica CREATE, MATCH e CONFLICT sem inventar saldo", () => {
  const csv =
    "codigo;descricao;categoria;subcategoria;unidade_estoque;estoque_minimo;estoque_maximo;ponto_reposicao;fornecedor_preferencial;custo_unitario_referencia;observacao\r\n" +
    "ADM-NEW;Novo;Cat;Sub;UN;;;;;;\r\n" +
    "ADM-OK;Existente;Cat;Sub;UN;;;;;;\r\n" +
    "ADM-BAD;Conflito;Cat;Sub;KG;;;;;;\r\n";
  const parsed = parseAdministrativeStockCsvText(csv);
  const mapped = mapAdministrativeStockCsvRecords(parsed.records);
  const preview = classifyAdministrativeStockPreview({
    sourceRows: mapped.rows,
    invalidRows: mapped.invalid,
    items: [
      item({ id: "ok", code: "ADM-OK", unit: "UN" }),
      item({
        id: "bad",
        code: "ADM-BAD",
        itemType: "RAW_MATERIAL",
        unit: "KG",
        defaultWarehouseId: "wh-mp",
      }),
    ],
    warehouse: null,
    sha256: "abc",
    sourceFileName: "cadastro_inicial_estoque_administrativo.csv",
  });
  assert.equal(preview.warehouse, "WILL_CREATE");
  assert.equal(preview.createCount, 1);
  assert.equal(preview.alreadyExistsMatchCount, 1);
  assert.equal(preview.conflictCount, 1);
  assert.ok(preview.blockingErrors.length > 0);
  assert.equal(preview.rows.find((row) => row.code === "ADM-NEW")?.classification, "CREATE");
  assert.equal(preview.rows.find((row) => row.code === "ADM-OK")?.classification, "ALREADY_EXISTS_MATCH");
  assert.equal(preview.rows.find((row) => row.code === "ADM-BAD")?.classification, "CONFLICT");
});

test("linha sem codigo/unidade vira INVALID", () => {
  const csv =
    "codigo;descricao;categoria;subcategoria;unidade_estoque;estoque_minimo;estoque_maximo;ponto_reposicao;fornecedor_preferencial;custo_unitario_referencia;observacao\r\n" +
    ";Sem codigo;Cat;Sub;;;;;;;\r\n";
  const parsed = parseAdministrativeStockCsvText(csv);
  const mapped = mapAdministrativeStockCsvRecords(parsed.records);
  assert.equal(mapped.rows.length, 0);
  assert.equal(mapped.invalid.length, 1);
  assert.equal(mapped.invalid[0]?.classification, "INVALID");
});
