import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  materialStockTabletTextMatches,
  searchMaterialStockTablet,
} from "./materialStockTablet.server.js";
import { parseMaterialStockTabletSearchQuery } from "./materialStockTabletQuery.js";
import {
  assertNoCostLeakInTabletItem,
  serializeMaterialStockTabletListItem,
} from "./materialStockTabletSerialization.js";
import { MATERIAL_STOCK_TABLET_MAX_PAGE_SIZE } from "./materialStockTabletTypes.js";

const root = process.cwd();

function makeRow(partial: {
  id: string;
  code: string;
  description: string;
  status?: string;
  quantity?: number;
  contingencyQuantity?: number | null;
  minimumQuantity?: number | null;
  recommendedQuantity?: number | null;
  lastStockConferenceAt?: Date | null;
  lastStockConferenceUserId?: string | null;
}) {
  return {
    id: partial.id,
    code: partial.code,
    description: partial.description,
    unit: "UN",
    quantity: partial.quantity ?? 10,
    contingencyQuantity:
      partial.contingencyQuantity === undefined ? 2 : partial.contingencyQuantity,
    minimumQuantity: partial.minimumQuantity === undefined ? 5 : partial.minimumQuantity,
    recommendedQuantity:
      partial.recommendedQuantity === undefined ? 20 : partial.recommendedQuantity,
    lastStockConferenceAt: partial.lastStockConferenceAt ?? null,
    lastStockConferenceUserId: partial.lastStockConferenceUserId ?? null,
    stockConferenceVersion: 1,
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    status: partial.status ?? "ACTIVE",
  };
}

function matchesWhere(row: ReturnType<typeof makeRow>, where: Record<string, unknown>): boolean {
  const and = (where.AND as Record<string, unknown>[] | undefined) ?? [];
  for (const clause of and) {
    if (typeof clause.status === "string" && row.status !== clause.status) return false;

    if (Array.isArray(clause.OR)) {
      const ors = clause.OR as Record<string, unknown>[];
      const looksMissing = ors.some((o) => "contingencyQuantity" in o || "minimumQuantity" in o);
      const looksStale = ors.some((o) => "lastStockConferenceAt" in o);

      if (looksMissing) {
        const missing =
          row.contingencyQuantity == null ||
          row.minimumQuantity == null ||
          row.recommendedQuantity == null;
        if (!missing) return false;
      }

      if (looksStale) {
        const nullOk = ors.some((o) => o.lastStockConferenceAt === null);
        const lt = ors
          .map((o) => o.lastStockConferenceAt)
          .find(
            (v): v is { lt: Date } =>
              typeof v === "object" && v != null && "lt" in v
          );
        const stale =
          (nullOk && row.lastStockConferenceAt == null) ||
          (lt != null &&
            row.lastStockConferenceAt != null &&
            row.lastStockConferenceAt < lt.lt);
        if (!stale) return false;
      }
    }
  }
  return true;
}

function createMockPrisma(rows: ReturnType<typeof makeRow>[]) {
  return {
    material: {
      async count({ where }: { where: Record<string, unknown> }) {
        return rows.filter((r) => matchesWhere(r, where)).length;
      },
      async findMany(args: {
        where: Record<string, unknown>;
        skip?: number;
        take?: number;
      }) {
        let out = rows.filter((r) => matchesWhere(r, args.where));
        out = [...out].sort((a, b) => a.code.localeCompare(b.code));
        if (args.skip != null || args.take != null) {
          const skip = args.skip ?? 0;
          const take = args.take ?? out.length;
          out = out.slice(skip, skip + take);
        }
        return out.map(({ status: _status, ...rest }) => rest);
      },
    },
    appUser: {
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        return where.id.in.map((id) => ({
          id,
          name: id === "user-1" ? "Ana Silva" : null,
          email: `${id}@test.local`,
        }));
      },
    },
  } as any;
}

describe("materialStockTabletQuery", () => {
  it("default ACTIVE, pageSize limitado", () => {
    const q = parseMaterialStockTabletSearchQuery({});
    assert.equal(q.materialStatus, "ACTIVE");
    assert.equal(q.page, 1);
    assert.ok(q.pageSize <= MATERIAL_STOCK_TABLET_MAX_PAGE_SIZE);
    const big = parseMaterialStockTabletSearchQuery({ pageSize: "999" });
    assert.equal(big.pageSize, MATERIAL_STOCK_TABLET_MAX_PAGE_SIZE);
  });
});

describe("materialStockTabletTextMatches — acentos", () => {
  it("ignora maiúsculas e acentos", () => {
    assert.equal(
      materialStockTabletTextMatches("010.AA", "Cotovelo Registro", "cotovelo"),
      true
    );
    assert.equal(materialStockTabletTextMatches("010.AA", "José Aço", "jose"), true);
    assert.equal(materialStockTabletTextMatches("ABC", "Parafuso", "xyz"), false);
  });
});

describe("materialStockTabletSerialization", () => {
  it("serializa Decimal como number e parâmetros nulos", () => {
    const item = serializeMaterialStockTabletListItem(
      {
        id: "m1",
        code: "C1",
        description: "Desc",
        unit: "KG",
        quantity: { toString: () => "12.500000" },
        contingencyQuantity: null,
        minimumQuantity: null,
        recommendedQuantity: null,
        lastStockConferenceAt: null,
        lastStockConferenceUserId: null,
        stockConferenceVersion: 1,
        updatedAt: new Date("2026-07-28T10:00:00.000Z"),
      },
      new Map()
    );
    assert.equal(item.currentQuantity, 12.5);
    assert.equal(item.contingencyQuantity, null);
    assert.equal(item.stockStatus, "NAO_CONFIGURADO");
    assert.equal(
      assertNoCostLeakInTabletItem(item as unknown as Record<string, unknown>).length,
      0
    );
  });

  it("não inclui campos de custo", () => {
    const item = serializeMaterialStockTabletListItem(
      makeRow({ id: "1", code: "A", description: "B" }),
      new Map([["user-1", "Ana Silva"]])
    );
    for (const key of [
      "currentCost",
      "averageCost",
      "standardCost",
      "freight",
      "calculations",
      "supplier",
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, key), false);
    }
  });
});

