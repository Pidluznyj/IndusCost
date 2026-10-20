/**
 * Almoxarifado padrão do item — política pura + resolvedor server + contrato
 * das rotas. Caso real: suprimento administrativo cadastrado pela ficha ficava
 * sem almoxarifado padrão e não entrava na conferência do tablet (setor
 * ADMINISTRATIVO). Nada aqui toca banco: o resolvedor recebe um dublê.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { InventoryValidationError } from "./inventoryTypes.js";
import { parseCreateInventoryItemBody, parseUpdateInventoryItemBody } from "./inventoryValidation.js";
import {
  DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR,
  DEFAULT_WAREHOUSE_MANAGED_BY_OFFICIAL_LINK,
  DEFAULT_WAREHOUSE_REQUIRED_FOR_SECTOR,
  applyItemDefaultWarehousePolicy,
  resolveItemDefaultWarehousePolicy,
  type StandardSectorWarehouseOption,
} from "./inventoryItemDefaultWarehousePolicy.js";
import {
  WAREHOUSE_MOVEMENTS_NOT_ALLOWED,
  resolveInventoryItemDefaultScope,
  type ItemDefaultWarehouseReadDb,
} from "./inventoryItemDefaultWarehouse.server.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const WH_ADM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WH_EPI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WH_OFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WH_NO_MOVE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const WH_MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LOC_ADM = "10000000-0000-4000-8000-000000000001";
const LOC_EPI = "10000000-0000-4000-8000-000000000002";
const LOC_OFF = "10000000-0000-4000-8000-000000000003";

const SECTOR_ADM: StandardSectorWarehouseOption = {
  sectorId: "5ec70000-0000-4000-8000-000000000001",
  sectorCode: "ADMINISTRATIVO",
  sectorName: "Administrativo",
  warehouseId: WH_ADM,
  warehouseCode: "ADMINISTRATIVO",
  warehouseName: "Estoque administrativo",
};
const SECTOR_EPI: StandardSectorWarehouseOption = {
  sectorId: "5ec70000-0000-4000-8000-000000000002",
  sectorCode: "EPI",
  sectorName: "EPI",
  warehouseId: WH_EPI,
  warehouseCode: "EPI",
  warehouseName: "Almoxarifado de EPI",
};
const SECTOR_ADM_2: StandardSectorWarehouseOption = {
  ...SECTOR_ADM,
  sectorId: "5ec70000-0000-4000-8000-000000000003",
  sectorCode: "ADM-FILIAL",
  warehouseId: WH_EPI,
  warehouseCode: "ADM-FILIAL",
};

/** Dublê: setores por tipo (o que existe configurado), almoxarifados e endereços. */
function fakeDb(sectorsByType: Record<string, StandardSectorWarehouseOption[]>): ItemDefaultWarehouseReadDb & {
  queries: string[];
} {
  const warehouses = [
    { id: WH_ADM, code: "ADMINISTRATIVO", status: "ACTIVE", allowsMovements: true },
    { id: WH_EPI, code: "EPI", status: "ACTIVE", allowsMovements: true },
    { id: WH_OFF, code: "DESATIVADO", status: "INACTIVE", allowsMovements: true },
    { id: WH_NO_MOVE, code: "SEM-MOV", status: "ACTIVE", allowsMovements: false },
  ];
  const locations = [
    { id: LOC_ADM, warehouseId: WH_ADM, status: "ACTIVE" },
    { id: LOC_EPI, warehouseId: WH_EPI, status: "ACTIVE" },
    { id: LOC_OFF, warehouseId: WH_ADM, status: "INACTIVE" },
  ];
  const queries: string[] = [];
  return {
    queries,
    inventoryStockSector: {
      findMany: async (args) => {
        queries.push("sector.findMany");
        assert.equal(args.where.status, "ACTIVE");
        assert.equal(args.where.strategy, "STANDARD");
        return (sectorsByType[args.where.itemType] ?? []).map((s) => ({
          id: s.sectorId,
          code: s.sectorCode,
          name: s.sectorName,
          warehouseId: s.warehouseId,
          warehouse: { code: s.warehouseCode, name: s.warehouseName },
        }));
      },
    },
    inventoryWarehouse: {
      findUnique: async (args) => {
        queries.push("warehouse.findUnique");
        return warehouses.find((w) => w.id === args.where.id) ?? null;
      },
    },
    inventoryLocation: {
      findUnique: async (args) => {
        queries.push("location.findUnique");
        return locations.find((l) => l.id === args.where.id) ?? null;
      },
    },
  };
}

