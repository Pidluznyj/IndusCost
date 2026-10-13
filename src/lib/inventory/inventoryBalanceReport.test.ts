import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  buildInventoryBalanceReport,
  inventoryBalanceReportFilename,
  type InventoryBalanceReportSourceLine,
} from "./inventoryBalanceReport.js";
import {
  buildInventoryBalancesWhere,
  loadInventoryBalanceReport,
} from "./inventoryBalanceReport.server.js";
import {
  buildInventoryBalanceReportXlsx,
  excelSerialFromIso,
  INVENTORY_BALANCE_REPORT_COLUMNS,
  INVENTORY_BALANCE_REPORT_SHEETS,
} from "./inventoryBalanceReportXlsx.js";
import { parseInventoryBalancesListQuery } from "./inventoryListQuery.js";

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
    const tab = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(tab, /\/api\/inventory\/balances\/report\.xlsx\?\$\{filterQuery\}/);
    assert.match(tab, /\/inventory\/balances\/report\/print/);
    assert.match(read("src/App.tsx"), /path="\/inventory\/balances\/report\/print"/);
  });
});
