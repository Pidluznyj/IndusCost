import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  buildInventoryBalanceReport,
  inventoryBalanceReportFilename,
  inventoryBalanceReportNotes,
  type InventoryBalanceReportSourceLine,
} from "./inventoryBalanceReport.js";
import {
  buildCatalogZeroItemsWhere,
  buildInventoryBalancesWhere,
  buildInventoryItemWhereFromBalanceQuery,
  canIncludeCatalogZeroItems,
  loadInventoryBalanceReport,
} from "./inventoryBalanceReport.server.js";
import {
  buildInventoryBalanceReportXlsx,
  excelSerialFromIso,
  INVENTORY_BALANCE_REPORT_COLUMNS,
  INVENTORY_BALANCE_REPORT_SHEETS,
} from "./inventoryBalanceReportXlsx.js";
import {
  parseInventoryBalanceReportQuery,
  parseInventoryBalancesListQuery,
  parseInventoryFamilyList,
} from "./inventoryListQuery.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const line = (
  itemId: string,
  code: string,
  physicalQuantity: number,
  lastMovementAt: string | null = null,
  extra: Partial<InventoryBalanceReportSourceLine> = {}
): InventoryBalanceReportSourceLine => ({
  itemId,
  code,
  description: `Item ${code}`,
  unit: "UN",
  itemType: "ADMINISTRATIVE_SUPPLY",
  physicalQuantity,
  lastMovementAt: lastMovementAt ? new Date(lastMovementAt) : null,
  ...extra,
});

const GENERATED_AT = new Date("2026-10-13T15:00:00.000Z");

function sampleReport() {
  return buildInventoryBalanceReport({
    generatedAt: GENERATED_AT,
    lines: [
      line("a", "ADM-0001", 5, "2026-10-01T12:00:00.000Z"),
      line("b", "ADM-0002", 120.5, "2026-09-20T12:00:00.000Z", { unit: "KG" }),
      // Mesmo item em dois almoxarifados: soma o saldo e vale o movimento mais recente.
      line("b", "ADM-0002", 30.25, "2026-10-05T18:30:00.000Z", { unit: "KG" }),
      line("c", "ADM-0003", 0),
      line("d", "EPI-001", -2, null, { itemType: "PPE" }),
      line("e", "ADM-0010", 5),
    ],
    lastCountAtByItemId: new Map([["b", new Date("2026-10-02T13:15:00.000Z")]]),
    filters: [{ label: "Almoxarifado", value: "ALM — Central" }],
  });
}

describe("inventory balance report", () => {
  it("uma linha por item, do maior saldo para o menor, com desempate por código", () => {
    const report = sampleReport();
    assert.deepEqual(
      report.rows.map((row) => [row.itemCode, row.physicalQuantity]),
      [
        ["ADM-0002", 150.75],
        ["ADM-0001", 5],
        ["ADM-0010", 5],
        ["ADM-0003", 0],
        ["EPI-001", -2],
      ]
    );
    assert.equal(report.itemCount, 5);
    assert.equal(report.zeroItems, 1);
    assert.equal(report.negativeItems, 1);
  });

  it("traz unidade, tipo e as datas da última contagem e movimentação", () => {
    const [top, second] = sampleReport().rows;
    assert.equal(top.unit, "KG");
    assert.equal(top.itemTypeLabel, "Suprimento administrativo");
    assert.equal(top.lastMovementAt, "2026-10-05T18:30:00.000Z");
    assert.equal(top.lastCountAt, "2026-10-02T13:15:00.000Z");
    assert.equal(second.lastCountAt, null);
    assert.equal(sampleReport().rows[3].lastMovementAt, null);
  });

  it("sem filtro informa que todos os itens com saldo entram", () => {
    const report = buildInventoryBalanceReport({
      generatedAt: GENERATED_AT,
      lines: [],
      lastCountAtByItemId: new Map(),
    });
    assert.equal(report.rows.length, 0);
    assert.equal(report.filters.length, 1);
    assert.match(report.filters[0].value, /Todos os itens/);
    assert.equal(inventoryBalanceReportFilename(report.generatedAt), "saldos-estoque-2026-10-13.xlsx");
  });
});

