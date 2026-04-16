import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import type { Product } from "@/src/types/product";
import { buildEngineeringExportWorkbook, workbookToXlsxBytes } from "./productEngineeringExport";
import { BOMImportConfig, ProductImportConfig } from "@/src/lib/importer/ProductConfig";

test("export engenharia: gera abas CADASTRO e ESTRUTURA com headers corretos", () => {
  const products: Product[] = [
    {
      id: "p1",
      sku: "PRD-001",
      name: "Produto 1",
      description: "Desc",
      type: "PRODUCT",
      version: "1.0.0",
      status: "ACTIVE",
      defaultLotSize: 10,
      ProductBOM: [
        {
          id: "b1",
          materialId: "m1",
          quantity: 2,
          lossPercentage: 5,
          notes: "Corte",
          // payload real do backend é Material/ChildProduct (Prisma include)
          ...( { Material: { code: "MAT-001" } } as any ),
        } as any,
        {
          id: "b2",
          childProductId: "c1",
          quantity: 1,
          lossPercentage: 0,
          notes: "",
          ...( { ChildProduct: { sku: "CMP-001" } } as any ),
        } as any,
      ],
      ProductRouting: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const wb = buildEngineeringExportWorkbook(products);
  const bytes = workbookToXlsxBytes(wb);

  const parsed = XLSX.read(bytes, { type: "array" });
  assert.deepEqual(parsed.SheetNames, ["CADASTRO", "ESTRUTURA"]);

  const cadastro = XLSX.utils.sheet_to_json(parsed.Sheets["CADASTRO"], { header: 1 }) as any[][];
  const estrutura = XLSX.utils.sheet_to_json(parsed.Sheets["ESTRUTURA"], { header: 1 }) as any[][];

  assert.deepEqual(cadastro[0], ProductImportConfig.columns.map((c) => c.label));
  assert.deepEqual(estrutura[0], BOMImportConfig.columns.map((c) => c.label));

  // 1 linha de produto
  assert.equal(cadastro.length, 2);
  assert.deepEqual(cadastro[1], ["PRD-001", "Produto 1", "Desc", "PRODUCT", "1.0.0", 10, "ACTIVE"]);

  // 2 linhas de BOM
  assert.equal(estrutura.length, 3);
  assert.deepEqual(estrutura[1], ["PRD-001", "MATERIAL", "MAT-001", 2, 5, "Corte"]);
  assert.deepEqual(estrutura[2], ["PRD-001", "COMPONENT", "CMP-001", 1, 0, ""]);
});