describe("searchMaterialStockTablet", () => {
  const rows = [
    makeRow({
      id: "1",
      code: "010.AA",
      description: "Cotovelo José",
      quantity: 12,
      lastStockConferenceUserId: "user-1",
      lastStockConferenceAt: new Date("2026-07-20T00:00:00.000Z"),
    }),
    makeRow({
      id: "2",
      code: "020.BB",
      description: "Parafuso",
      status: "INACTIVE",
      quantity: 0,
    }),
    makeRow({
      id: "3",
      code: "030.CC",
      description: "Arruela",
      quantity: 3,
      contingencyQuantity: 5,
      minimumQuantity: 10,
      recommendedQuantity: 20,
    }),
    makeRow({
      id: "4",
      code: "040.DD",
      description: "Sem níveis",
      contingencyQuantity: null,
      minimumQuantity: null,
      recommendedQuantity: null,
    }),
  ];

  it("material ativo aparece; inativo não aparece por padrão", async () => {
    const db = createMockPrisma(rows);
    const result = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({}),
      new Date("2026-07-28T00:00:00.000Z")
    );
    const codes = result.rows.map((r) => r.code);
    assert.ok(codes.includes("010.AA"));
    assert.ok(!codes.includes("020.BB"));
  });

  it("busca por código e descrição (parcial / acento)", async () => {
    const db = createMockPrisma(rows);
    const byCode = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({ q: "010" }),
      new Date("2026-07-28T00:00:00.000Z")
    );
    assert.equal(byCode.rows.length, 1);
    assert.equal(byCode.rows[0]?.code, "010.AA");

    const byDesc = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({ q: "jose" }),
      new Date("2026-07-28T00:00:00.000Z")
    );
    assert.equal(byDesc.rows.length, 1);
    assert.equal(byDesc.rows[0]?.description, "Cotovelo José");
  });

  it("paginação", async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      makeRow({
        id: String(i),
        code: `1${i}.CODE`,
        description: `Item ${i}`,
      })
    );
    const db = createMockPrisma(many);
    const page1 = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({ page: "1", pageSize: "2" })
    );
    assert.equal(page1.rows.length, 2);
    assert.equal(page1.total, 5);
    assert.equal(page1.totalPages, 3);
    const page2 = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({ page: "2", pageSize: "2" })
    );
    assert.equal(page2.rows.length, 2);
    assert.notEqual(page1.rows[0]?.id, page2.rows[0]?.id);
  });

  it("filtro missingLevels e stockStatus", async () => {
    const db = createMockPrisma(rows);
    const missing = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({ missingLevels: "true" })
    );
    assert.ok(missing.rows.every((r) => r.code === "040.DD"));

    const emerg = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({ stockStatus: "EMERGENCIA" })
    );
    assert.ok(emerg.rows.some((r) => r.code === "030.CC"));
    assert.ok(emerg.rows.every((r) => r.stockStatus === "EMERGENCIA"));
  });

  it("filtro sem conferência recente", async () => {
    const db = createMockPrisma(rows);
    const stale = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({ staleConference: "true", staleDays: "7" }),
      new Date("2026-07-28T00:00:00.000Z")
    );
    const codes = stale.rows.map((r) => r.code);
    // 010 conferido em 20/07 — dentro de 7 dias a partir de 28/07? 20 to 28 = 8 days → stale
    assert.ok(codes.includes("010.AA"));
    assert.ok(codes.includes("030.CC"));
    assert.ok(codes.includes("040.DD"));
  });

  it("responsável resumido e versão/updatedAt", async () => {
    const db = createMockPrisma(rows);
    const result = await searchMaterialStockTablet(
      db,
      parseMaterialStockTabletSearchQuery({ q: "010" })
    );
    const row = result.rows[0];
    assert.ok(row);
    assert.equal(row.lastStockConferenceUser?.name, "Ana Silva");
    assert.equal(row.stockConferenceVersion, 1);
    assert.ok(row.updatedAt);
  });
});

describe("materialStockTablet — wiring e isolamento", () => {
  it("server registra rota aditiva com engineering.materials view", () => {
    const server = readFileSync(join(root, "server.ts"), "utf8");
    assert.match(server, /registerMaterialStockTabletRoutes/);
    const routes = readFileSync(join(root, "src/lib/materialStockTabletRoutes.ts"), "utf8");
    assert.match(routes, /ENGINEERING_RESOURCE_KEYS\.materials/);
    assert.match(routes, /MATERIAL_STOCK_TABLET_SEARCH_PATH/);
    const types = readFileSync(join(root, "src/lib/materialStockTabletTypes.ts"), "utf8");
    assert.match(types, /\/api\/materials\/stock-tablet\/search/);
  });

  it("serviço não seleciona campos de custo", () => {
    const src = readFileSync(join(root, "src/lib/materialStockTablet.server.ts"), "utf8");
    assert.doesNotMatch(src, /currentCost|averageCost|standardCost|freight|standardLoss/);
    assert.doesNotMatch(src, /MaterialPriceHistory|ProductBOM|MaterialMarketQuote/);
  });
});
