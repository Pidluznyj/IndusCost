import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { buildInventoryPositionReport } from "./inventoryPositionReport.js";
import {
  buildInventoryPositionReportWorkbook,
  inventoryPositionReportFilename,
} from "./inventoryPositionReportXlsx.js";

const D = (value: string | number) => new Prisma.Decimal(value);

function prices(entries: Array<[string, string | number | null]>): Map<string, Prisma.Decimal | null> {
  return new Map(entries.map(([id, amount]) => [id, amount == null ? null : D(amount)]));
}

describe("inventory position report", () => {
  it("separa MP, componente e produto acabado com quantidade e valor", () => {
    const report = buildInventoryPositionReport({
      generatedAt: new Date("2026-09-25T15:00:00.000Z"),
      lines: [
        {
          itemId: "mp",
          itemType: "RAW_MATERIAL",
          code: "MP-1",
          description: "Chapa",
          unit: "KG",
          productId: null,
          materialId: "mat-1",
          physicalQuantity: D(10),
        },
        {
          itemId: "mp",
          itemType: "RAW_MATERIAL",
          code: "MP-1",
          description: "Chapa",
          unit: "KG",
          productId: null,
          materialId: "mat-1",
          physicalQuantity: D(5),
        },
        {
          itemId: "pa",
          itemType: "FINISHED_PRODUCT",
          code: "PA-1",
          description: "Produto",
          unit: "UN",
          productId: "prod-1",
          materialId: null,
          physicalQuantity: D(2),
        },
        {
          itemId: "comp",
          itemType: "COMPONENT",
          code: "CP-1",
          description: "Componente",
          unit: "UN",
          productId: "comp-1",
          materialId: null,
          physicalQuantity: D(4),
        },
        {
          itemId: "zero",
          itemType: "FINISHED_PRODUCT",
          code: "PA-0",
          description: "Zerado",
          unit: "UN",
          productId: "prod-0",
          materialId: null,
          physicalQuantity: D(0),
        },
        {
          itemId: "neg",
          itemType: "COMPONENT",
          code: "CP-N",
          description: "Negativo",
          unit: "UN",
          productId: "comp-n",
          materialId: null,
          physicalQuantity: D(-3),
        },
      ],
      retailPriceByProductId: prices([
        ["prod-1", 20],
        ["comp-1", 5],
      ]),
      factoryCostByProductId: prices([
        ["prod-1", 8],
        ["comp-1", 1.5],
      ]),
      materialCostByMaterialId: prices([["mat-1", 3]]),
    });

    const mp = report.sections[0];
    const component = report.sections[1];
    const finished = report.sections[2];
    assert.equal(mp?.title, "Matérias-primas");
    assert.equal(mp?.rows[0]?.physicalQuantity, "15");
    assert.equal(mp?.rows[0]?.totalCost, 45);
    assert.equal(mp?.rows[0]?.totalSaleValue, null);
    assert.equal(component?.rows[0]?.totalCost, 6);
    assert.equal(component?.rows[0]?.totalSaleValue, 20);
    assert.equal(finished?.rows[0]?.totalCost, 16);
    assert.equal(finished?.rows[0]?.totalSaleValue, 40);
    assert.equal(finished?.itemCount, 1);
    assert.equal(report.negativeLines.length, 1);
    assert.equal(report.negativeLines[0]?.itemCode, "CP-N");
    assert.match(report.purpose, /Bloco K/);
    assert.ok(report.filters.some((filter) => filter.label === "Valor contábil"));
  });

  it("item sem custo entra na quantidade e fica sem valor", () => {
    const report = buildInventoryPositionReport({
      generatedAt: new Date("2026-09-25T15:00:00.000Z"),
      lines: [
        {
          itemId: "pa",
          itemType: "FINISHED_PRODUCT",
          code: "PA-2",
          description: "Sem custo",
          unit: "UN",
          productId: "prod-2",
          materialId: null,
          physicalQuantity: D(7),
        },
      ],
      retailPriceByProductId: prices([["prod-2", 9]]),
      factoryCostByProductId: prices([]),
      materialCostByMaterialId: new Map(),
    });
    const finished = report.sections[2];
    assert.equal(finished?.rows[0]?.physicalQuantity, "7");
    assert.equal(finished?.rows[0]?.totalCost, null);
    assert.equal(finished?.costUncoveredItems, 1);
    assert.equal(finished?.costTotal, 0);
    assert.equal(finished?.rows[0]?.totalSaleValue, 63);
  });

  it("planilha traz capa e as três populações", () => {
    const report = buildInventoryPositionReport({
      generatedAt: new Date("2026-09-25T15:00:00.000Z"),
      lines: [],
      retailPriceByProductId: new Map(),
      factoryCostByProductId: new Map(),
      materialCostByMaterialId: new Map(),
    });
    const workbook = buildInventoryPositionReportWorkbook(report);
    assert.deepEqual(workbook.SheetNames, ["Capa", "Matérias-primas", "Componentes", "Produtos acabados"]);
    const cover = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Capa!, { header: 1 });
    assert.equal(cover[0]?.[0], "Posição de estoque");
    assert.equal(inventoryPositionReportFilename(report.generatedAt), "posicao-estoque-2026-09-25.xlsx");
  });
});
