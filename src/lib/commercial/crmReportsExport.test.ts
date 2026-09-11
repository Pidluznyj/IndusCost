import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildCrmReportsExportCsv,
  buildCrmReportsExportMetadataRows,
  buildCrmReportsExportWorkbook,
  crmReportsExportFilename,
  crmReportsWorkbookToBytes,
  formatCrmReportsCsvCell,
  isCrmReportsExportFormat,
  type CrmReportsExportMetadata,
  type CrmReportsExportTable,
} from "./crmReportsExport.js";

const META: CrmReportsExportMetadata = {
  title: "Atrasados para recompra",
  generatedAt: new Date(2026, 8, 11, 14, 5, 0),
  timeZone: "America/Sao_Paulo",
  userLabel: "Gestora <gestora@example.com>",
  scopeLabel: "Global — todos os clientes permitidos pelo perfil",
  filterLines: [{ label: "UF", value: "PR, SP" }],
  selectionMode: "EXCLUDE",
  selectedCustomers: [{ id: "00000000-0000-4000-8000-000000000009", label: "Britânia Eletro — 07.019.308/0001-28" }],
  source: "Pedidos de Venda — crmCanonicalSalesOrderWhere → buildSalesOrderListWhere",
  dateAxis: "SalesOrder.issueDate — dia civil local (America/Sao_Paulo)",
  repurchaseVersion: "LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1",
  windowsLabel: "Hoje 11/09/2026 · 60d 14/07/2026–11/09/2026 · 12m 12/09/2025–11/09/2026",
  universe: { authorizedCustomers: 10, matchedBeforeExclusions: 8, manuallyExcluded: 1, analyzedCustomers: 7 },
  notes: ["1 pedido(s) com emissão depois de hoje ficaram fora das janelas."],
};

const TABLE: CrmReportsExportTable = {
  columns: [
    { key: "name", label: "Cliente", format: "text" },
    { key: "value", label: "Venda 12m", format: "money" },
    { key: "last", label: "Última compra", format: "date" },
    { key: "delay", label: "Atraso (dias)", format: "days" },
    { key: "avg", label: "Ciclo médio (dias)", format: "decimal-days" },
    { key: "late", label: "Follow-up atrasado", format: "boolean" },
  ],
  rows: [
    { name: 'Esmaltec; "Linha Branca"', value: 3000.1, last: "2026-07-31", delay: 12, avg: 30.5, late: true },
    { name: "Sem valor", value: null, last: null, delay: null, avg: null, late: false },
  ],
};

