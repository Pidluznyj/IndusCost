import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildProjectIntakeSpreadsheetWorkbook,
  listSpreadsheetSheetColumns,
  PROJECT_INTAKE_SHEET_01_COLUMNS,
  PROJECT_INTAKE_SHEET_02_COLUMNS,
  PROJECT_INTAKE_SHEET_03_COLUMNS,
  PROJECT_INTAKE_SHEET_04_COLUMNS,
  PROJECT_INTAKE_SHEET_05_COLUMNS,
  PROJECT_INTAKE_SHEET_06_COLUMNS,
  PROJECT_INTAKE_SHEET_07_COLUMNS,
  PROJECT_INTAKE_SHEET_08_COLUMNS,
  PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL,
  PROJECT_INTAKE_SPREADSHEET_FILENAME,
  PROJECT_INTAKE_SPREADSHEET_SCHEMA,
  PROJECT_INTAKE_SPREADSHEET_SHEETS,
  projectIntakeSpreadsheetToBytes,
} from "./projectsIntakeSpreadsheet.js";

describe("projectsIntakeSpreadsheet", () => {
  it("schema possui 8 abas esperadas", () => {
    assert.deepEqual([...PROJECT_INTAKE_SPREADSHEET_SHEETS], [
      "01_Projeto",
      "02_Entregaveis",
      "03_Itens",
      "04_Composicao_BOM",
      "05_Processos_HH",
      "06_Moldes_Ferramentas",
      "07_Custos_Extras",
      "08_Pendencias",
    ]);
    for (const sheet of PROJECT_INTAKE_SPREADSHEET_SHEETS) {
      assert.ok(PROJECT_INTAKE_SPREADSHEET_SCHEMA[sheet]);
      assert.ok(PROJECT_INTAKE_SPREADSHEET_SCHEMA[sheet].columns.length > 0);
    }
  });

  it("cada aba possui colunas esperadas", () => {
    assert.deepEqual(listSpreadsheetSheetColumns("01_Projeto"), PROJECT_INTAKE_SHEET_01_COLUMNS);
    assert.deepEqual(listSpreadsheetSheetColumns("02_Entregaveis"), PROJECT_INTAKE_SHEET_02_COLUMNS);
    assert.deepEqual(listSpreadsheetSheetColumns("03_Itens"), PROJECT_INTAKE_SHEET_03_COLUMNS);
    assert.deepEqual(listSpreadsheetSheetColumns("04_Composicao_BOM"), PROJECT_INTAKE_SHEET_04_COLUMNS);
    assert.deepEqual(listSpreadsheetSheetColumns("05_Processos_HH"), PROJECT_INTAKE_SHEET_05_COLUMNS);
    assert.deepEqual(listSpreadsheetSheetColumns("06_Moldes_Ferramentas"), PROJECT_INTAKE_SHEET_06_COLUMNS);
    assert.deepEqual(listSpreadsheetSheetColumns("07_Custos_Extras"), PROJECT_INTAKE_SHEET_07_COLUMNS);
    assert.deepEqual(listSpreadsheetSheetColumns("08_Pendencias"), PROJECT_INTAKE_SHEET_08_COLUMNS);
  });

  it("workbook XLSX contém abas e cabeçalhos", () => {
    const wb = buildProjectIntakeSpreadsheetWorkbook();
    assert.equal(wb.SheetNames.length, 8);
    for (const name of PROJECT_INTAKE_SPREADSHEET_SHEETS) {
      assert.ok(wb.SheetNames.includes(name));
    }
    const bytes = projectIntakeSpreadsheetToBytes(wb);
    assert.ok(bytes.byteLength > 500);
    const parsed = XLSX.read(bytes, { type: "array" });
    const projeto = XLSX.utils.sheet_to_json<Record<string, string>>(parsed.Sheets["01_Projeto"], {
      defval: "",
    });
    assert.ok(projeto.length >= 1);
    assert.ok("nome_projeto" in projeto[0]);
    const entregaveis = XLSX.utils.sheet_to_json<Record<string, string>>(parsed.Sheets["02_Entregaveis"]);
    assert.ok(entregaveis.length >= 10);
  });

  it("botão de download referenciado na UI", () => {
    const actions = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectIntakeActions.tsx"),
      "utf8"
    );
    assert.match(actions, /downloadProjectIntakeSpreadsheet/);
    assert.equal(PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL, "Baixar planilha modelo");
    assert.match(PROJECT_INTAKE_SPREADSHEET_FILENAME, /\.xlsx$/);
  });

  it("documentação da planilha existe", () => {
    const doc = readFileSync(join(process.cwd(), "docs", "projects", "PROJECT_INTAKE_SPREADSHEET.md"), "utf8");
    assert.match(doc, /01_Projeto/);
    assert.match(doc, /Importação futura/);
    assert.match(doc, /nome_projeto/);
  });

  it("não importa Prisma nem Proposal", () => {
    const lib = readFileSync(join(process.cwd(), "src", "lib", "projectsIntakeSpreadsheet.ts"), "utf8");
    assert.doesNotMatch(lib, /@prisma\/client|from ["'].*prisma/i);
    assert.doesNotMatch(lib, /from ["'].*Proposal|import.*Proposal/);
  });
});
