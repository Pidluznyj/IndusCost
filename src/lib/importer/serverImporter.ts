// src/lib/importer/serverImporter.ts
import * as XLSX from "xlsx";
import { ImportEntityConfig, ImportResult, ImportError } from "./types";

export class ServerImporter {
  static async parseExcel<T>(
    buffer: Buffer,
    config: ImportEntityConfig
  ): Promise<ImportResult<T>> {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    const results: T[] = [];
    const errors: ImportError[] = [];
    const totalRows = jsonData.length;

    jsonData.forEach((row: any, index: number) => {
      const rowNumber = index + 2; // +1 for 0-index, +1 for header row
      const entity: any = {};
      let rowHasError = false;

      config.columns.forEach((col) => {
        let value = row[col.label] || row[col.key];

        // Validation: Required
        if (col.required && (value === undefined || value === null || value === "")) {
          errors.push({
            row: rowNumber,
            column: col.label,
            message: `Campo '${col.label}' é obrigatório.`
          });
          rowHasError = true;
          return;
        }

        // Type Conversion and Validation
        if (value !== undefined && value !== null && value !== "") {
          if (col.type === "number" || col.type === "decimal") {
            const num = Number(value);
            if (isNaN(num)) {
              errors.push({
                row: rowNumber,
                column: col.label,
                message: `Campo '${col.label}' deve ser um número válido.`
              });
              rowHasError = true;
            } else {
              value = num;
            }
          } else if (col.type === "boolean") {
            value = String(value).toLowerCase() === "true" || value === 1 || value === "Sim";
          }
        }

        // Custom Validation
        if (col.validation && value !== undefined && value !== null && value !== "") {
          const errorMsg = col.validation(value);
          if (errorMsg) {
            errors.push({
              row: rowNumber,
              column: col.label,
              message: errorMsg
            });
            rowHasError = true;
          }
        }

        // Transform
        if (col.transform) {
          value = col.transform(value);
        }

        entity[col.key] = value;
      });

      if (!rowHasError) {
        results.push(entity as T);
      }
    });

    return {
      data: results,
      errors,
      totalRows,
      validRows: results.length,
      invalidRows: totalRows - results.length
    };
  }

  static async parseExcelMulti<T extends Record<string, any[]>>(
    buffer: Buffer,
    configs: Record<string, ImportEntityConfig>
  ): Promise<Record<string, ImportResult<any>>> {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const results: Record<string, ImportResult<any>> = {};

    for (const [sheetKey, config] of Object.entries(configs)) {
      const sheetName = workbook.SheetNames.find(n => n.toUpperCase() === sheetKey.toUpperCase()) || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const sheetResults: any[] = [];
      const errors: ImportError[] = [];
      const totalRows = jsonData.length;

      jsonData.forEach((row: any, index: number) => {
        const rowNumber = index + 2;
        const entity: any = {};
        let rowHasError = false;

        config.columns.forEach((col) => {
          let value = row[col.label] || row[col.key];

          if (col.required && (value === undefined || value === null || value === "")) {
            errors.push({ row: rowNumber, column: col.label, message: `Campo '${col.label}' é obrigatório.` });
            rowHasError = true;
            return;
          }

          if (value !== undefined && value !== null && value !== "") {
            if (col.type === "number" || col.type === "decimal") {
              const num = Number(value);
              if (isNaN(num)) {
                errors.push({ row: rowNumber, column: col.label, message: `Campo '${col.label}' deve ser um número válido.` });
                rowHasError = true;
              } else {
                value = num;
              }
            } else if (col.type === "boolean") {
              value = String(value).toLowerCase() === "true" || value === 1 || value === "Sim";
            }
          }

          if (col.validation && value !== undefined && value !== null && value !== "") {
            const errorMsg = col.validation(value);
            if (errorMsg) {
              errors.push({ row: rowNumber, column: col.label, message: errorMsg });
              rowHasError = true;
            }
          }

          if (col.transform) value = col.transform(value);
          entity[col.key] = value;
        });

        if (!rowHasError) sheetResults.push(entity);
      });

      results[sheetKey] = {
        data: sheetResults,
        errors,
        totalRows,
        validRows: sheetResults.length,
        invalidRows: totalRows - sheetResults.length
      };
    }

    return results;
  }

  static generateTemplateMulti(configs: Record<string, ImportEntityConfig>): Buffer {
    const workbook = XLSX.utils.book_new();

    for (const [sheetName, config] of Object.entries(configs)) {
      const headers = config.columns.map(c => c.label);
      const examples = config.columns.map(c => c.example || "");
      const descriptions = config.columns.map(c => (c.required ? "[OBRIGATÓRIO] " : "") + (c.description || ""));

      const data = [headers, examples, descriptions];
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    }

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }

  static generateTemplate(config: ImportEntityConfig): Buffer {
    const headers = config.columns.map(c => c.label);
    const examples = config.columns.map(c => c.example || "");
    const descriptions = config.columns.map(c => (c.required ? "[OBRIGATÓRIO] " : "") + (c.description || ""));

    const data = [headers, examples, descriptions];
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }
}