describe("inventory balance report — planilha", () => {
  it("data vira número de série do Excel no horário de Brasília", () => {
    // 2026-10-05 18:30 UTC = 15:30 em Brasília.
    const serial = excelSerialFromIso("2026-10-05T18:30:00.000Z");
    assert.ok(serial != null);
    assert.ok(Math.abs(serial - (Date.UTC(2026, 9, 5, 15, 30) / 86_400_000 + 25_569)) < 1e-5);
    assert.equal(excelSerialFromIso("não é data"), null);
  });

  it("gera xlsx legível com as colunas, a ordem e os valores do relatório", async () => {
    const report = sampleReport();
    const workbook = XLSX.read(await buildInventoryBalanceReportXlsx(report), { type: "buffer" });
    assert.deepEqual(workbook.SheetNames, [...INVENTORY_BALANCE_REPORT_SHEETS]);

    const sheet = workbook.Sheets[INVENTORY_BALANCE_REPORT_SHEETS[0]];
    const grid = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, raw: true, defval: "" });
    assert.equal(grid[0][0], "Saldos de estoque");
    assert.match(String(grid[2][0]), /Almoxarifado: ALM — Central/);
    assert.deepEqual(grid[4], [...INVENTORY_BALANCE_REPORT_COLUMNS]);
    assert.deepEqual(grid[5].slice(0, 5), ["ADM-0002", "Item ADM-0002", "Suprimento administrativo", "KG", 150.75]);
    assert.equal(sheet.E6.t, "n");
    assert.equal(sheet.F6.t, "n");
    assert.equal(sheet.F6.w, "02/10/2026 10:15");
    assert.equal(sheet.G6.w, "05/10/2026 15:30");
    assert.equal(grid[6][5], "—");
    assert.match(String(grid[10][0]), /5 itens .* 1 zerados .* 1 negativos/);
  });

  it("planilha sai formatada: congelamento, filtro, cabeçalho repetido na impressão e estilos", async () => {
    const zip = await JSZip.loadAsync(await buildInventoryBalanceReportXlsx(sampleReport()));
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    assert.match(sheet, /<pane ySplit="5"[^>]*state="frozen"/);
    assert.match(sheet, /<autoFilter ref="A5:G10"\/>/);
    assert.match(sheet, /fitToWidth="1"/);
    const workbook = await zip.file("xl/workbook.xml")!.async("string");
    assert.match(workbook, /_xlnm\.Print_Titles[^>]*>'Saldos'!\$5:\$5</);
    const styles = await zip.file("xl/styles.xml")!.async("string");
    assert.match(styles, /<cellXfs count="17">/);
    assert.equal((styles.match(/<xf xfId="0"/g) ?? []).length, 17);
    assert.match(styles, /FF0F2744/);
  });

  it("texto com caracteres especiais não quebra o XML", async () => {
    const report = buildInventoryBalanceReport({
      generatedAt: GENERATED_AT,
      lines: [line("x", "A&B<1>", 1, null, { description: 'Parafuso 1/4" <inox> & porca\u0001' })],
      lastCountAtByItemId: new Map(),
    });
    const workbook = XLSX.read(await buildInventoryBalanceReportXlsx(report), { type: "buffer" });
    const sheet = workbook.Sheets[INVENTORY_BALANCE_REPORT_SHEETS[0]];
    assert.equal(sheet.A6.v, "A&B<1>");
    assert.equal(sheet.B6.v, 'Parafuso 1/4" <inox> & porca');
  });
});