const codeOf = (code: string) => (e: unknown) =>
  e instanceof InventoryValidationError && e.code === code;

/** Configuração de referência: um setor STANDARD para ADMINISTRATIVE_SUPPLY e um para PPE. */
const REFERENCE = { ADMINISTRATIVE_SUPPLY: [SECTOR_ADM], PPE: [SECTOR_EPI] };

describe("política de almoxarifado padrão (pura)", () => {
  it("1/2. suprimento administrativo: um setor STANDARD → almoxarifado fixo, preenchido quando omitido", () => {
    const policy = resolveItemDefaultWarehousePolicy("ADMINISTRATIVE_SUPPLY", [SECTOR_ADM]);
    assert.equal(policy.mode, "SECTOR_FIXED");
    assert.equal(policy.locked, true);
    assert.equal(policy.defaultWarehouseId, WH_ADM);
    assert.equal(applyItemDefaultWarehousePolicy(policy, null), WH_ADM);
    assert.equal(applyItemDefaultWarehousePolicy(policy, ""), WH_ADM);
    assert.equal(applyItemDefaultWarehousePolicy(policy, WH_ADM), WH_ADM);
  });

  it("almoxarifado diferente do setor é recusado (não deixa o item fora da conferência)", () => {
    const policy = resolveItemDefaultWarehousePolicy("ADMINISTRATIVE_SUPPLY", [SECTOR_ADM]);
    assert.throws(
      () => applyItemDefaultWarehousePolicy(policy, WH_EPI),
      codeOf(DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR)
    );
  });

  it("dois setores para o tipo: obrigatório escolher um dos almoxarifados", () => {
    const policy = resolveItemDefaultWarehousePolicy("ADMINISTRATIVE_SUPPLY", [SECTOR_ADM, SECTOR_ADM_2]);
    assert.equal(policy.mode, "SECTOR_CHOICE");
    assert.equal(policy.locked, false);
    assert.equal(policy.options.length, 2);
    assert.throws(() => applyItemDefaultWarehousePolicy(policy, null), codeOf(DEFAULT_WAREHOUSE_REQUIRED_FOR_SECTOR));
    assert.throws(() => applyItemDefaultWarehousePolicy(policy, WH_OFF), codeOf(DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR));
    assert.equal(applyItemDefaultWarehousePolicy(policy, WH_EPI), WH_EPI);
  });

  it("dois setores no MESMO almoxarifado contam como uma opção (fixo)", () => {
    const policy = resolveItemDefaultWarehousePolicy("ADMINISTRATIVE_SUPPLY", [
      SECTOR_ADM,
      { ...SECTOR_ADM, sectorId: "5ec70000-0000-4000-8000-000000000009", sectorCode: "ADM-B" },
    ]);
    assert.equal(policy.mode, "SECTOR_FIXED");
    assert.equal(policy.defaultWarehouseId, WH_ADM);
  });

  it("17. EPI: usa o setor de EPI, nunca o ADMINISTRATIVO; sem setor fica livre e opcional", () => {
    const withSector = resolveItemDefaultWarehousePolicy("PPE", [SECTOR_EPI]);
    assert.equal(withSector.defaultWarehouseId, WH_EPI);
    const free = resolveItemDefaultWarehousePolicy("PPE", []);
    assert.equal(free.mode, "FREE");
    assert.equal(free.locked, false);
    assert.equal(applyItemDefaultWarehousePolicy(free, null), null);
    assert.equal(applyItemDefaultWarehousePolicy(free, WH_EPI), WH_EPI);
  });

  it("14. matéria-prima: escopo é do vínculo oficial — nunca automático, nunca por esta ficha", () => {
    const policy = resolveItemDefaultWarehousePolicy("RAW_MATERIAL", [SECTOR_ADM]);
    assert.equal(policy.mode, "OFFICIAL_LINK");
    assert.equal(policy.editable, false);
    assert.equal(applyItemDefaultWarehousePolicy(policy, null), null);
    assert.throws(() => applyItemDefaultWarehousePolicy(policy, WH_ADM), codeOf(DEFAULT_WAREHOUSE_MANAGED_BY_OFFICIAL_LINK));
  });

  it("15/16. componente e produto acabado: por presença — opcional, livre, sem preenchimento", () => {
    for (const type of ["COMPONENT", "FINISHED_PRODUCT"] as const) {
      const policy = resolveItemDefaultWarehousePolicy(type, [SECTOR_ADM]);
      assert.equal(policy.mode, "PRESENCE");
      assert.equal(policy.defaultWarehouseId, null);
      assert.equal(applyItemDefaultWarehousePolicy(policy, null), null);
      assert.equal(applyItemDefaultWarehousePolicy(policy, WH_EPI), WH_EPI);
    }
  });

  it("nada é fixo no código: sem setor configurado, nenhum tipo recebe almoxarifado automático", () => {
    for (const type of ["ADMINISTRATIVE_SUPPLY", "PPE", "MAINTENANCE", "TOOLING", "PACKAGING", "OTHER"] as const) {
      assert.equal(resolveItemDefaultWarehousePolicy(type, []).defaultWarehouseId, null);
    }
    const src = read("src/lib/inventory/inventoryItemDefaultWarehousePolicy.ts");
    assert.doesNotMatch(src, /"ADMINISTRATIVO"/);
  });
});

