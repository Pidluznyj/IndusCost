/**
 * Cadastro administrativo de setores de estoque (InventoryStockSector):
 * almoxarifado existente × almoxarifado novo na mesma transação, centro de
 * custo padrão, proteção do legado, prévia de população, QR e rotas.
 *
 * O service roda de verdade sobre um Prisma em memória com rollback de
 * transação; a prévia usa o mesmo predicado da contagem e da retirada.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { InventoryValidationError } from "./inventoryTypes.js";
import { createCollectorCountFakeDb, type FakeItemSeed } from "./collector/collectorCountFakeDb.js";
import {
  buildSectorCollectorAbsoluteUrlForSlug,
  COLLECTOR_PUBLIC_BASE_URL_ENV,
  COLLECTOR_PUBLIC_BASE_URL_REQUIRED,
} from "./collector/collectorSectorContract.js";
import {
  INVENTORY_STOCK_SECTOR_STANDARD_ITEM_TYPES,
  STOCK_SECTOR_CODE_DUPLICATE,
  STOCK_SECTOR_COST_CENTER_INVALID,
  STOCK_SECTOR_COST_CENTER_REQUIRED,
  STOCK_SECTOR_HAS_ACTIVE_SESSION,
  STOCK_SECTOR_LEGACY_RESERVED,
  stockSectorRequiresCostCenter,
} from "./inventoryStockSectorDomain.js";
import {
  countInventoryStockSectorEligibleItems,
  createInventoryStockSector,
  createInventoryStockSectorWithWarehouse,
  loadInventoryStockSectorFormOptions,
  serializeInventoryStockSector,
  setInventoryStockSectorStatus,
  updateInventoryStockSector,
} from "./inventoryStockSectorService.server.js";
import {
  hasNewWarehouseInStockSectorBody,
  parseCreateInventoryStockSectorBody,
  parseCreateInventoryStockSectorWithWarehouseBody,
  parseUpdateInventoryStockSectorBody,
} from "./inventoryStockSectorValidation.js";
import { INVENTORY_WAREHOUSE_CODE_DUPLICATE } from "./inventoryWarehouseWrite.server.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

type Row = Record<string, any>;

const WH_ADM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WH_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WH_OFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CC_ADM = "cc000000-0000-4000-8000-000000000001";
const CC_OFF = "cc000000-0000-4000-8000-000000000002";

function p2002(target: string[]) {
  return Object.assign(new Error("unique"), { code: "P2002", meta: { target } });
}

/** Prisma em memória: setores, almoxarifados, centros de custo, auditoria. */
function createAdminFakeDb(seed: { countingSessionCodes?: string[] } = {}) {
  let seq = 0;
  const nextId = () =>
    `${(seq += 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  const state = {
    warehouses: [
      { id: WH_ADM, code: "ADMINISTRATIVO", name: "Administrativo", status: "ACTIVE", allowsMovements: true },
      { id: WH_OTHER, code: "ALM-B", name: "ALM-B", status: "ACTIVE", allowsMovements: true },
      { id: WH_OFF, code: "ALM-OFF", name: "ALM-OFF", status: "INACTIVE", allowsMovements: true },
    ] as Row[],
    costCenters: [
      { id: CC_ADM, code: "ADM", name: "Administrativo", isActive: true },
      { id: CC_OFF, code: "OLD", name: "Antigo", isActive: false },
    ] as Row[],
    sectors: [] as Row[],
    auditLogs: [] as Row[],
    sessions: (seed.countingSessionCodes ?? []).map((code) => ({
      id: nextId(),
      code,
      warehouseId: WH_ADM,
      status: "COUNTING",
    })) as Row[],
  };

  const joinSector = (row: Row) => ({
    ...row,
    warehouse: state.warehouses.find((w) => w.id === row.warehouseId),
    defaultCostCenter: state.costCenters.find((c) => c.id === row.defaultCostCenterId) ?? null,
  });
  const assertSectorUniques = (data: Row, excludingId?: string) => {
    const others = state.sectors.filter((s) => s.id !== excludingId);
    for (const field of ["code", "slug", "sessionCodePrefix"]) {
      if (others.some((s) => s[field] === data[field])) throw p2002([field]);
    }
    if (
      data.status === "ACTIVE" &&
      others.some(
        (s) =>
          s.status === "ACTIVE" &&
          s.itemType === data.itemType &&
          s.warehouseId === data.warehouseId
      )
    ) {
      throw p2002(["itemType", "warehouseId"]);
    }
  };

  const tx: Row = {
    inventoryWarehouse: {
      findUnique: async ({ where }: Row) => state.warehouses.find((w) => w.id === where.id) ?? null,
      findMany: async ({ where }: Row = {}) =>
        state.warehouses
          .filter((w) => !where?.status || w.status === where.status)
          .sort((a, b) => a.code.localeCompare(b.code)),
      create: async ({ data }: Row) => {
        if (state.warehouses.some((w) => w.code === data.code)) throw p2002FromPrisma();
        const row = { id: nextId(), description: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.warehouses.push(row);
        return row;
      },
    },
    costCenter: {
      findUnique: async ({ where }: Row) => state.costCenters.find((c) => c.id === where.id) ?? null,
      findMany: async ({ where }: Row = {}) =>
        state.costCenters.filter((c) => where?.isActive === undefined || c.isActive === where.isActive),
    },
    inventoryCountSession: {
      count: async ({ where }: Row) =>
        state.sessions.filter(
          (s) =>
            s.warehouseId === where.warehouseId &&
            s.status === where.status &&
            s.code.startsWith(where.code.startsWith)
        ).length,
    },
    inventoryStockSector: {
      findUnique: async ({ where }: Row) => {
        const row = state.sectors.find((s) => s.id === where.id);
        return row ? joinSector(row) : null;
      },
      create: async ({ data }: Row) => {
        assertSectorUniques(data);
        const row = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...data };
        state.sectors.push(row);
        return joinSector(row);
      },
      update: async ({ where, data }: Row) => {
        const row = state.sectors.find((s) => s.id === where.id)!;
        const next = { ...row, ...data, updatedAt: new Date() };
        assertSectorUniques(next, row.id);
        Object.assign(row, next);
        return joinSector(row);
      },
    },
    inventoryAuditLog: {
      create: async ({ data }: Row) => {
        state.auditLogs.push(data);
        return data;
      },
    },
  };

  // Mesma classe de erro que o Prisma real lança — o service canônico de
  // almoxarifado a reconhece por instanceof.
  function p2002FromPrisma() {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client,
      meta: { target: ["code"] },
    });
  }

  const TABLES = ["warehouses", "sectors", "auditLogs"] as const;
  const prisma: Row = {
    ...tx,
    $transaction: async (fn: (inner: Row) => Promise<unknown>) => {
      const snapshot = TABLES.map((t) => state[t].map((row) => ({ ...row })));
      try {
        return await fn(tx);
      } catch (e) {
        TABLES.forEach((t, i) => state[t].splice(0, state[t].length, ...snapshot[i]!));
        throw e;
      }
    },
  };
  return { prisma: prisma as never, state };
}

const MANAGER = { userId: "u-mgr", userName: "Gestor", permissions: ["inventory.warehouse.manage"] };
const VIEWER = { userId: "u-view", userName: "Leitor", permissions: ["inventory.view"] };

/** O setor real de referência — exatamente o que a tela envia. */
const ADMINISTRATIVO_BODY = {
  code: "ADMINISTRATIVO",
  name: "Estoque Administrativo",
  slug: "administrativo",
  strategy: "STANDARD",
  itemType: "ADMINISTRATIVE_SUPPLY",
  warehouseId: WH_ADM,
  sessionCodePrefix: "ADM",
  allowsCounting: true,
  allowsWithdrawal: true,
  status: "ACTIVE",
  defaultCostCenterId: CC_ADM,
};

const EPI_WITH_NEW_WAREHOUSE = {
  code: "EPI",
  name: "EPI",
  slug: "epi",
  itemType: "PPE",
  sessionCodePrefix: "EPI",
  allowsCounting: true,
  allowsWithdrawal: true,
  defaultCostCenterId: CC_ADM,
  newWarehouse: { code: "epi", name: "Almoxarifado de EPI", description: "Sala 2" },
};

const codeOf = (code: string) => (e: unknown) =>
  e instanceof InventoryValidationError && e.code === code;

// ===========================================================================
describe("setor de estoque · criar com almoxarifado existente", () => {
  it("1. ADMINISTRATIVO: configuração de referência é criada e auditada", async () => {
    const db = createAdminFakeDb();
    const created = await createInventoryStockSector(
      db.prisma,
      parseCreateInventoryStockSectorBody(ADMINISTRATIVO_BODY),
      MANAGER
    );
    const dto = serializeInventoryStockSector(created);
    assert.equal(dto.code, "ADMINISTRATIVO");
    assert.equal(dto.slug, "administrativo");
    assert.equal(dto.strategy, "STANDARD");
    assert.equal(dto.itemType, "ADMINISTRATIVE_SUPPLY");
    assert.equal(dto.sessionCodePrefix, "ADM");
    assert.equal(dto.allowsCounting, true);
    assert.equal(dto.allowsWithdrawal, true);
    assert.equal(dto.warehouse.code, "ADMINISTRATIVO");
    assert.deepEqual(dto.defaultCostCenter, {
      id: CC_ADM,
      code: "ADM",
      name: "Administrativo",
      isActive: true,
    });
    assert.equal(db.state.warehouses.length, 3, "almoxarifado existente não é duplicado");
    assert.deepEqual(
      db.state.auditLogs.map((a) => [a.entityType, a.action, a.userId]),
      [["InventoryStockSector", "CREATE", "u-mgr"]]
    );
  });

  it("2. almoxarifado inativo ou inexistente é recusado", async () => {
    const db = createAdminFakeDb();
    await assert.rejects(
      () =>
        createInventoryStockSector(
          db.prisma,
          parseCreateInventoryStockSectorBody({ ...ADMINISTRATIVO_BODY, warehouseId: WH_OFF }),
          MANAGER
        ),
      codeOf("STOCK_SECTOR_WAREHOUSE_INACTIVE")
    );
    assert.equal(db.state.sectors.length, 0);
  });

  it("3. centro de custo: obrigatório para o tipo, e precisa existir e estar ativo", async () => {
    const db = createAdminFakeDb();
    assert.throws(
      () => parseCreateInventoryStockSectorBody({ ...ADMINISTRATIVO_BODY, defaultCostCenterId: "" }),
      codeOf(STOCK_SECTOR_COST_CENTER_REQUIRED)
    );
    assert.throws(
      () => parseCreateInventoryStockSectorBody({ ...ADMINISTRATIVO_BODY, defaultCostCenterId: "abc" }),
      codeOf(STOCK_SECTOR_COST_CENTER_INVALID)
    );
    for (const defaultCostCenterId of [CC_OFF, "cc000000-0000-4000-8000-00000000ffff"]) {
      await assert.rejects(
        () =>
          createInventoryStockSector(
            db.prisma,
            parseCreateInventoryStockSectorBody({ ...ADMINISTRATIVO_BODY, defaultCostCenterId }),
            MANAGER
          ),
        codeOf(STOCK_SECTOR_COST_CENTER_INVALID)
      );
    }
    // Tipo que não exige centro de custo cria sem ele.
    const packaging = await createInventoryStockSector(
      db.prisma,
      parseCreateInventoryStockSectorBody({
        ...ADMINISTRATIVO_BODY,
        code: "EMBALAGENS",
        slug: "embalagens",
        sessionCodePrefix: "EMB",
        itemType: "PACKAGING",
        warehouseId: WH_OTHER,
        defaultCostCenterId: "",
      }),
      MANAGER
    );
    assert.equal(packaging.defaultCostCenterId, null);
  });

  it("4. sem permissão de gestão: nada é criado ou alterado", async () => {
    const db = createAdminFakeDb();
    await assert.rejects(
      () =>
        createInventoryStockSector(
          db.prisma,
          parseCreateInventoryStockSectorBody(ADMINISTRATIVO_BODY),
          VIEWER
        ),
      codeOf("NOT_AUTHORIZED")
    );
    await assert.rejects(
      () =>
        createInventoryStockSectorWithWarehouse(
          db.prisma,
          parseCreateInventoryStockSectorWithWarehouseBody(EPI_WITH_NEW_WAREHOUSE),
          VIEWER
        ),
      codeOf("NOT_AUTHORIZED")
    );
    assert.equal(db.state.sectors.length, 0);
    assert.equal(db.state.warehouses.length, 3);
    assert.equal(db.state.auditLogs.length, 0);
  });
});

// ===========================================================================
describe("setor de estoque · almoxarifado novo + setor (atômico)", () => {
  it("5. cria os dois na mesma transação, com as duas auditorias", async () => {
    const db = createAdminFakeDb();
    assert.equal(hasNewWarehouseInStockSectorBody(EPI_WITH_NEW_WAREHOUSE), true);
    assert.equal(hasNewWarehouseInStockSectorBody(ADMINISTRATIVO_BODY), false);
    const result = await createInventoryStockSectorWithWarehouse(
      db.prisma,
      parseCreateInventoryStockSectorWithWarehouseBody(EPI_WITH_NEW_WAREHOUSE),
      MANAGER
    );
    assert.equal(result.warehouse.code, "EPI");
    assert.equal(result.warehouse.status, "ACTIVE");
    assert.equal(result.sector.warehouseId, result.warehouse.id);
    assert.equal(result.sector.warehouse.code, "EPI");
    assert.equal(db.state.warehouses.length, 4);
    assert.deepEqual(
      db.state.auditLogs.map((a) => [a.entityType, a.action]),
      [
        ["InventoryWarehouse", "CREATE"],
        ["InventoryStockSector", "CREATE"],
      ]
    );
  });

  it("6. se o setor falhar, o almoxarifado criado na operação é desfeito", async () => {
    const db = createAdminFakeDb();
    await createInventoryStockSector(
      db.prisma,
      parseCreateInventoryStockSectorBody(ADMINISTRATIVO_BODY),
      MANAGER
    );
    const auditsBefore = db.state.auditLogs.length;
    await assert.rejects(
      () =>
        createInventoryStockSectorWithWarehouse(
          db.prisma,
          parseCreateInventoryStockSectorWithWarehouseBody({
            ...EPI_WITH_NEW_WAREHOUSE,
            code: "ADMINISTRATIVO", // duplicado → setor falha depois do almoxarifado
          }),
          MANAGER
        ),
      codeOf(STOCK_SECTOR_CODE_DUPLICATE)
    );
    assert.equal(db.state.warehouses.length, 3, "nenhum almoxarifado órfão");
    assert.equal(db.state.warehouses.some((w) => w.code === "EPI"), false);
    assert.equal(db.state.sectors.length, 1);
    assert.equal(db.state.auditLogs.length, auditsBefore, "auditoria da tentativa também é desfeita");
  });

  it("7. centro de custo inválido também desfaz o almoxarifado", async () => {
    const db = createAdminFakeDb();
    await assert.rejects(
      () =>
        createInventoryStockSectorWithWarehouse(
          db.prisma,
          parseCreateInventoryStockSectorWithWarehouseBody({
            ...EPI_WITH_NEW_WAREHOUSE,
            defaultCostCenterId: CC_OFF,
          }),
          MANAGER
        ),
      codeOf(STOCK_SECTOR_COST_CENTER_INVALID)
    );
    assert.equal(db.state.warehouses.length, 3);
    assert.equal(db.state.sectors.length, 0);
  });

  it("8. código de almoxarifado já existente: nada é criado", async () => {
    const db = createAdminFakeDb();
    await assert.rejects(
      () =>
        createInventoryStockSectorWithWarehouse(
          db.prisma,
          parseCreateInventoryStockSectorWithWarehouseBody({
            ...EPI_WITH_NEW_WAREHOUSE,
            newWarehouse: { code: "ADMINISTRATIVO", name: "Outro" },
          }),
          MANAGER
        ),
      codeOf(INVENTORY_WAREHOUSE_CODE_DUPLICATE)
    );
    assert.equal(db.state.warehouses.length, 3);
    assert.equal(db.state.sectors.length, 0);
  });

  it("9. existente E novo ao mesmo tempo é recusado; novo exige código e nome", () => {
    assert.throws(
      () =>
        parseCreateInventoryStockSectorWithWarehouseBody({
          ...EPI_WITH_NEW_WAREHOUSE,
          warehouseId: WH_ADM,
        }),
      codeOf("STOCK_SECTOR_WAREHOUSE_AMBIGUOUS")
    );
    assert.throws(() =>
      parseCreateInventoryStockSectorWithWarehouseBody({
        ...EPI_WITH_NEW_WAREHOUSE,
        newWarehouse: { code: "", name: "Sem código" },
      })
    );
    // O almoxarifado nasce sempre ACTIVE e movimentável, diga o corpo o que disser.
    const parsed = parseCreateInventoryStockSectorWithWarehouseBody({
      ...EPI_WITH_NEW_WAREHOUSE,
      newWarehouse: { code: "epi", name: "EPI", status: "INACTIVE", allowsMovements: false },
    });
    assert.equal(parsed.newWarehouse.code, "EPI");
    assert.equal(parsed.newWarehouse.status, "ACTIVE");
    assert.equal(parsed.newWarehouse.allowsMovements, true);
  });
});

// ===========================================================================
describe("setor de estoque · proteção do legado e edição", () => {
  it("10. Matéria-prima, Componentes e Produto acabado não viram setor configurável", () => {
    for (const itemType of ["RAW_MATERIAL", "COMPONENT", "FINISHED_PRODUCT"]) {
      assert.throws(
        () => parseCreateInventoryStockSectorBody({ ...ADMINISTRATIVO_BODY, itemType }),
        codeOf(STOCK_SECTOR_LEGACY_RESERVED),
        itemType
      );
      assert.throws(
        () => parseUpdateInventoryStockSectorBody({ itemType }),
        codeOf(STOCK_SECTOR_LEGACY_RESERVED),
        itemType
      );
    }
    for (const reserved of [
      { code: "RAW_MATERIAL" },
      { slug: "raw-material" },
      { slug: "componentes" },
      { slug: "produto-acabado" },
      { sessionCodePrefix: "MP" },
      { sessionCodePrefix: "CP" },
      { sessionCodePrefix: "PA" },
    ]) {
      assert.throws(
        () => parseCreateInventoryStockSectorBody({ ...ADMINISTRATIVO_BODY, ...reserved }),
        codeOf(STOCK_SECTOR_LEGACY_RESERVED),
        JSON.stringify(reserved)
      );
    }
    for (const legacy of ["RAW_MATERIAL", "COMPONENT", "FINISHED_PRODUCT"] as const) {
      assert.equal(INVENTORY_STOCK_SECTOR_STANDARD_ITEM_TYPES.includes(legacy), false);
    }
  });

  it("11. prefixo de 2 a 4 letras; fora disso é recusado", () => {
    for (const ok of ["AD", "ADM", "EPIS"]) {
      assert.equal(
        parseCreateInventoryStockSectorBody({ ...ADMINISTRATIVO_BODY, sessionCodePrefix: ok })
          .sessionCodePrefix,
        ok
      );
    }
    for (const bad of ["A", "ABCDE", ""]) {
      assert.throws(
        () => parseCreateInventoryStockSectorBody({ ...ADMINISTRATIVO_BODY, sessionCodePrefix: bad }),
        codeOf("INVALID_STOCK_SECTOR_PREFIX"),
        bad
      );
    }
  });

  it("12. campos fora do contrato são ignorados (sem mass assignment)", () => {
    const parsed = parseCreateInventoryStockSectorBody({
      ...ADMINISTRATIVO_BODY,
      id: "forjado",
      createdByUserId: "outro",
      updatedByUserId: "outro",
      createdAt: "2020-01-01",
    }) as Record<string, unknown>;
    for (const forbidden of ["id", "createdByUserId", "updatedByUserId", "createdAt"]) {
      assert.equal(forbidden in parsed, false, forbidden);
    }
    const patch = parseUpdateInventoryStockSectorBody({
      name: "Novo nome",
      id: "forjado",
      createdByUserId: "outro",
    }) as Record<string, unknown>;
    assert.deepEqual(Object.keys(patch), ["name"]);
  });

  it("13. ativar / inativar ficam nomeados na auditoria; setor nunca é apagado", async () => {
    const db = createAdminFakeDb();
    const created = await createInventoryStockSector(
      db.prisma,
      parseCreateInventoryStockSectorBody(ADMINISTRATIVO_BODY),
      MANAGER
    );
    await setInventoryStockSectorStatus(db.prisma, created.id, "INACTIVE", MANAGER);
    await setInventoryStockSectorStatus(db.prisma, created.id, "ACTIVE", MANAGER);
    await updateInventoryStockSector(db.prisma, created.id, { name: "Adm" }, MANAGER);
    assert.deepEqual(
      db.state.auditLogs.map((a) => a.action),
      ["CREATE", "DEACTIVATE", "ACTIVATE", "UPDATE"]
    );
    assert.equal(db.state.sectors.length, 1);
    const service = read("src/lib/inventory/inventoryStockSectorService.server.ts");
    assert.doesNotMatch(service, /inventoryStockSector\.(delete|deleteMany)/);
    assert.doesNotMatch(read("src/lib/inventoryRoutes.ts"), /app\.delete\("\/api\/inventory\/stock-sectors/);
  });

  it("14. identidade do setor não muda com conferência em contagem aberta", async () => {
    const db = createAdminFakeDb({ countingSessionCodes: ["ADM-20261006-001"] });
    const created = await createInventoryStockSector(
      db.prisma,
      parseCreateInventoryStockSectorBody(ADMINISTRATIVO_BODY),
      MANAGER
    );
    for (const patch of [
      { warehouseId: WH_OTHER },
      { itemType: "PPE" as const },
      { sessionCodePrefix: "ADX" },
    ]) {
      await assert.rejects(
        () => updateInventoryStockSector(db.prisma, created.id, patch, MANAGER),
        codeOf(STOCK_SECTOR_HAS_ACTIVE_SESSION),
        JSON.stringify(patch)
      );
    }
    // Mudanças que não mexem na identidade seguem liberadas.
    const renamed = await updateInventoryStockSector(
      db.prisma,
      created.id,
      { name: "Adm", allowsWithdrawal: false },
      MANAGER
    );
    assert.equal(renamed.name, "Adm");
    assert.equal(renamed.sessionCodePrefix, "ADM");
  });

  it("15. tirar o centro de custo de um setor que precisa dele é recusado", async () => {
    const db = createAdminFakeDb();
    const created = await createInventoryStockSector(
      db.prisma,
      parseCreateInventoryStockSectorBody(ADMINISTRATIVO_BODY),
      MANAGER
    );
    await assert.rejects(
      () =>
        updateInventoryStockSector(db.prisma, created.id, { defaultCostCenterId: null }, MANAGER),
      codeOf(STOCK_SECTOR_COST_CENTER_REQUIRED)
    );
    assert.equal(db.state.sectors[0]!.defaultCostCenterId, CC_ADM);
  });
});

// ===========================================================================
describe("setor de estoque · prévia de população e opções", () => {
  function catalog(total: number) {
    const items: FakeItemSeed[] = [];
    for (let i = 0; i < total; i += 1) {
      items.push({
        id: `${(i + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
        code: `ADM-${i}`,
        itemType: "ADMINISTRATIVE_SUPPLY",
        defaultWarehouseId: WH_ADM,
      });
    }
    return items;
  }

  it("16. ADMINISTRATIVO com 311 itens e nenhum saldo: prévia = 311, com 1 COUNT", async () => {
    const db = createCollectorCountFakeDb({
      warehouses: [{ id: WH_ADM, code: "ADMINISTRATIVO" }, { id: WH_OTHER, code: "ALM-B" }],
      items: [
        ...catalog(311),
        { id: "x-1", code: "EPI-1", itemType: "PPE", defaultWarehouseId: WH_ADM },
        { id: "x-2", code: "ADM-OFF", itemType: "ADMINISTRATIVE_SUPPLY", status: "INACTIVE", defaultWarehouseId: WH_ADM },
        { id: "x-3", code: "ADM-NS", itemType: "ADMINISTRATIVE_SUPPLY", controlsStock: false, defaultWarehouseId: WH_ADM },
        { id: "x-4", code: "ADM-B", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_OTHER },
      ],
    });
    const count = await countInventoryStockSectorEligibleItems(db.client, {
      itemType: "ADMINISTRATIVE_SUPPLY",
      warehouseId: WH_ADM,
    });
    assert.equal(count, 311);
    assert.equal(db.state.balances.length, 0, "311 itens, zero saldo — é o estado esperado");
    assert.deepEqual(db.state.queries, ["inventoryItem.count"], "COUNT no banco, sem carregar itens");
  });

  it("17. prévia conta item que só tem saldo histórico no almoxarifado", async () => {
    const db = createCollectorCountFakeDb({
      warehouses: [{ id: WH_ADM, code: "ADMINISTRATIVO" }, { id: WH_OTHER, code: "ALM-B" }],
      items: [
        { id: "h-1", code: "ADM-H", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_OTHER },
        { id: "h-2", code: "EPI-H", itemType: "PPE", defaultWarehouseId: WH_OTHER },
      ],
      balances: [
        { itemId: "h-1", warehouseId: WH_ADM, physicalQuantity: 2 },
        { itemId: "h-2", warehouseId: WH_ADM, physicalQuantity: 2 },
      ],
    });
    assert.equal(
      await countInventoryStockSectorEligibleItems(db.client, {
        itemType: "ADMINISTRATIVE_SUPPLY",
        warehouseId: WH_ADM,
      }),
      1,
      "saldo de outro tipo no mesmo almoxarifado não entra"
    );
  });

  it("18. zero itens, almoxarifado ainda não criado e tipo legado", async () => {
    const db = createCollectorCountFakeDb({ warehouses: [{ id: WH_ADM, code: "ADM" }], items: [] });
    assert.equal(
      await countInventoryStockSectorEligibleItems(db.client, { itemType: "PPE", warehouseId: WH_ADM }),
      0
    );
    assert.equal(
      await countInventoryStockSectorEligibleItems(db.client, { itemType: "PPE", warehouseId: null }),
      0
    );
    assert.equal(db.state.queries.length, 1, "almoxarifado novo nem consulta");
    await assert.rejects(
      () =>
        countInventoryStockSectorEligibleItems(db.client, {
          itemType: "RAW_MATERIAL",
          warehouseId: WH_ADM,
        }),
      codeOf(STOCK_SECTOR_LEGACY_RESERVED)
    );
  });

  it("19. opções do formulário: só STANDARD, sem tipos legados, só ativos", async () => {
    const db = createAdminFakeDb();
    const options = await loadInventoryStockSectorFormOptions(db.prisma);
    assert.deepEqual(options.strategies, ["STANDARD"]);
    const types = options.itemTypes.map((t) => t.itemType);
    for (const legacy of ["RAW_MATERIAL", "COMPONENT", "FINISHED_PRODUCT"]) {
      assert.equal(types.includes(legacy as never), false, legacy);
    }
    assert.ok(types.includes("ADMINISTRATIVE_SUPPLY"));
    assert.equal(
      options.itemTypes.find((t) => t.itemType === "ADMINISTRATIVE_SUPPLY")!.requiresCostCenter,
      true
    );
    assert.equal(options.itemTypes.find((t) => t.itemType === "PACKAGING")!.requiresCostCenter, false);
    assert.deepEqual(
      options.warehouses.map((w) => w.code),
      ["ADMINISTRATIVO", "ALM-B"]
    );
    assert.deepEqual(
      options.costCenters.map((c) => c.id),
      [CC_ADM]
    );
    assert.equal(stockSectorRequiresCostCenter("PPE"), true);
    assert.equal(stockSectorRequiresCostCenter(null), false);
  });
});