describe("inventory balance report — carga", () => {
  it("usa os filtros da tela, soma por item e data a última contagem não cancelada", async () => {
    const calls: Record<string, unknown> = {};
    const db = {
      inventoryBalance: {
        findMany: async (args: unknown) => {
          calls.balance = args;
          const item = (id: string, code: string, minimumStock: number | null) => ({
            id,
            code,
            description: `Item ${code}`,
            unit: "UN",
            itemType: "PPE",
            minimumStock,
            reorderPoint: null,
          });
          return [
            { physicalQuantity: "4", availableQuantity: "4", lastMovementAt: new Date("2026-10-01T10:00:00Z"), item: item("i1", "EPI-001", 10) },
            { physicalQuantity: "50", availableQuantity: "50", lastMovementAt: null, item: item("i2", "EPI-002", 10) },
            { physicalQuantity: "1", availableQuantity: "1", lastMovementAt: null, item: item("i3", "EPI-003", null) },
          ];
        },
      },
      inventoryCountLine: {
        findMany: async (args: unknown) => {
          calls.count = args;
          return [
            { itemId: "i1", updatedAt: new Date("2026-09-01T10:00:00Z"), currentObservation: null },
            { itemId: "i1", updatedAt: new Date("2026-09-30T10:00:00Z"), currentObservation: { observedAt: new Date("2026-09-15T10:00:00Z") } },
          ];
        },
      },
      inventoryWarehouse: { findUnique: async () => ({ code: "ALM", name: "Central" }) },
      inventoryLocation: { findUnique: async () => null },
      inventoryItem: { findUnique: async () => null },
    };

    const q = parseInventoryBalancesListQuery({ itemType: "PPE", warehouseId: "w1", belowMinimum: "true" });
    const report = await loadInventoryBalanceReport(db as never, q, GENERATED_AT);

    // Abaixo do mínimo: só o item com disponível < mínimo cadastrado.
    assert.deepEqual(report.rows.map((row) => row.itemCode), ["EPI-001"]);
    assert.equal(report.rows[0].lastCountAt, "2026-09-15T10:00:00.000Z");
    assert.deepEqual(report.filters, [
      { label: "Tipo", value: "EPI" },
      { label: "Almoxarifado", value: "ALM — Central" },
      { label: "Somente", value: "Abaixo do mínimo" },
    ]);
    assert.deepEqual((calls.balance as { where: unknown }).where, buildInventoryBalancesWhere(q));
    const countWhere = (calls.count as { where: Record<string, unknown> }).where;
    assert.deepEqual(countWhere.itemId, { in: ["i1"] });
    assert.deepEqual(countWhere.session, { status: { not: "CANCELED" } });
    assert.equal(countWhere.warehouseId, "w1");
  });

  it("rotas do relatório exigem permissão de consulta e a aba Saldos envia os filtros", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /app\.get\("\/api\/inventory\/balances\/report", \.\.\.view/);
    assert.match(routes, /app\.get\("\/api\/inventory\/balances\/report\.xlsx", \.\.\.view/);
    assert.match(routes, /parseInventoryBalanceReportQuery/);
    const tab = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(tab, /\/api\/inventory\/balances\/report\.xlsx\?\$\{reportQuery\}/);
    assert.match(tab, /\/inventory\/balances\/report\/print/);
    assert.match(tab, /inventory-balances-report-panel/);
    assert.match(tab, /inventory-balances-report-zero-mode/);
    assert.match(tab, /Somente itens com saldo/);
    assert.match(tab, /Todos os itens, incluindo zerados/);
    assert.match(tab, /Extrair Excel/);
    assert.match(tab, /A consulta desta tela/);
    assert.match(tab, /InventoryFamilyMultiSelect/);
    assert.match(tab, /q\.append\("families", name\)/);
    assert.match(tab, /\/api\/inventory\/items\/families/);
    assert.match(read("src/App.tsx"), /path="\/inventory\/balances\/report\/print"/);
  });

  it("CSV operacional permanece no contrato por local e ignora zeroBalanceMode", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    const start = routes.indexOf('app.get("/api/inventory/balances/export"');
    const end = routes.indexOf('app.post("/api/inventory/balances/rebuild"');
    const handler = routes.slice(start, end === -1 ? undefined : end);
    const preamble = routes.slice(Math.max(0, start - 500), start);
    assert.match(handler, /parseInventoryBalancesListQuery/);
    assert.doesNotMatch(handler, /parseInventoryBalanceReportQuery/);
    assert.match(preamble, /zeroBalanceMode/);
    const tab = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(tab, /inventory-balances-export-link/);
    assert.match(tab, /Não usa o seletor de zerados/);
  });

  it("carga do relatório não grava saldo nem movimento", () => {
    const server = read("src/lib/inventory/inventoryBalanceReport.server.ts");
    assert.doesNotMatch(server, /inventoryBalance\.(create|update|upsert|delete)/);
    assert.doesNotMatch(server, /inventoryMovement\.(create|update|upsert|delete)/);
    assert.doesNotMatch(server, /inventoryItem\.(create|update|upsert|delete)/);
  });
});

