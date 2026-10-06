import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMINISTRATIVE_STOCK_APPLY_CONFIRM,
  AdministrativeStockItemCodeTakenError,
  assertAdministrativeStockApplyRequest,
  executeAdministrativeStockApply,
  type AdministrativeStockApplyActor,
  type AdministrativeStockApplyTx,
  type AdministrativeStockNewItemData,
} from "./administrativeStockInitialLoadApply.ts";
import {
  ADMINISTRATIVE_STOCK_ITEM_TYPE,
  ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
  classifyAdministrativeStockPreview,
  mapAdministrativeStockCsvRecords,
  parseAdministrativeStockCsvText,
  type AdministrativeStockItemSnapshot,
  type AdministrativeStockWarehouseSnapshot,
} from "./administrativeStockInitialLoadPreview.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

const actor: AdministrativeStockApplyActor = {
  id: ACTOR_ID,
  role: "ADMIN",
  isActive: true,
};

type Memory = {
  warehouse: AdministrativeStockWarehouseSnapshot | null;
  items: AdministrativeStockItemSnapshot[];
  created: AdministrativeStockNewItemData[];
  warehouseCreates: number;
};

function memory(seed?: Partial<Memory>): Memory {
  return {
    warehouse: null,
    items: [],
    created: [],
    warehouseCreates: 0,
    ...seed,
  };
}

function ports(state: Memory): AdministrativeStockApplyTx {
  return {
    ensureWarehouse: async (data) => {
      if (state.warehouse) return { warehouse: state.warehouse, created: false };
      state.warehouseCreates += 1;
      state.warehouse = {
        id: "wh-new",
        code: data.code,
        name: data.name,
        status: data.status,
        allowsMovements: data.allowsMovements,
      };
      return { warehouse: state.warehouse, created: true };
    },
    findItemsByCodes: async (codes) => {
      const set = new Set(codes.map((code) => code.trim().toUpperCase()));
      return state.items.filter((item) => set.has(item.code.trim().toUpperCase()));
    },
    createItem: async (data) => {
      if (state.items.some((item) => item.code.trim().toUpperCase() === data.code.trim().toUpperCase())) {
        throw new AdministrativeStockItemCodeTakenError();
      }
      state.created.push(data);
      const id = `item-${state.created.length}`;
      state.items.push({
        id,
        code: data.code,
        description: data.description,
        itemType: data.itemType,
        unit: data.unit,
        status: data.status,
        controlsStock: data.controlsStock,
        defaultWarehouseId: data.defaultWarehouseId,
        defaultLocationId: data.defaultLocationId,
      });
      return { id };
    },
  };
}

function previewFromCsv(csv: string, items: AdministrativeStockItemSnapshot[], warehouse: AdministrativeStockWarehouseSnapshot | null) {
  const parsed = parseAdministrativeStockCsvText(csv);
  const mapped = mapAdministrativeStockCsvRecords(parsed.records);
  return classifyAdministrativeStockPreview({
    sourceRows: mapped.rows,
    invalidRows: mapped.invalid,
    items,
    warehouse,
    sha256: "sha",
    sourceFileName: "cadastro.csv",
  });
}

test("APPLY exige confirm e actorUserId UUID", () => {
  assert.throws(
    () =>
      assertAdministrativeStockApplyRequest({
        confirm: "NO",
        actorUserId: ACTOR_ID,
        filePath: "/tmp/cadastro_inicial_estoque_administrativo.csv",
      }),
    /ADMINISTRATIVE_STOCK_INITIAL_LOAD/
  );
  assert.throws(
    () =>
      assertAdministrativeStockApplyRequest({
        confirm: ADMINISTRATIVE_STOCK_APPLY_CONFIRM,
        actorUserId: "not-a-uuid",
        filePath: "/tmp/x.csv",
      }),
    /UUID/
  );
  assert.doesNotThrow(() =>
    assertAdministrativeStockApplyRequest({
      confirm: ADMINISTRATIVE_STOCK_APPLY_CONFIRM,
      actorUserId: ACTOR_ID,
      filePath: "/tmp/cadastro_inicial_estoque_administrativo.csv",
    })
  );
});

test("APPLY cria warehouse e item; MATCH é idempotente; não cria saldo", async () => {
  const csv =
    "codigo;descricao;categoria;subcategoria;unidade_estoque;estoque_minimo;estoque_maximo;ponto_reposicao;fornecedor_preferencial;custo_unitario_referencia;observacao\r\n" +
    "ADM-NEW;Novo;Papelaria;Canetas;UN;1;10;2;ACME;3,25;nota\r\n" +
    "ADM-OK;Existente;Papelaria;Canetas;UN;;;;;;\r\n";
  const existing: AdministrativeStockItemSnapshot = {
    id: "item-ok",
    code: "ADM-OK",
    description: "Existente",
    itemType: ADMINISTRATIVE_STOCK_ITEM_TYPE,
    unit: "UN",
    status: "ACTIVE",
    controlsStock: true,
    defaultWarehouseId: "wh-adm",
    defaultLocationId: null,
  };
  const preview = previewFromCsv(csv, [existing], null);
  assert.equal(preview.createCount, 1);
  assert.equal(preview.alreadyExistsMatchCount, 1);
  assert.equal(preview.conflictCount, 0);

  const state = memory({ items: [existing] });
  const result = await executeAdministrativeStockApply({
    preview,
    actor,
    tx: ports(state),
  });

  assert.equal(result.warehouseAction, "CREATED");
  assert.equal(state.warehouseCreates, 1);
  assert.equal(state.warehouse?.code, ADMINISTRATIVE_STOCK_WAREHOUSE_CODE);
  assert.equal(result.created, 1);
  assert.equal(result.alreadyExistsMatch, 1);
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0]?.itemType, ADMINISTRATIVE_STOCK_ITEM_TYPE);
  assert.equal(state.created[0]?.controlsStock, true);
  assert.equal(state.created[0]?.defaultWarehouseId, state.warehouse?.id);
  assert.equal(state.created[0]?.defaultLocationId, null);
  assert.equal(state.created[0]?.family, "Papelaria");
  assert.equal(state.created[0]?.lastKnownCost, 3.25);
  assert.equal(result.lines.some((line) => line.finalAction === "CREATED"), true);
  assert.equal(result.lines.some((line) => line.finalAction === "ALREADY_EXISTS_MATCH"), true);
});

test("APPLY aborta com CONFLICT (não sobrescreve)", async () => {
  const csv =
    "codigo;descricao;categoria;subcategoria;unidade_estoque;estoque_minimo;estoque_maximo;ponto_reposicao;fornecedor_preferencial;custo_unitario_referencia;observacao\r\n" +
    "ADM-BAD;Conflito;Cat;Sub;UN;;;;;;\r\n";
  const preview = previewFromCsv(
    csv,
    [
      {
        id: "bad",
        code: "ADM-BAD",
        description: "MP",
        itemType: "RAW_MATERIAL",
        unit: "KG",
        status: "ACTIVE",
        controlsStock: true,
        defaultWarehouseId: "wh-mp",
        defaultLocationId: null,
      },
    ],
    null
  );
  assert.equal(preview.conflictCount, 1);
  await assert.rejects(
    () =>
      executeAdministrativeStockApply({
        preview,
        actor,
        tx: ports(memory()),
      }),
    /erros impeditivos/
  );
});