// ===========================================================================
describe("setor de estoque · QR e rotas", () => {
  const BASE = { [COLLECTOR_PUBLIC_BASE_URL_ENV]: "https://collector.example.ts.net" };

  it("20. QR do setor configurável: /collector/sector/<slug> sobre a base pública canônica", () => {
    assert.equal(
      buildSectorCollectorAbsoluteUrlForSlug("administrativo", BASE as never),
      "https://collector.example.ts.net/collector/sector/administrativo"
    );
  });

  it("21. sem base pública válida falha fechado; slug fora do formato é recusado", () => {
    assert.throws(
      () => buildSectorCollectorAbsoluteUrlForSlug("administrativo", {} as never),
      codeOf(COLLECTOR_PUBLIC_BASE_URL_REQUIRED)
    );
    for (const bad of ["", "../admin", "a b", "Administrativo", "x/y", "a?b=1"]) {
      assert.throws(
        () => buildSectorCollectorAbsoluteUrlForSlug(bad, BASE as never),
        codeOf("COLLECTOR_INVALID_SECTOR"),
        bad
      );
    }
  });

  it("22. rotas administrativas: guardas, ordem e dispatch do QR", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    for (const path of [
      '"/api/inventory/stock-sectors/form-options"',
      '"/api/inventory/stock-sectors/preview"',
    ]) {
      const idx = routes.indexOf(path);
      assert.ok(idx > 0, `rota ausente: ${path}`);
      assert.match(routes.slice(idx, idx + 80), /warehouseManage/, `${path} sem guarda de gestão`);
      assert.ok(
        idx < routes.indexOf('app.get("/api/inventory/stock-sectors/:id"'),
        `${path} precisa vir antes de /:id`
      );
    }
    const postIdx = routes.indexOf('app.post("/api/inventory/stock-sectors"');
    const post = routes.slice(postIdx, postIdx + 1400);
    assert.match(post, /warehouseManage/);
    assert.match(post, /hasNewWarehouseInStockSectorBody/);
    assert.match(post, /createInventoryStockSectorWithWarehouse/);

    const qrIdx = routes.indexOf('app.get("/api/inventory/collector/sector-qr"');
    const qr = routes.slice(qrIdx, qrIdx + 1500);
    assert.match(qr, /countManage/);
    assert.match(qr, /resolveStandardCollectorSector/);
    assert.match(qr, /buildSectorCollectorAbsoluteUrlForSlug\(standard\.slug\)/);
    // Legado segue no caminho de sempre.
    assert.match(qr, /buildSectorCollectorAbsoluteUrl\(sector\)/);
  });

  it("23. a prévia usa COUNT e o mesmo predicado da contagem e da retirada", () => {
    const service = read("src/lib/inventory/inventoryStockSectorService.server.ts");
    assert.match(service, /inventoryItem\.count\(/);
    assert.match(service, /standardSectorMemberItemWhere/);
    const withdrawal = read("src/lib/inventory/collector/collectorStandardWithdrawal.server.ts");
    assert.match(withdrawal, /standardSectorMemberItemWhere/);
  });
});