describe("inventory balance report — zeroBalanceMode", () => {
  it("API sem parâmetro permanece legado: zerados registrados entram, cadastro sem saldo não", () => {
    const omitted = parseInventoryBalanceReportQuery({ warehouseId: "w1" });
    const empty = parseInventoryBalanceReportQuery({});
    const unknown = parseInventoryBalanceReportQuery({ zeroBalanceMode: "all" });
    assert.equal(omitted.zeroBalanceMode, "legacy");
    assert.equal(empty.zeroBalanceMode, "legacy");
    assert.equal(unknown.zeroBalanceMode, "legacy");
    assert.equal(parseInventoryBalanceReportQuery({ zeroBalanceMode: "nonzero" }).zeroBalanceMode, "nonzero");
    assert.equal(
      parseInventoryBalanceReportQuery({ zeroBalanceMode: "including_zero" }).zeroBalanceMode,
      "including_zero"
    );
    assert.match(inventoryBalanceReportNotes("legacy").join(" "), /não aparecem/);
  });

  it("nonzero exclui zero registrado e soma consolidada zero, preserva positivo e negativo", () => {
    const report = buildInventoryBalanceReport({
      generatedAt: GENERATED_AT,
      zeroBalanceMode: "nonzero",
      lines: [
        line("pos", "ADM-POS", 12),
        line("zero", "ADM-ZERO", 0),
        line("neg", "ADM-NEG", -4),
        line("net", "ADM-NET0", 8),
        line("net", "ADM-NET0", -8),
      ],
      lastCountAtByItemId: new Map(),
    });
    assert.deepEqual(
      report.rows.map((row) => [row.itemCode, row.physicalQuantity]),
      [
        ["ADM-POS", 12],
        ["ADM-NEG", -4],
      ]
    );
    assert.equal(report.zeroItems, 0);
    assert.equal(report.filters.at(-1)?.value, "somente itens com saldo");
  });

  it("including_zero mantém positivo, negativo, zero registrado e soma consolidada zero", () => {
    const report = buildInventoryBalanceReport({
      generatedAt: GENERATED_AT,
      zeroBalanceMode: "including_zero",
      lines: [
        line("pos", "ADM-POS", 12),
        line("zero", "ADM-ZERO", 0),
        line("neg", "ADM-NEG", -4),
        line("net", "ADM-NET0", 8),
        line("net", "ADM-NET0", -8),
        line("cat", "ADM-NEW", 0, null, { description: "Grampeador novo" }),
      ],
      lastCountAtByItemId: new Map([["cat", new Date("2026-10-01T10:00:00.000Z")]]),
    });
    assert.deepEqual(
      report.rows.map((row) => [row.itemCode, row.physicalQuantity]),
      [
        ["ADM-POS", 12],
        ["ADM-NET0", 0],
        ["ADM-NEW", 0],
        ["ADM-ZERO", 0],
        ["ADM-NEG", -4],
      ]
    );
    assert.equal(report.zeroItems, 3);
    assert.equal(report.rows.find((row) => row.itemCode === "ADM-NEW")?.description, "Grampeador novo");
    assert.equal(report.rows.find((row) => row.itemCode === "ADM-NEW")?.lastCountAt, "2026-10-01T10:00:00.000Z");
    assert.equal(report.filters.at(-1)?.value, "incluindo itens zerados");
    assert.match(report.notes.join(" "), /itens cadastrados sem registro de saldo/);
  });
});

type CatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
  itemType: string;
  status: "ACTIVE" | "INACTIVE";
  family: string | null;
  group: string | null;
  controlsStock: boolean;
  defaultWarehouseId: string | null;
  minimumStock: number | null;
  reorderPoint: number | null;
};

type BalanceRec = {
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  physicalQuantity: string;
  availableQuantity: string;
  reservedQuantity: string;
  blockedQuantity: string;
  quarantineQuantity: string;
  lastMovementAt: Date | null;
};

const WH_ADM = "wh-adm";
const WH_IND = "wh-ind";
const LOC_A = "loc-a";
const LOC_B = "loc-b";

function catalogItem(partial: Partial<CatalogItem> & Pick<CatalogItem, "id" | "code">): CatalogItem {
  return {
    description: `Item ${partial.code}`,
    unit: "UN",
    itemType: "ADMINISTRATIVE_SUPPLY",
    status: "ACTIVE",
    family: "Escritório",
    group: "Papelaria",
    controlsStock: true,
    defaultWarehouseId: WH_ADM,
    minimumStock: null,
    reorderPoint: null,
    ...partial,
  };
}