describe("crmReportsExport — CSV", () => {
  it("padrão do repositório: BOM, metadados '# ', ';', CRLF e vírgula decimal", () => {
    const csv = buildCrmReportsExportCsv(META, TABLE);
    assert.ok(csv.startsWith("\uFEFF# Relatório: Atrasados para recompra"));
    assert.ok(csv.includes("\r\n"));
    assert.match(csv, /# Gerado em: 11\/09\/2026 14:05 \(America\/Sao_Paulo\)/);
    assert.match(csv, /# Usuário: Gestora <gestora@example\.com>/);
    assert.match(csv, /# Fonte: Pedidos de Venda/);
    assert.match(csv, /# Eixo de data: SalesOrder\.issueDate — dia civil local/);
    assert.match(csv, /# Filtro — UF: PR, SP/);
    assert.match(csv, /# Seleção de clientes: Excluir selecionados \(1\)/);
    assert.match(csv, /# Cliente excluído: Britânia Eletro — 07\.019\.308\/0001-28 \(00000000-0000-4000-8000-000000000009\)/);
    assert.match(csv, /# Linhas exportadas: 2/);
    const lines = csv.split("\r\n");
    const header = lines.indexOf("Cliente;Venda 12m;Última compra;Atraso (dias);Ciclo médio (dias);Follow-up atrasado");
    assert.ok(header > 0);
    assert.equal(lines[header - 1], "", "linha em branco separa metadados da tabela");
    assert.equal(lines[header + 1], '"Esmaltec; ""Linha Branca""";3000,10;31/07/2026;12;30,50;Sim');
    assert.equal(lines[header + 2], "Sem valor;;;;;Não");
  });

  it("total geral vai no rodapé: depois das linhas e fora da contagem", () => {
    const csv = buildCrmReportsExportCsv(META, { ...TABLE, footer: { name: "Total geral", value: 3000.1 } });
    assert.match(csv, /# Linhas exportadas: 2\r\n/);
    const lines = csv.split("\r\n");
    assert.equal(lines.at(-1), "Total geral;3000,10;;;;");
    const wb = XLSX.read(
      crmReportsWorkbookToBytes(buildCrmReportsExportWorkbook(META, { ...TABLE, footer: { name: "Total geral", value: 3000.1 } })),
      { type: "array" }
    );
    const sheet = wb.Sheets["Relatório"]!;
    assert.equal(sheet["A4"].v, "Total geral");
    assert.equal(sheet["B4"].t, "n");
    assert.equal(sheet["!autofilter"]?.ref, "A1:F3");
  });

  it("neutraliza formula injection em texto; número negativo continua número", () => {
    assert.equal(formatCrmReportsCsvCell("=HYPERLINK(\"http://x\")", "text"), "'=HYPERLINK(\"http://x\")");
    assert.equal(formatCrmReportsCsvCell("+55 41", "text"), "'+55 41");
    assert.equal(formatCrmReportsCsvCell("-Metal", "text"), "'-Metal");
    assert.equal(formatCrmReportsCsvCell("@SUM(A1)", "text"), "'@SUM(A1)");
    assert.equal(formatCrmReportsCsvCell("Alfa Ltda", "text"), "Alfa Ltda");
    assert.equal(formatCrmReportsCsvCell(-8, "days"), "-8");
    assert.equal(formatCrmReportsCsvCell(-100.5, "money"), "-100,50");
    const csv = buildCrmReportsExportCsv(META, {
      columns: [{ key: "name", label: "Cliente", format: "text" }],
      rows: [{ name: "=cmd|' /C calc'!A0" }],
    });
    assert.ok(csv.split("\r\n").includes(`'=cmd|' /C calc'!A0`));
  });

  it("formatação por tipo de coluna", () => {
    assert.equal(formatCrmReportsCsvCell(1234.5, "money"), "1234,50");
    assert.equal(formatCrmReportsCsvCell(7.9, "integer"), "7");
    assert.equal(formatCrmReportsCsvCell("2026-01-05", "date"), "05/01/2026");
    assert.equal(formatCrmReportsCsvCell(null, "money"), "");
  });
});

describe("crmReportsExport — XLSX", () => {
  it("abas Relatório/Metadados/Clientes excluídos; números são números com formato", () => {
    const bytes = crmReportsWorkbookToBytes(buildCrmReportsExportWorkbook(META, TABLE));
    const wb = XLSX.read(bytes, { type: "array" });
    assert.deepEqual(wb.SheetNames, ["Relatório", "Metadados", "Clientes excluídos"]);
    const sheet = wb.Sheets["Relatório"]!;
    assert.equal(sheet["A1"].v, "Cliente");
    assert.equal(sheet["B2"].t, "n");
    assert.equal(sheet["B2"].v, 3000.1);
    assert.equal(sheet["C2"].v, "31/07/2026");
    assert.equal(sheet["F2"].v, "Sim");
    const meta = XLSX.utils.sheet_to_json<{ Campo: string; Valor: string }>(wb.Sheets["Metadados"]!);
    const fields = meta.map((row) => row.Campo);
    for (const field of ["Relatório", "Gerado em", "Usuário", "Escopo", "Fonte", "Eixo de data", "Motor de recompra", "Janelas", "Universo", "Seleção de clientes", "Linhas exportadas"]) {
      assert.ok(fields.includes(field), field);
    }
    const excluded = XLSX.utils.sheet_to_json<{ Cliente: string; ID: string }>(wb.Sheets["Clientes excluídos"]!);
    assert.equal(excluded[0]!.ID, "00000000-0000-4000-8000-000000000009");
  });

  it("modo ONLY rotula a aba como 'Clientes selecionados'", () => {
    const wb = XLSX.read(
      crmReportsWorkbookToBytes(buildCrmReportsExportWorkbook({ ...META, selectionMode: "ONLY" }, TABLE)),
      { type: "array" }
    );
    assert.ok(wb.SheetNames.includes("Clientes selecionados"));
  });
});

describe("crmReportsExport — utilitários", () => {
  it("metadados trazem universo e observações", () => {
    const rows = buildCrmReportsExportMetadataRows(META, 2);
    const universe = rows.find((r) => r.label === "Universo")!;
    assert.equal(universe.value, "permitido 10 · após filtros 8 · ocultados 1 · analisados 7");
    assert.ok(rows.some((r) => r.label === "Observação"));
  });

  it("nome de arquivo e formatos aceitos", () => {
    assert.equal(
      crmReportsExportFilename("atrasados-recompra", "xlsx", new Date(2026, 8, 11, 9, 7)),
      "crm-relatorio-atrasados-recompra-20260911-0907.xlsx"
    );
    assert.equal(isCrmReportsExportFormat("csv"), true);
    assert.equal(isCrmReportsExportFormat("pdf"), false);
  });
});