describe("resolvedor server do escopo padrão", () => {
  const base = { controlsStock: true, defaultLocationId: null };

  it("2. cadastro admin sem almoxarifado → ADMINISTRATIVO (automático, auditável)", async () => {
    const db = fakeDb(REFERENCE);
    const scope = await resolveInventoryItemDefaultScope(db, {
      ...base,
      itemType: "ADMINISTRATIVE_SUPPLY",
      defaultWarehouseId: null,
    });
    assert.equal(scope.defaultWarehouseId, WH_ADM);
    assert.equal(scope.defaultLocationId, null);
    assert.equal(scope.autoAssigned, true);
    assert.equal(scope.policy.mode, "SECTOR_FIXED");
    assert.deepEqual(db.queries, ["sector.findMany", "warehouse.findUnique"]);
  });

  it("3. almoxarifado inexistente é recusado", async () => {
    const db = fakeDb({});
    await assert.rejects(
      resolveInventoryItemDefaultScope(db, { ...base, itemType: "TOOLING", defaultWarehouseId: WH_MISSING }),
      codeOf("WAREHOUSE_NOT_FOUND")
    );
  });

  it("4. almoxarifado inativo e almoxarifado sem movimentações são recusados", async () => {
    const db = fakeDb({});
    await assert.rejects(
      resolveInventoryItemDefaultScope(db, { ...base, itemType: "TOOLING", defaultWarehouseId: WH_OFF }),
      codeOf("WAREHOUSE_INACTIVE")
    );
    await assert.rejects(
      resolveInventoryItemDefaultScope(db, { ...base, itemType: "TOOLING", defaultWarehouseId: WH_NO_MOVE }),
      codeOf(WAREHOUSE_MOVEMENTS_NOT_ALLOWED)
    );
    // Item que NÃO controla estoque pode apontar para almoxarifado sem movimentações.
    const noStock = await resolveInventoryItemDefaultScope(db, {
      itemType: "TOOLING",
      controlsStock: false,
      defaultWarehouseId: WH_NO_MOVE,
      defaultLocationId: null,
    });
    assert.equal(noStock.defaultWarehouseId, WH_NO_MOVE);
  });

  it("5. endereço de outro almoxarifado, endereço inativo e endereço inexistente são recusados", async () => {
    const db = fakeDb(REFERENCE);
    await assert.rejects(
      resolveInventoryItemDefaultScope(db, {
        ...base,
        itemType: "ADMINISTRATIVE_SUPPLY",
        defaultWarehouseId: WH_ADM,
        defaultLocationId: LOC_EPI,
      }),
      codeOf("DEFAULT_LOCATION_WAREHOUSE_MISMATCH")
    );
    await assert.rejects(
      resolveInventoryItemDefaultScope(db, {
        ...base,
        itemType: "ADMINISTRATIVE_SUPPLY",
        defaultWarehouseId: WH_ADM,
        defaultLocationId: LOC_OFF,
      }),
      codeOf("LOCATION_INACTIVE")
    );
    await assert.rejects(
      resolveInventoryItemDefaultScope(db, {
        ...base,
        itemType: "ADMINISTRATIVE_SUPPLY",
        defaultWarehouseId: WH_ADM,
        defaultLocationId: WH_MISSING,
      }),
      codeOf("LOCATION_NOT_FOUND")
    );
    const ok = await resolveInventoryItemDefaultScope(db, {
      ...base,
      itemType: "ADMINISTRATIVE_SUPPLY",
      defaultWarehouseId: WH_ADM,
      defaultLocationId: LOC_ADM,
    });
    assert.deepEqual([ok.defaultWarehouseId, ok.defaultLocationId], [WH_ADM, LOC_ADM]);
  });

  it("endereço sem almoxarifado: o almoxarifado é inferido do endereço e a política ainda vale", async () => {
    const db = fakeDb(REFERENCE);
    const ok = await resolveInventoryItemDefaultScope(db, {
      ...base,
      itemType: "ADMINISTRATIVE_SUPPLY",
      defaultWarehouseId: null,
      defaultLocationId: LOC_ADM,
    });
    assert.equal(ok.defaultWarehouseId, WH_ADM);
    assert.equal(ok.autoAssigned, false);
    // Endereço do almoxarifado de EPI num suprimento administrativo: incompatível com o setor.
    await assert.rejects(
      resolveInventoryItemDefaultScope(db, {
        ...base,
        itemType: "ADMINISTRATIVE_SUPPLY",
        defaultWarehouseId: null,
        defaultLocationId: LOC_EPI,
      }),
      codeOf(DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR)
    );
  });

  it("14-17. sem regressão: MP, componente, produto acabado e EPI mantêm as suas regras", async () => {
    const db = fakeDb(REFERENCE);
    const mp = await resolveInventoryItemDefaultScope(db, { ...base, itemType: "RAW_MATERIAL", defaultWarehouseId: null });
    assert.equal(mp.defaultWarehouseId, null);
    for (const type of ["COMPONENT", "FINISHED_PRODUCT"] as const) {
      const none = await resolveInventoryItemDefaultScope(db, { ...base, itemType: type, defaultWarehouseId: null });
      assert.equal(none.defaultWarehouseId, null);
      const explicit = await resolveInventoryItemDefaultScope(db, { ...base, itemType: type, defaultWarehouseId: WH_EPI });
      assert.equal(explicit.defaultWarehouseId, WH_EPI);
    }
    const epi = await resolveInventoryItemDefaultScope(db, { ...base, itemType: "PPE", defaultWarehouseId: null });
    assert.equal(epi.defaultWarehouseId, WH_EPI, "EPI vai para o setor de EPI, não para o ADMINISTRATIVO");
    await assert.rejects(
      resolveInventoryItemDefaultScope(db, { ...base, itemType: "PPE", defaultWarehouseId: WH_ADM }),
      codeOf(DEFAULT_WAREHOUSE_INCOMPATIBLE_WITH_SECTOR)
    );
  });
});