function balanceRec(
  itemId: string,
  physical: number,
  extra: Partial<BalanceRec> = {}
): BalanceRec {
  return {
    itemId,
    warehouseId: WH_ADM,
    locationId: LOC_A,
    physicalQuantity: String(physical),
    availableQuantity: String(physical),
    reservedQuantity: "0",
    blockedQuantity: "0",
    quarantineQuantity: "0",
    lastMovementAt: physical === 0 ? null : new Date("2026-10-01T12:00:00.000Z"),
    ...extra,
  };
}

function containsInsensitive(value: string | null, clause: unknown): boolean {
  if (!clause || typeof clause !== "object" || !("contains" in clause)) return true;
  const needle = String((clause as { contains?: string }).contains ?? "").toLowerCase();
  return (value ?? "").toLowerCase().includes(needle);
}

function familyMatches(value: string | null, clause: unknown): boolean {
  if (!clause || typeof clause !== "object") return true;
  if ("in" in clause && Array.isArray((clause as { in: unknown }).in)) {
    const set = new Set(
      (clause as { in: string[] }).in.map((name) => String(name).toLocaleLowerCase("pt-BR"))
    );
    return set.has((value ?? "").toLocaleLowerCase("pt-BR"));
  }
  return containsInsensitive(value, clause);
}

function itemMatchesWhere(item: CatalogItem, where: Record<string, unknown>): boolean {
  if (where.controlsStock === true && !item.controlsStock) return false;
  if (typeof where.id === "string" && item.id !== where.id) return false;
  if (where.itemType && item.itemType !== where.itemType) return false;
  if (where.status && item.status !== where.status) return false;
  if (where.defaultWarehouseId && item.defaultWarehouseId !== where.defaultWarehouseId) return false;
  if (where.family && !familyMatches(item.family, where.family)) return false;
  if (where.group && !containsInsensitive(item.group, where.group)) return false;
  if (Array.isArray(where.OR)) {
    const ok = where.OR.some((entry: { code?: unknown; description?: unknown }) => {
      if (entry.code) return containsInsensitive(item.code, entry.code);
      if (entry.description) return containsInsensitive(item.description, entry.description);
      return false;
    });
    if (!ok) return false;
  }
  return true;
}

function qtyGtZero(value: string, clause: unknown): boolean {
  if (!clause || typeof clause !== "object" || !("gt" in clause)) return true;
  return Number(value) > Number((clause as { gt: number }).gt);
}

function qtyLtZero(value: string, clause: unknown): boolean {
  if (!clause || typeof clause !== "object" || !("lt" in clause)) return true;
  return Number(value) < Number((clause as { lt: number }).lt);
}

