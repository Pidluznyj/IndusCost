import * as XLSX from "xlsx";
import type { Product, ProductBOM } from "@/src/types/product";
import { BOMImportConfig, ProductImportConfig } from "@/src/lib/importer/ProductConfig";

export type EngineeringExportSheets = "CADASTRO" | "ESTRUTURA";

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function numOrBlank(n: unknown): number | "" {
  const v = typeof n === "string" ? Number(n) : (n as number);
  return Number.isFinite(v) ? v : "";
}

function strOrBlank(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return s === "undefined" || s === "null" ? "" : s;
}

function bomChildType(b: ProductBOM): "MATERIAL" | "COMPONENT" | "" {
  if (b.materialId) return "MATERIAL";
  if (b.childProductId) return "COMPONENT";
  return "";
}

function bomChildIdentifier(b: ProductBOM): string {
  if (b.materialId) {
    const code = (b as any).Material?.code ?? (b as any).material?.code ?? "";
    return strOrBlank(code).trim();
  }
  if (b.childProductId) {
    const sku = (b as any).ChildProduct?.sku ?? (b as any).childProduct?.sku ?? "";
    return strOrBlank(sku).trim();
  }
  return "";
}

export function buildEngineeringExportWorkbook(items: Product[]) {
  const wb = XLSX.utils.book_new();

  const cadastroHeaders = ProductImportConfig.columns.map((c) => c.label);
  const estruturaHeaders = BOMImportConfig.columns.map((c) => c.label);

  const cadastroRows = items
    .filter((p) => p.type === "PRODUCT" || p.type === "COMPONENT")
    .map((p) => ({
      SKU: strOrBlank(p.sku).trim(),
      Nome: strOrBlank(p.name).trim(),
      Descrição: strOrBlank(p.description).trim(),
      Tipo: strOrBlank(p.type).trim(),
      Versão: strOrBlank(p.version).trim(),
      "Lote Padrão": isFiniteNumber(p.defaultLotSize) ? p.defaultLotSize : numOrBlank(p.defaultLotSize),
      Status: strOrBlank(p.status).trim(),
    }));

  const cadastroWs = XLSX.utils.json_to_sheet(cadastroRows, {
    header: cadastroHeaders,
    skipHeader: false,
  });
  XLSX.utils.book_append_sheet(wb, cadastroWs, "CADASTRO");

  const estruturaRows = items
    .filter((p) => p.type === "PRODUCT" || p.type === "COMPONENT")
    .flatMap((p) => {
      const parentSku = strOrBlank(p.sku).trim();
      const bom = Array.isArray(p.ProductBOM) ? p.ProductBOM : [];
      return bom
        .map((b) => {
          const childType = bomChildType(b);
          const childIdentifier = bomChildIdentifier(b);
          return {
            "SKU Pai": parentSku,
            "Tipo Filho": childType,
            "ID Filho": childIdentifier,
            Quantidade: numOrBlank(b.quantity),
            "Perda (%)": numOrBlank(b.lossPercentage),
            Notas: strOrBlank(b.notes).trim(),
          };
        })
        .filter((r) => r["SKU Pai"] && r["Tipo Filho"] && r["ID Filho"]);
    });

  const estruturaWs = XLSX.utils.json_to_sheet(estruturaRows, {
    header: estruturaHeaders,
    skipHeader: false,
  });
  XLSX.utils.book_append_sheet(wb, estruturaWs, "ESTRUTURA");

  return wb;
}

export function workbookToXlsxBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