describe("contrato de validação do cadastro", () => {
  const body = {
    code: "ADM-INF-037",
    description: "Pilha A23 12V",
    itemType: "ADMINISTRATIVE_SUPPLY",
    unit: "UN",
  };

  it("aceita defaultWarehouseId/defaultLocationId (UUID) e normaliza vazio para null", () => {
    const empty = parseCreateInventoryItemBody(body);
    assert.equal(empty.defaultWarehouseId, null);
    assert.equal(empty.defaultLocationId, null);
    const filled = parseCreateInventoryItemBody({ ...body, defaultWarehouseId: WH_ADM, defaultLocationId: LOC_ADM });
    assert.equal(filled.defaultWarehouseId, WH_ADM);
    assert.equal(filled.defaultLocationId, LOC_ADM);
    assert.throws(() => parseCreateInventoryItemBody({ ...body, defaultWarehouseId: "ADMINISTRATIVO" }), codeOf("INVALID_ID"));
  });

  it("PUT: campo ausente não mexe; vazio limpa (sujeito à política no server)", () => {
    assert.equal("defaultWarehouseId" in parseUpdateInventoryItemBody({ description: "x" }), false);
    assert.equal(parseUpdateInventoryItemBody({ defaultWarehouseId: "" }).defaultWarehouseId, null);
    assert.equal(parseUpdateInventoryItemBody({ defaultLocationId: LOC_ADM }).defaultLocationId, LOC_ADM);
  });

  it("18. Nomus/MP preservados: MP órfã continua recusada; código Nomus continua passando intacto", () => {
    assert.throws(
      () => parseCreateInventoryItemBody({ ...body, itemType: "RAW_MATERIAL" }),
      codeOf("RAW_MATERIAL_REQUIRES_OFFICIAL_LINK")
    );
    assert.equal(parseCreateInventoryItemBody({ ...body, nomusProductCode: " 123 " }).nomusProductCode, "123");
  });
});