function createReportFixtureDb() {
  const items: CatalogItem[] = [
    catalogItem({ id: "i-new", code: "ADM-NEW", description: "Grampeador novo" }),
    catalogItem({ id: "i-fresh", code: "ADM-FRESH", description: "Item administrativo recém-cadastrado" }),
    catalogItem({ id: "i-pos", code: "ADM-POS" }),
    catalogItem({ id: "i-zero", code: "ADM-ZERO" }),
    catalogItem({ id: "i-neg", code: "ADM-NEG" }),
    catalogItem({ id: "i-multi", code: "ADM-MULTI" }),
    catalogItem({ id: "i-net0", code: "ADM-NET0" }),
    catalogItem({
      id: "i-ind",
      code: "IND-ONLY",
      itemType: "RAW_MATERIAL",
      family: "Insumos",
      group: "Metais",
      defaultWarehouseId: WH_IND,
    }),
    catalogItem({
      id: "i-ind-cat",
      code: "IND-CAT",
      itemType: "RAW_MATERIAL",
      family: "Insumos",
      group: "Metais",
      defaultWarehouseId: WH_IND,
    }),
    catalogItem({
      id: "i-ppe",
      code: "EPI-001",
      itemType: "PPE",
      family: "EPI",
      group: "Proteção",
    }),
    catalogItem({ id: "i-old", code: "ADM-OLD", status: "INACTIVE" }),
    catalogItem({ id: "i-nocontrol", code: "ADM-OFF", controlsStock: false }),
  ];
  const balances: BalanceRec[] = [
    balanceRec("i-pos", 10),
    balanceRec("i-zero", 0, { lastMovementAt: new Date("2026-09-01T12:00:00.000Z") }),
    balanceRec("i-neg", -3),
    balanceRec("i-multi", 4, { locationId: LOC_A }),
    balanceRec("i-multi", 6, { locationId: LOC_B, lastMovementAt: new Date("2026-10-05T12:00:00.000Z") }),
    balanceRec("i-net0", 5, { locationId: LOC_A }),
    balanceRec("i-net0", -5, { locationId: LOC_B }),
    balanceRec("i-ind", 8, { warehouseId: WH_IND, locationId: null }),
    balanceRec("i-ppe", 2),
  ];
  const calls: { itemFindMany?: unknown; mutations: string[] } = { mutations: [] };

  const itemsById = new Map(items.map((item) => [item.id, item]));

  return {
    calls,
    db: {
      inventoryBalance: {
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          balances
            .filter((row) => {
              if (where.itemId && row.itemId !== where.itemId) return false;
              if (where.warehouseId && row.warehouseId !== where.warehouseId) return false;
              if (where.locationId && row.locationId !== where.locationId) return false;
              if (where.reservedQuantity && !qtyGtZero(row.reservedQuantity, where.reservedQuantity)) return false;
              if (where.blockedQuantity && !qtyGtZero(row.blockedQuantity, where.blockedQuantity)) return false;
              if (where.quarantineQuantity && !qtyGtZero(row.quarantineQuantity, where.quarantineQuantity)) {
                return false;
              }
              if (Array.isArray(where.OR)) {
                const ok = where.OR.some((entry: { physicalQuantity?: unknown; availableQuantity?: unknown }) => {
                  if (entry.physicalQuantity) return qtyLtZero(row.physicalQuantity, entry.physicalQuantity);
                  if (entry.availableQuantity) return qtyLtZero(row.availableQuantity, entry.availableQuantity);
                  return false;
                });
                if (!ok) return false;
              }
              const item = itemsById.get(row.itemId);
              if (!item) return false;
              if (where.item && !itemMatchesWhere(item, where.item as Record<string, unknown>)) return false;
              return true;
            })
            .map((row) => {
              const item = itemsById.get(row.itemId)!;
              return {
                physicalQuantity: row.physicalQuantity,
                availableQuantity: row.availableQuantity,
                lastMovementAt: row.lastMovementAt,
                item: {
                  id: item.id,
                  code: item.code,
                  description: item.description,
                  unit: item.unit,
                  itemType: item.itemType,
                  minimumStock: item.minimumStock,
                  reorderPoint: item.reorderPoint,
                },
              };
            }),
        create: async () => {
          calls.mutations.push("balance.create");
        },
        update: async () => {
          calls.mutations.push("balance.update");
        },
      },
      inventoryCountLine: {
        findMany: async () => [
          {
            itemId: "i-new",
            updatedAt: new Date("2026-10-02T08:00:00.000Z"),
            currentObservation: { observedAt: new Date("2026-10-02T08:00:00.000Z") },
          },
        ],
      },
      inventoryWarehouse: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === WH_ADM
            ? { code: "ADMINISTRATIVO", name: "Estoque Administrativo" }
            : { code: "INDUSTRIAL", name: "Industrial" },
      },
      inventoryLocation: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === LOC_A ? { code: "A01", name: "Sala" } : { code: "B01", name: "Armário" },
      },
      inventoryItem: {
        findUnique: async ({ where }: { where: { id: string } }) => itemsById.get(where.id) ?? null,
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          calls.itemFindMany = where;
          return items.filter((item) => itemMatchesWhere(item, where));
        },
        create: async () => {
          calls.mutations.push("item.create");
        },
      },
    },
  };
}

