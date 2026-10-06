/**
 * Testes da fundação InventoryStockSector — schema, domínio, service (fake DB) e rotas.
 * Collector legado NÃO é alterado nesta fase.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { InventoryValidationError } from "./inventoryTypes.js";
import {
  STOCK_SECTOR_ACTIVE_SCOPE_DUPLICATE,
  STOCK_SECTOR_CODE_DUPLICATE,
  STOCK_SECTOR_LEGACY_RESERVED,
  STOCK_SECTOR_NOT_FOUND,
  STOCK_SECTOR_PREFIX_DUPLICATE,
  STOCK_SECTOR_SLUG_DUPLICATE,
  STOCK_SECTOR_STRATEGY_NOT_ALLOWED,
  STOCK_SECTOR_ITEM_TYPE_REQUIRED,
  STOCK_SECTOR_WAREHOUSE_INACTIVE,
  normalizeStockSectorCode,
  normalizeStockSectorPrefix,
  normalizeStockSectorSlug,
  normalizeCreateStockSectorFields,
} from "./inventoryStockSectorDomain.js";
import {
  parseCreateInventoryStockSectorBody,
  parseInventoryStockSectorStatusBody,
  parseUpdateInventoryStockSectorBody,
} from "./inventoryStockSectorValidation.js";
import {
  createInventoryStockSector,
  getInventoryStockSectorById,
  getInventoryStockSectorBySlug,
  listInventoryStockSectors,
  serializeInventoryStockSector,
  setInventoryStockSectorStatus,
  updateInventoryStockSector,
} from "./inventoryStockSectorService.server.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const SCHEMA = read("prisma/schema.prisma");
const MIGRATION = read(
  "prisma/migrations/20261006180000_inventory_stock_sector/migration.sql"
);

const WH_ACTIVE = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "ADMINISTRATIVO",
  name: "Estoque Administrativo",
  status: "ACTIVE" as const,
  allowsMovements: true,
};
const WH_INACTIVE = {
  id: "22222222-2222-4222-8222-222222222222",
  code: "INATIVO",
  name: "Inativo",
  status: "INACTIVE" as const,
  allowsMovements: true,
};

type SectorRow = {
  id: string;
  code: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE";
  warehouseId: string;
  strategy: "STANDARD" | "RAW_MATERIAL" | "PRODUCT";
  itemType: string | null;
  sessionCodePrefix: string;
  allowsCounting: boolean;
  allowsWithdrawal: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
  updatedByUserId: string | null;
};

type AuditRow = Record<string, unknown>;

function createStockSectorFakeDb() {
  const state = {
    warehouses: [WH_ACTIVE, WH_INACTIVE],
    sectors: [] as SectorRow[],
    auditLogs: [] as AuditRow[],
  };

  const withWarehouse = (row: SectorRow) => ({
    ...row,
    warehouse: state.warehouses.find((w) => w.id === row.warehouseId)!,
  });

  const assertUniques = (data: Partial<SectorRow>, excludingId?: string) => {
    const others = state.sectors.filter((s) => s.id !== excludingId);
    if (data.code && others.some((s) => s.code === data.code)) {
      const err = Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["code"] },
      });
      throw err;
    }
    if (data.slug && others.some((s) => s.slug === data.slug)) {
      const err = Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["slug"] },
      });
      throw err;
    }
    if (
      data.sessionCodePrefix &&
      others.some((s) => s.sessionCodePrefix === data.sessionCodePrefix)
    ) {
      const err = Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["sessionCodePrefix"] },
      });
      throw err;
    }
    const status = data.status ?? "ACTIVE";
    const strategy = data.strategy ?? "STANDARD";
    const itemType = data.itemType;
    const warehouseId = data.warehouseId;
    if (
      status === "ACTIVE" &&
      strategy === "STANDARD" &&
      itemType &&
      warehouseId &&
      others.some(
        (s) =>
          s.status === "ACTIVE" &&
          s.strategy === "STANDARD" &&
          s.itemType === itemType &&
          s.warehouseId === warehouseId
      )
    ) {
      const err = Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["itemType", "warehouseId"] },
      });
      throw err;
    }
  };

  const sectorModel = {
    findUnique: async ({
      where,
      include,
    }: {
      where: { id?: string; slug?: string };
      include?: unknown;
    }) => {
      const row = where.id
        ? state.sectors.find((s) => s.id === where.id)
        : where.slug
          ? state.sectors.find((s) => s.slug === where.slug)
          : undefined;
      if (!row) return null;
      return include ? withWarehouse(row) : row;
    },
    findMany: async ({
      where,
      skip = 0,
      take = 50,
    }: {
      where?: {
        status?: string;
        strategy?: string;
        OR?: Array<Record<string, { contains: string; mode?: string }>>;
      };
      include?: unknown;
      orderBy?: unknown;
      skip?: number;
      take?: number;
    }) => {
      let rows = [...state.sectors];
      if (where?.status) rows = rows.filter((s) => s.status === where.status);
      if (where?.strategy) rows = rows.filter((s) => s.strategy === where.strategy);
      if (where?.OR) {
        const term = Object.values(where.OR[0] ?? {})[0]?.contains?.toLowerCase() ?? "";
        rows = rows.filter(
          (s) =>
            s.code.toLowerCase().includes(term) ||
            s.name.toLowerCase().includes(term) ||
            s.slug.toLowerCase().includes(term)
        );
      }
      rows.sort((a, b) => a.code.localeCompare(b.code));
      return rows.slice(skip, skip + take).map(withWarehouse);
    },
    count: async ({
      where,
    }: {
      where?: { status?: string; strategy?: string; OR?: unknown };
    }) => {
      let rows = [...state.sectors];
      if (where?.status) rows = rows.filter((s) => s.status === where.status);
      if (where?.strategy) rows = rows.filter((s) => s.strategy === where.strategy);
      return rows.length;
    },
    create: async ({
      data,
      include,
    }: {
      data: Record<string, unknown>;
      include?: unknown;
    }) => {
      assertUniques(data as Partial<SectorRow>);
      const row: SectorRow = {
        id: `33333333-3333-4333-8333-${String(state.sectors.length + 1).padStart(12, "0")}`,
        code: String(data.code),
        name: String(data.name),
        slug: String(data.slug),
        status: (data.status as SectorRow["status"]) ?? "ACTIVE",
        warehouseId: String(data.warehouseId),
        strategy: data.strategy as SectorRow["strategy"],
        itemType: (data.itemType as string | null) ?? null,
        sessionCodePrefix: String(data.sessionCodePrefix),
        allowsCounting: Boolean(data.allowsCounting),
        allowsWithdrawal: Boolean(data.allowsWithdrawal),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdByUserId: (data.createdByUserId as string | null) ?? null,
        updatedByUserId: (data.updatedByUserId as string | null) ?? null,
      };
      state.sectors.push(row);
      return include ? withWarehouse(row) : row;
    },
    update: async ({
      where,
      data,
      include,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
      include?: unknown;
    }) => {
      const idx = state.sectors.findIndex((s) => s.id === where.id);
      if (idx < 0) throw new Error("not found");
      const next = { ...state.sectors[idx], ...data, updatedAt: new Date() } as SectorRow;
      assertUniques(next, where.id);
      state.sectors[idx] = next;
      return include ? withWarehouse(next) : next;
    },
  };

  const warehouseModel = {
    findUnique: async ({
      where,
    }: {
      where: { id: string };
      select?: unknown;
    }) => state.warehouses.find((w) => w.id === where.id) ?? null,
  };

  const tx = {
    inventoryStockSector: sectorModel,
    inventoryWarehouse: warehouseModel,
    inventoryAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
  };

  const snapshot = () => ({
    sectors: state.sectors.map((s) => ({ ...s })),
    auditLogs: state.auditLogs.map((a) => ({ ...a })),
  });
  const restore = (snap: ReturnType<typeof snapshot>) => {
    state.sectors.splice(0, state.sectors.length, ...snap.sectors);
    state.auditLogs.splice(0, state.auditLogs.length, ...snap.auditLogs);
  };

  const prisma = {
    $transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => {
      const snap = snapshot();
      try {
        return await fn(tx);
      } catch (e) {
        restore(snap);
        throw e;
      }
    },
    ...tx,
  };

  return { prisma, state };
}

const MANAGER = {
  userId: "user-mgr",
  userName: "Gestor",
  permissions: ["inventory.warehouse.manage"] as const,
};
const VIEWER = {
  userId: "user-view",
  userName: "Viewer",
  permissions: ["inventory.view"] as const,
};

const validCreate = {
  code: "ADMINISTRATIVO",
  name: "Estoque Administrativo",
  slug: "administrativo",
  warehouseId: WH_ACTIVE.id,
  strategy: "STANDARD" as const,
  itemType: "ADMINISTRATIVE_SUPPLY" as const,
  sessionCodePrefix: "AD",
  allowsCounting: true,
  allowsWithdrawal: false,
  status: "ACTIVE" as const,
};

describe("InventoryStockSector schema/migration", () => {
  it("model e enums existem no schema", () => {
    assert.match(SCHEMA, /model InventoryStockSector/);
    assert.match(SCHEMA, /enum InventoryStockSectorStatus/);
    assert.match(SCHEMA, /enum InventoryStockSectorStrategy/);
    assert.match(SCHEMA, /stockSectors\s+InventoryStockSector\[\]/);
  });

  it("migration é exclusivamente aditiva", () => {
    assert.match(MIGRATION, /CREATE TABLE "InventoryStockSector"/);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(MIGRATION, /\bRENAME\s+TO\b/i);
    assert.doesNotMatch(MIGRATION, /ALTER TABLE "InventoryItem"/i);
    assert.doesNotMatch(MIGRATION, /ALTER TABLE "InventoryBalance"/i);
    assert.doesNotMatch(MIGRATION, /ALTER TABLE "InventoryMovement"/i);
    assert.doesNotMatch(MIGRATION, /ALTER TABLE "InventoryWarehouse"/i);
    assert.doesNotMatch(MIGRATION, /ALTER TABLE "Material"/i);
    assert.doesNotMatch(MIGRATION, /ALTER TABLE "Product"/i);
  });

  it("índices de slug/code/status/warehouseId e unique parcial STANDARD", () => {
    assert.match(MIGRATION, /InventoryStockSector_slug/);
    assert.match(MIGRATION, /InventoryStockSector_code/);
    assert.match(MIGRATION, /InventoryStockSector_status/);
    assert.match(MIGRATION, /InventoryStockSector_warehouseId/);
    assert.match(MIGRATION, /InventoryStockSector_active_standard_item_warehouse_key/);
  });
});

describe("InventoryStockSector domain validation", () => {
  it("normaliza code/slug/prefix", () => {
    assert.equal(normalizeStockSectorCode("  admin estrat  "), "ADMIN_ESTRAT");
    assert.equal(normalizeStockSectorSlug(" Admin_Estrat "), "admin-estrat");
    assert.equal(normalizeStockSectorPrefix(" ad "), "AD");
  });

  it("rejeita code/slug/prefix legados MP/CP/PA", () => {
    assert.throws(
      () => normalizeCreateStockSectorFields({ ...validCreate, code: "RAW_MATERIAL" }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_LEGACY_RESERVED
    );
    assert.throws(
      () =>
        normalizeCreateStockSectorFields({
          ...validCreate,
          slug: "raw-material",
          code: "ADM2",
        }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_LEGACY_RESERVED
    );
    assert.throws(
      () =>
        normalizeCreateStockSectorFields({
          ...validCreate,
          code: "ADM3",
          slug: "adm3",
          sessionCodePrefix: "MP",
        }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_LEGACY_RESERVED
    );
  });

  it("STANDARD sem itemType é recusado", () => {
    assert.throws(
      () => parseCreateInventoryStockSectorBody({ ...validCreate, itemType: "" }),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        (e.code === STOCK_SECTOR_ITEM_TYPE_REQUIRED || e.code === "FIELD_REQUIRED" || e.code === "INVALID_ITEM_TYPE")
    );
  });

  it("RAW_MATERIAL/PRODUCT não são permitidos no CRUD de usuário", () => {
    assert.throws(
      () => parseCreateInventoryStockSectorBody({ ...validCreate, strategy: "RAW_MATERIAL" }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_STRATEGY_NOT_ALLOWED
    );
    assert.throws(
      () => parseCreateInventoryStockSectorBody({ ...validCreate, strategy: "PRODUCT" }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_STRATEGY_NOT_ALLOWED
    );
  });

  it("criação válida normaliza campos", () => {
    const parsed = parseCreateInventoryStockSectorBody({
      code: " administrativo ",
      name: " Estoque Administrativo ",
      slug: "Administrativo",
      warehouseId: WH_ACTIVE.id,
      itemType: "administrative_supply",
      sessionCodePrefix: "ad",
      allowsWithdrawal: "false",
    });
    assert.equal(parsed.code, "ADMINISTRATIVO");
    assert.equal(parsed.slug, "administrativo");
    assert.equal(parsed.sessionCodePrefix, "AD");
    assert.equal(parsed.itemType, "ADMINISTRATIVE_SUPPLY");
    assert.equal(parsed.strategy, "STANDARD");
    assert.equal(parsed.allowsWithdrawal, false);
  });

  it("code é imutável no PATCH", () => {
    assert.throws(
      () => parseUpdateInventoryStockSectorBody({ code: "OUTRO" }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "STOCK_SECTOR_CODE_IMMUTABLE"
    );
  });
});

describe("InventoryStockSector service", () => {
  it("recusa sem permissão de gestão de almoxarifados", async () => {
    const { prisma } = createStockSectorFakeDb();
    await assert.rejects(
      () => createInventoryStockSector(prisma as never, validCreate, VIEWER),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "NOT_AUTHORIZED"
    );
  });

  it("criação válida com auditoria e warehouse include", async () => {
    const { prisma, state } = createStockSectorFakeDb();
    const created = await createInventoryStockSector(prisma as never, validCreate, MANAGER);
    assert.equal(created.code, "ADMINISTRATIVO");
    assert.equal(created.warehouse.code, "ADMINISTRATIVO");
    assert.equal(state.auditLogs.length, 1);
    assert.equal(state.auditLogs[0]?.action, "CREATE");
    assert.equal(state.auditLogs[0]?.entityType, "InventoryStockSector");
    const dto = serializeInventoryStockSector(created);
    assert.equal(dto.warehouse.code, "ADMINISTRATIVO");
  });

  it("warehouse inexistente / inativo", async () => {
    const { prisma } = createStockSectorFakeDb();
    await assert.rejects(
      () =>
        createInventoryStockSector(
          prisma as never,
          { ...validCreate, warehouseId: "99999999-9999-4999-8999-999999999999" },
          MANAGER
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "WAREHOUSE_NOT_FOUND"
    );
    await assert.rejects(
      () =>
        createInventoryStockSector(
          prisma as never,
          { ...validCreate, warehouseId: WH_INACTIVE.id },
          MANAGER
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_WAREHOUSE_INACTIVE
    );
  });

  it("code/slug/prefix únicos", async () => {
    const { prisma } = createStockSectorFakeDb();
    await createInventoryStockSector(prisma as never, validCreate, MANAGER);
    await assert.rejects(
      () => createInventoryStockSector(prisma as never, validCreate, MANAGER),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_CODE_DUPLICATE
    );
    await assert.rejects(
      () =>
        createInventoryStockSector(
          prisma as never,
          { ...validCreate, code: "ADM2", slug: "administrativo", sessionCodePrefix: "A2" },
          MANAGER
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_SLUG_DUPLICATE
    );
    await assert.rejects(
      () =>
        createInventoryStockSector(
          prisma as never,
          { ...validCreate, code: "ADM3", slug: "adm3", sessionCodePrefix: "AD" },
          MANAGER
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_PREFIX_DUPLICATE
    );
  });

  it("escopo ACTIVE STANDARD itemType+warehouse único", async () => {
    const { prisma } = createStockSectorFakeDb();
    await createInventoryStockSector(prisma as never, validCreate, MANAGER);
    await assert.rejects(
      () =>
        createInventoryStockSector(
          prisma as never,
          {
            ...validCreate,
            code: "ADM_DUP",
            slug: "adm-dup",
            sessionCodePrefix: "A9",
          },
          MANAGER
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_ACTIVE_SCOPE_DUPLICATE
    );
  });

  it("edição, inativação, get by id/slug e listagem", async () => {
    const { prisma, state } = createStockSectorFakeDb();
    const created = await createInventoryStockSector(prisma as never, validCreate, MANAGER);
    const updated = await updateInventoryStockSector(
      prisma as never,
      created.id,
      { name: "Adm. Renomeado", allowsCounting: true },
      MANAGER
    );
    assert.equal(updated.name, "Adm. Renomeado");
    assert.ok(state.auditLogs.some((a) => a.action === "UPDATE"));

    const inactive = await setInventoryStockSectorStatus(
      prisma as never,
      created.id,
      "INACTIVE",
      MANAGER
    );
    assert.equal(inactive.status, "INACTIVE");

    const byId = await getInventoryStockSectorById(prisma as never, created.id);
    assert.equal(byId.slug, "administrativo");
    const bySlug = await getInventoryStockSectorBySlug(prisma as never, "administrativo");
    assert.equal(bySlug.id, created.id);

    const list = await listInventoryStockSectors(prisma as never, {
      page: 1,
      pageSize: 50,
      status: "INACTIVE",
    });
    assert.equal(list.total, 1);
    assert.equal(list.rows[0]?.warehouse.code, "ADMINISTRATIVO");
  });

  it("get inexistente → STOCK_SECTOR_NOT_FOUND", async () => {
    const { prisma } = createStockSectorFakeDb();
    await assert.rejects(
      () =>
        getInventoryStockSectorById(
          prisma as never,
          "44444444-4444-4444-8444-444444444444"
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === STOCK_SECTOR_NOT_FOUND
    );
  });
});

describe("InventoryStockSector API wiring", () => {
  it("rotas autenticadas com permissões de view/warehouseManage", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /\/api\/inventory\/stock-sectors/);
    assert.match(routes, /\/api\/inventory\/stock-sectors\/:id/);
    assert.match(routes, /\/api\/inventory\/stock-sectors\/:id\/status/);
    assert.match(routes, /createInventoryStockSector/);
    assert.match(routes, /createInventoryWarehouseRecord/);

    const listIdx = routes.indexOf('"/api/inventory/stock-sectors"');
    assert.ok(listIdx > 0);
    const listSlice = routes.slice(listIdx, listIdx + 200);
    assert.match(listSlice, /\.\.\.view/);

    const postIdx = routes.indexOf('app.post("/api/inventory/stock-sectors"');
    assert.ok(postIdx > 0);
    const postSlice = routes.slice(postIdx, postIdx + 350);
    assert.match(postSlice, /warehouseManage/);
    assert.match(postSlice, /getCurrentAppUser/);
  });

  it("Collector contract legado intacto (sem dependência da tabela)", () => {
    const contract = read("src/lib/inventory/collector/collectorSectorContract.ts");
    assert.match(contract, /RAW_MATERIAL/);
    assert.match(contract, /COMPONENT/);
    assert.match(contract, /FINISHED_PRODUCT/);
    assert.doesNotMatch(contract, /InventoryStockSector/);
    const routes = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    assert.doesNotMatch(routes, /inventoryStockSector/);
  });

  it("parse status patch", () => {
    assert.equal(parseInventoryStockSectorStatusBody({ status: "inactive" }), "INACTIVE");
    assert.throws(
      () => parseInventoryStockSectorStatusBody({ status: "X" }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "INVALID_STATUS"
    );
  });
});