describe("rotas do cadastro (fonte)", () => {
  const routes = () => read("src/lib/inventoryRoutes.ts");

  it("19. política exposta só a quem gerencia itens; POST/PUT passam pelo resolvedor", () => {
    const src = routes();
    const idx = src.indexOf('app.get("/api/inventory/items/default-warehouse-policy"');
    assert.ok(idx > 0);
    assert.match(src.slice(idx, idx + 120), /\.\.\.itemManage/);
    assert.ok(idx < src.indexOf('app.get("/api/inventory/items/:id"'), "antes da rota :id");
    const post = src.indexOf('app.post("/api/inventory/items"');
    const postBlock = src.slice(post, src.indexOf("app.get(\"/api/inventory/official-materials\""));
    assert.match(postBlock, /resolveInventoryItemDefaultScope\(/);
    assert.match(postBlock, /defaultWarehouseId: scope\.defaultWarehouseId/);
    assert.match(postBlock, /defaultLocationId: scope\.defaultLocationId/);
    const put = src.indexOf('app.put("/api/inventory/items/:id"');
    const putBlock = src.slice(put, src.indexOf('app.patch("/api/inventory/items/:id/status"'));
    assert.match(putBlock, /resolveInventoryItemDefaultScope\(/);
    assert.match(putBlock, /DEFAULT_WAREHOUSE_MANAGED_BY_OFFICIAL_LINK/, "item com MP oficial: escopo só pelo vínculo");
  });

  it("20. auditoria: CREATE registra quando o almoxarifado veio da política", () => {
    const src = routes();
    const post = src.indexOf('app.post("/api/inventory/items"');
    const postBlock = src.slice(post, post + 4000);
    assert.match(postBlock, /action: "CREATE"/);
    assert.match(postBlock, /scope\.autoAssigned/);
  });

  it("o resolvedor nunca grava saldo, movimento ou linha de conferência", () => {
    const src = read("src/lib/inventory/inventoryItemDefaultWarehouse.server.ts");
    assert.doesNotMatch(src, /inventoryBalance|inventoryMovement|inventoryCountLine|inventoryCountSession/);
    assert.doesNotMatch(src, /\.(create|update|updateMany|upsert|delete)\(/);
  });
});