describe("inventory balance report — catálogo sem saldo", () => {
  it("incluindo zerados traz cadastro ativo sem InventoryBalance no almoxarifado filtrado", async () => {
    const { db, calls } = createReportFixtureDb();
    const q = parseInventoryBalanceReportQuery({
      warehouseId: WH_ADM,
      status: "ACTIVE",
      zeroBalanceMode: "including_zero",
    });
    const report = await loadInventoryBalanceReport(db as never, q, GENERATED_AT);
    const codes = report.rows.map((row) => row.itemCode);

    assert.ok(codes.includes("ADM-NEW"));
    assert.ok(codes.includes("ADM-FRESH"));
    assert.ok(codes.includes("ADM-POS"));
    assert.ok(codes.includes("ADM-ZERO"));
    assert.ok(codes.includes("ADM-NEG"));
    assert.ok(codes.includes("ADM-MULTI"));
    assert.ok(codes.includes("ADM-NET0"));
    assert.ok(codes.includes("EPI-001"));
    assert.ok(!codes.includes("IND-ONLY"));
    assert.ok(!codes.includes("IND-CAT"));
    assert.ok(!codes.includes("ADM-OLD"));
    assert.ok(!codes.includes("ADM-OFF"));
    assert.equal(codes.filter((code) => code === "ADM-MULTI").length, 1);
    assert.equal(report.rows.find((row) => row.itemCode === "ADM-MULTI")?.physicalQuantity, 10);
    assert.equal(report.rows.find((row) => row.itemCode === "ADM-NEW")?.physicalQuantity, 0);
    assert.equal(report.rows.find((row) => row.itemCode === "ADM-NEW")?.lastMovementAt, null);
    assert.equal(report.rows.find((row) => row.itemCode === "ADM-NEW")?.lastCountAt, "2026-10-02T08:00:00.000Z");
    assert.equal(report.rows.find((row) => row.itemCode === "ADM-FRESH")?.lastCountAt, null);
    assert.equal(report.filters.find((filter) => filter.label === "Saldos")?.value, "incluindo itens zerados");
    assert.deepEqual(calls.itemFindMany, buildCatalogZeroItemsWhere(q));
    assert.deepEqual(calls.mutations, []);
  });

  it("legado e somente com saldo não incluem item sem InventoryBalance", async () => {
    const { db, calls } = createReportFixtureDb();
    const legacy = await loadInventoryBalanceReport(
      db as never,
      parseInventoryBalanceReportQuery({ warehouseId: WH_ADM, status: "ACTIVE" }),
      GENERATED_AT
    );
    const nonzero = await loadInventoryBalanceReport(
      db as never,
      parseInventoryBalanceReportQuery({
        warehouseId: WH_ADM,
        status: "ACTIVE",
        zeroBalanceMode: "nonzero",
      }),
      GENERATED_AT
    );

    assert.ok(!legacy.rows.some((row) => row.itemCode === "ADM-NEW"));
    assert.ok(legacy.rows.some((row) => row.itemCode === "ADM-ZERO"));
    assert.ok(legacy.rows.some((row) => row.itemCode === "ADM-NET0"));
    assert.equal(calls.itemFindMany, undefined);

    const nonzeroCodes = nonzero.rows.map((row) => row.itemCode);
    assert.deepEqual(
      nonzeroCodes.sort(),
      ["ADM-MULTI", "ADM-NEG", "ADM-POS", "EPI-001"].sort()
    );
    assert.ok(!nonzeroCodes.includes("ADM-ZERO"));
    assert.ok(!nonzeroCodes.includes("ADM-NET0"));
    assert.ok(!nonzeroCodes.includes("ADM-NEW"));
  });

  it("multi-select de famílias filtra consulta e relatório e prevalece sobre contains", async () => {
    assert.deepEqual(parseInventoryFamilyList(["EPI", "Insumos", "epi", "  ", "Aço, carbono"]), [
      "EPI",
      "Insumos",
      "Aço, carbono",
    ]);
    assert.deepEqual(parseInventoryFamilyList("Aço, carbono"), ["Aço, carbono"]);
    assert.deepEqual(parseInventoryFamilyList(undefined), []);

    const parsed = parseInventoryBalancesListQuery({
      family: "Escrit",
      families: ["EPI", "Insumos"],
    });
    assert.deepEqual(parsed.families, ["EPI", "Insumos"]);
    assert.equal(parsed.family, "Escrit");
    assert.deepEqual(buildInventoryItemWhereFromBalanceQuery(parsed).family, {
      in: ["EPI", "Insumos"],
      mode: "insensitive",
    });
    assert.deepEqual(
      buildInventoryItemWhereFromBalanceQuery(parseInventoryBalancesListQuery({ family: "Escrit" })).family,
      { contains: "Escrit", mode: "insensitive" }
    );

    const { db } = createReportFixtureDb();
    const report = await loadInventoryBalanceReport(
      db as never,
      parseInventoryBalanceReportQuery({
        families: ["EPI", "Insumos"],
        zeroBalanceMode: "nonzero",
      }),
      GENERATED_AT
    );
    assert.deepEqual(
      report.rows.map((row) => row.itemCode),
      ["IND-ONLY", "EPI-001"]
    );
    assert.deepEqual(
      report.filters.find((filter) => filter.label === "Famílias"),
      { label: "Famílias", value: "EPI · Insumos" }
    );
    assert.ok(!report.filters.some((filter) => filter.label === "Família"));
  });

  it("respeita tipo, família e grupo no modo completo", async () => {
    const { db } = createReportFixtureDb();
    const report = await loadInventoryBalanceReport(
      db as never,
      parseInventoryBalanceReportQuery({
        warehouseId: WH_ADM,
        status: "ACTIVE",
        itemType: "PPE",
        family: "EPI",
        group: "Proteção",
        zeroBalanceMode: "including_zero",
      }),
      GENERATED_AT
    );
    assert.deepEqual(
      report.rows.map((row) => row.itemCode),
      ["EPI-001"]
    );
  });

  it("filtro de local não inventa endereço para item sem saldo", async () => {
    const { db, calls } = createReportFixtureDb();
    const q = parseInventoryBalanceReportQuery({
      warehouseId: WH_ADM,
      locationId: LOC_A,
      status: "ACTIVE",
      zeroBalanceMode: "including_zero",
    });
    assert.equal(canIncludeCatalogZeroItems(q), false);
    const report = await loadInventoryBalanceReport(db as never, q, GENERATED_AT);
    assert.equal(calls.itemFindMany, undefined);
    assert.ok(!report.rows.some((row) => row.itemCode === "ADM-NEW"));
    assert.ok(report.rows.some((row) => row.itemCode === "ADM-POS"));
  });

  it("reserva, bloqueio, quarentena, negativo e abaixo do mínimo não aceitam zero virtual", async () => {
    const flags = ["hasReservation", "hasBlocked", "hasQuarantine", "negativeStock", "belowMinimum"] as const;
    for (const flag of flags) {
      const q = parseInventoryBalanceReportQuery({
        warehouseId: WH_ADM,
        [flag]: "true",
        zeroBalanceMode: "including_zero",
      });
      assert.equal(canIncludeCatalogZeroItems(q), false, flag);
    }
    const { db, calls } = createReportFixtureDb();
    const report = await loadInventoryBalanceReport(
      db as never,
      parseInventoryBalanceReportQuery({
        warehouseId: WH_ADM,
        negativeStock: "true",
        zeroBalanceMode: "including_zero",
      }),
      GENERATED_AT
    );
    assert.equal(calls.itemFindMany, undefined);
    assert.ok(report.rows.every((row) => row.physicalQuantity < 0 || row.itemCode === "ADM-NET0" || row.itemCode === "ADM-NEG"));
    assert.ok(!report.rows.some((row) => row.itemCode === "ADM-NEW"));
  });

  it("XLS e PDF consomem a mesma população consolidada", async () => {
    const { db } = createReportFixtureDb();
    const report = await loadInventoryBalanceReport(
      db as never,
      parseInventoryBalanceReportQuery({
        warehouseId: WH_ADM,
        status: "ACTIVE",
        zeroBalanceMode: "including_zero",
      }),
      GENERATED_AT
    );
    const workbook = XLSX.read(await buildInventoryBalanceReportXlsx(report), { type: "buffer" });
    const sheet = workbook.Sheets[INVENTORY_BALANCE_REPORT_SHEETS[0]];
    const grid = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, raw: true, defval: "" });
    const xlsCodes = grid
      .slice(5, 5 + report.rows.length)
      .map((row) => String(row[0]));
    assert.deepEqual(xlsCodes, report.rows.map((row) => row.itemCode));
    assert.match(String(grid[2][0]), /Saldos: incluindo itens zerados/);

    const print = read("src/components/inventory/InventoryBalanceReportPrintDocument.tsx");
    assert.match(print, /report\.rows\.map/);
    assert.match(print, /report\.filters\.map/);
    assert.match(print, /report\.notes\.map/);
    assert.match(print, /Nenhum item para os filtros informados/);
  });
});
