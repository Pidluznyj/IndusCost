/**
 * XLSX real (SheetJS) da Classificação de fornecedores.
 *
 * Reutiliza a biblioteca `xlsx` já presente no projeto (mesmo padrão de
 * `financeCostCenterDetailExport`: `!cols`, `!freeze`, `!autofilter`). Fica no
 * server: o browser só recebe o arquivo pela rota, nunca a biblioteca.
 *
 * NÃO calcula nada: consome `SupplierClassificationReport` e apenas formata.
 * Toda célula textual de origem externa (nome de fornecedor, código de pedido,
 * observação do avaliador) passa por neutralização de fórmula.
 */

import * as XLSX from "xlsx";
import {
  SUPPLIER_EVALUATION_RATING_LABELS,
  SUPPLIER_EVALUATION_RATING_VALUES,
} from "./supplierPerformance.js";
import type {
  SupplierClassificationEvidenceRow,
  SupplierClassificationReport,
  SupplierClassificationReportRow,
} from "./supplierClassificationReport.js";

/** Prefixo que neutraliza fórmula em Excel/LibreOffice (OWASP formula injection). */
const FORMULA_RE = /^[=+\-@\t\r]/;

export function neutralizeSupplierClassificationCellText(value: string): string {
  if (!value) return value;
  return FORMULA_RE.test(value) ? `'${value}` : value;
}

/** Célula textual de origem externa. */
function text(value: string | null | undefined, fallback = ""): string {
  const raw = value == null ? "" : String(value);
  if (!raw) return fallback;
  return neutralizeSupplierClassificationCellText(raw);
}

type Cell = string | number | null;

function dateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function dateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const NUMBER_FORMAT_SCORE = "0.00";
const NUMBER_FORMAT_MONEY = "#,##0.00";
const NUMBER_FORMAT_PERCENT = "0.00%";

/** Acumula linhas mantendo o índice — necessário para freeze/autofilter corretos. */
class SheetBuilder {
  readonly rows: Cell[][] = [];

  push(row: Cell[] = []): number {
    this.rows.push(row);
    return this.rows.length - 1;
  }

  get nextIndex(): number {
    return this.rows.length;
  }
}

function applyFormat(
  ws: XLSX.WorkSheet,
  rowIndex: number,
  colIndex: number,
  z: string
): void {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = ws[address] as XLSX.CellObject | undefined;
  if (cell && cell.t === "n") cell.z = z;
}

/* ------------------------------------------------------------------ *
 * Aba 1 — Classificação
 * ------------------------------------------------------------------ */

const CLASSIFICATION_COLUMNS = [
  "Fornecedor",
  "Documento",
  "ID Nomus",
  "Situação cadastral",
  "Classificação de desempenho",
  "Nota geral",
  "Escala",
  "Qualidade",
  "Prazo",
  "Conformidade",
  "Atendimento",
  "Pedidos avaliados",
  "Pedidos elegíveis",
  "Pedidos pendentes",
  "Cobertura",
  "Última avaliação",
  "Pedidos no período",
  "Valor comprado no período",
  "Moeda",
] as const;

const CLASSIFICATION_COL_WIDTHS = [
  38, 20, 10, 18, 28, 10, 8, 11, 10, 13, 13, 16, 16, 16, 11, 18, 17, 24, 8,
];

function classificationRowCells(row: SupplierClassificationReportRow): Cell[] {
  return [
    text(row.name),
    text(row.document, "—"),
    row.supplierExternalId,
    text(row.registryStatusLabel),
    text(row.classification.label),
    row.overallScore,
    row.scaleMax == null ? "" : `1 a ${row.scaleMax}`,
    row.qualityScore,
    row.deliveryScore,
    row.conformityScore,
    row.serviceScore,
    row.evaluatedOrders,
    row.eligibleOrders,
    row.pendingOrders,
    row.coverage,
    dateTimeBr(row.lastEvaluationAt),
    row.orderCount,
    row.spend,
    text(row.currency),
  ];
}

function buildClassificationSheet(report: SupplierClassificationReport): XLSX.WorkSheet {
  const { metadata, summary, rows } = report;
  const b = new SheetBuilder();

  b.push([metadata.title]);
  b.push([metadata.purpose]);
  b.push();
  b.push(["Período", `${metadata.period.from ?? "início"} a ${metadata.period.to ?? "hoje"}`]);
  b.push(["Emitido em", dateTimeBr(metadata.generatedAt)]);
  b.push(["Fonte dos dados", metadata.dataSource]);
  b.push(["Última sincronização Nomus", dateTimeBr(metadata.lastSyncedAt) || "Não disponível"]);
  b.push([
    "Qualidade dos dados (valor financeiro)",
    `${metadata.population.financialDataStatus} — ${metadata.population.ordersWithFinancialValue} de ${metadata.population.orderCount} pedidos com valor`,
  ]);
  b.push([
    "Metodologia de avaliação",
    `${metadata.methodology.id} (versão ${metadata.methodology.version}) — escala ${metadata.methodology.scaleMin} a ${metadata.methodology.scaleMax}`,
  ]);
  b.push([
    "Política de classificação",
    `${metadata.policy.id} (versão ${metadata.policy.version}) — critério interno da empresa`,
  ]);
  if (!metadata.evaluation.available) {
    b.push(["Avaliação", text(metadata.evaluation.reason)]);
  }
  b.push();

  b.push(["Filtros aplicados"]);
  for (const filter of metadata.appliedFilters) {
    b.push([filter.label, text(filter.value)]);
  }
  b.push();

  b.push(["Resumo"]);
  const summaryRows: Array<[string, Cell, string?]> = [
    ["Fornecedores na população", summary.suppliersInPopulation],
    ["Fornecedores avaliados", summary.suppliersEvaluated],
    ["Fornecedores sem avaliação", summary.suppliersWithoutEvaluation],
    ["Aprovados", summary.approved],
    ["Condicionais", summary.conditional],
    ["Não aprovados", summary.notApproved],
    ["Não avaliados", summary.notEvaluated],
    ["Não classificados (metodologia anterior)", summary.legacyMethodology],
    ["Pedidos elegíveis", summary.eligibleOrders],
    ["Pedidos avaliados", summary.evaluatedOrders],
    ["Pedidos pendentes de avaliação", summary.pendingOrders],
    ["Cobertura global", summary.coverage, NUMBER_FORMAT_PERCENT],
  ];
  const summaryFormats: Array<{ row: number; z: string }> = [];
  for (const [label, value, z] of summaryRows) {
    const index = b.push([label, value]);
    if (z) summaryFormats.push({ row: index, z });
  }
  b.push();

  const headerRow = b.push([...CLASSIFICATION_COLUMNS]);
  for (const row of rows) b.push(classificationRowCells(row));
  const lastDataRow = b.rows.length - 1;

  b.push();
  b.push(["Legenda de classificação"]);
  for (const band of metadata.policy.bands) {
    b.push([band.label, band.rule]);
  }
  b.push();
  b.push(["Observações"]);
  for (const line of metadata.policy.text) b.push([line]);

  const ws = XLSX.utils.aoa_to_sheet(b.rows);

  ws["!cols"] = CLASSIFICATION_COL_WIDTHS.map((wch) => ({ wch }));
  // Congela o cabeçalho da tabela e a primeira coluna (nome do fornecedor).
  ws["!freeze"] = {
    xSplit: 1,
    ySplit: headerRow + 1,
    topLeftCell: XLSX.utils.encode_cell({ r: headerRow + 1, c: 1 }),
    activePane: "bottomRight",
    state: "frozen",
  };
  if (rows.length > 0) {
    ws["!autofilter"] = {
      ref: `${XLSX.utils.encode_cell({ r: headerRow, c: 0 })}:${XLSX.utils.encode_cell({
        r: lastDataRow,
        c: CLASSIFICATION_COLUMNS.length - 1,
      })}`,
    };
  }
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };

  for (const { row, z } of summaryFormats) applyFormat(ws, row, 1, z);
  rows.forEach((_, index) => {
    const r = headerRow + 1 + index;
    applyFormat(ws, r, 5, NUMBER_FORMAT_SCORE); // nota geral
    for (let c = 7; c <= 10; c += 1) applyFormat(ws, r, c, NUMBER_FORMAT_SCORE);
    applyFormat(ws, r, 14, NUMBER_FORMAT_PERCENT); // cobertura
    applyFormat(ws, r, 17, NUMBER_FORMAT_MONEY); // valor comprado
  });

  return ws;
}

/* ------------------------------------------------------------------ *
 * Aba 2 — Metodologia
 * ------------------------------------------------------------------ */

function buildMethodologySheet(report: SupplierClassificationReport): XLSX.WorkSheet {
  const { metadata } = report;
  const b = new SheetBuilder();

  b.push(["Metodologia de avaliação e política de classificação"]);
  b.push([metadata.purpose]);
  b.push();
  b.push(["Emitido em", dateTimeBr(metadata.generatedAt)]);
  b.push(["Metodologia (ID)", metadata.methodology.id]);
  b.push(["Metodologia (versão)", metadata.methodology.version]);
  b.push(["Escala", `${metadata.methodology.scaleMin} a ${metadata.methodology.scaleMax}`]);
  b.push();

  b.push(["Critérios e pesos"]);
  b.push(["Critério", "Peso"]);
  for (const criterion of metadata.methodology.criteria) {
    b.push([criterion.label, `${criterion.weightPercent}%`]);
  }
  b.push();

  b.push(["Régua da nota por pedido"]);
  b.push(["Nota", "Significado"]);
  for (const value of SUPPLIER_EVALUATION_RATING_VALUES) {
    b.push([value, SUPPLIER_EVALUATION_RATING_LABELS[value]]);
  }
  b.push();

  b.push(["Metodologia — descrição"]);
  for (const line of metadata.methodology.text) b.push([line]);
  b.push();

  b.push(["Política de classificação"]);
  b.push(["ID", metadata.policy.id]);
  b.push(["Versão", metadata.policy.version]);
  b.push([
    "Escala de aplicação",
    `${metadata.policy.scale.methodologyId} — ${metadata.policy.scale.scaleMin} a ${metadata.policy.scale.scaleMax}`,
  ]);
  b.push();
  b.push(["Faixa", "Critério"]);
  for (const band of metadata.policy.bands) b.push([band.label, band.rule]);
  b.push();
  b.push(["Política de classificação — observações"]);
  for (const line of metadata.policy.text) b.push([line]);
  b.push();
  b.push([
    "Natureza da política",
    "Critério INTERNO da empresa. Não é prescrito por norma externa.",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(b.rows);
  ws["!cols"] = [{ wch: 46 }, { wch: 86 }];
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };
  return ws;
}

/* ------------------------------------------------------------------ *
 * Aba 3 — Evidências
 * ------------------------------------------------------------------ */

const EVIDENCE_COLUMNS = [
  "Fornecedor",
  "Documento",
  "ID Nomus",
  "Pedido",
  "ID externo do pedido",
  "Data operacional",
  "Status",
  "Cancelado",
  "Valor",
  "Moeda",
  "Qualidade",
  "Prazo",
  "Conformidade",
  "Atendimento",
  "Nota geral",
  "Metodologia",
  "Versão da metodologia",
  "Escala",
  "Revisão",
  "Avaliado por",
  "Data da avaliação",
  "Atualizado por",
  "Data da atualização",
  "Observações",
] as const;

const EVIDENCE_COL_WIDTHS = [
  38, 20, 10, 16, 16, 16, 20, 11, 14, 8, 11, 10, 13, 13, 11, 26, 20, 8, 9, 20, 18, 20, 20, 60,
];

function evidenceRowCells(row: SupplierClassificationEvidenceRow): Cell[] {
  return [
    text(row.supplierName),
    text(row.supplierDocument, "—"),
    row.supplierExternalId,
    text(row.purchaseOrderCode, "—"),
    row.purchaseOrderExternalId,
    dateBr(row.performanceDate),
    text(row.stage),
    row.canceled ? "Sim" : "Não",
    row.amount,
    text(row.currency),
    row.qualityScore,
    row.deliveryScore,
    row.conformityScore,
    row.serviceScore,
    row.overallScore,
    text(row.methodologyId, "—"),
    row.methodologyVersion,
    row.scaleMax == null ? "" : `1 a ${row.scaleMax}`,
    row.revision,
    text(row.evaluatedBy, "—"),
    dateTimeBr(row.evaluatedAt),
    text(row.updatedBy, "—"),
    dateTimeBr(row.updatedAt),
    text(row.notes, "—"),
  ];
}

function buildEvidenceSheet(report: SupplierClassificationReport): XLSX.WorkSheet {
  const evidence = report.evidence ?? [];
  const b = new SheetBuilder();

  b.push(["Evidências por pedido de compra elegível"]);
  b.push([
    "Uma linha por pedido da população do período. Pedido sem avaliação aparece sem nota — ausência não é zero.",
  ]);
  b.push();
  const headerRow = b.push([...EVIDENCE_COLUMNS]);
  for (const row of evidence) b.push(evidenceRowCells(row));
  const lastDataRow = b.rows.length - 1;

  const ws = XLSX.utils.aoa_to_sheet(b.rows);
  ws["!cols"] = EVIDENCE_COL_WIDTHS.map((wch) => ({ wch }));
  ws["!freeze"] = {
    xSplit: 1,
    ySplit: headerRow + 1,
    topLeftCell: XLSX.utils.encode_cell({ r: headerRow + 1, c: 1 }),
    activePane: "bottomRight",
    state: "frozen",
  };
  if (evidence.length > 0) {
    ws["!autofilter"] = {
      ref: `${XLSX.utils.encode_cell({ r: headerRow, c: 0 })}:${XLSX.utils.encode_cell({
        r: lastDataRow,
        c: EVIDENCE_COLUMNS.length - 1,
      })}`,
    };
  }
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };

  evidence.forEach((_, index) => {
    const r = headerRow + 1 + index;
    applyFormat(ws, r, 8, NUMBER_FORMAT_MONEY);
    for (let c = 10; c <= 14; c += 1) applyFormat(ws, r, c, NUMBER_FORMAT_SCORE);
  });

  return ws;
}

/* ------------------------------------------------------------------ *
 * Aba 4 — Parâmetros
 * ------------------------------------------------------------------ */

function buildParametersSheet(report: SupplierClassificationReport): XLSX.WorkSheet {
  const { metadata, summary } = report;
  const b = new SheetBuilder();

  b.push(["Parâmetros da emissão"]);
  b.push();
  b.push(["Parâmetro", "Valor"]);
  b.push(["Relatório", metadata.title]);
  b.push(["Versão do read model", metadata.version]);
  b.push(["Emitido em", dateTimeBr(metadata.generatedAt)]);
  b.push(["Período (de)", metadata.period.from ?? "início"]);
  b.push(["Período (até)", metadata.period.to ?? "hoje"]);
  b.push(["Origem dos dados", metadata.dataSource]);
  b.push(["Última sincronização Nomus", dateTimeBr(metadata.lastSyncedAt) || "Não disponível"]);
  b.push(["Base do valor comprado", metadata.spendBasis]);
  b.push(["Moeda apresentada", metadata.currency.selected]);
  b.push(["Base multimoeda", metadata.currency.multiCurrency ? "Sim" : "Não"]);
  b.push(["Metodologia", `${metadata.methodology.id} (versão ${metadata.methodology.version})`]);
  b.push(["Política de classificação", `${metadata.policy.id} (versão ${metadata.policy.version})`]);
  b.push();

  b.push(["Filtros aplicados"]);
  b.push(["Filtro", "Valor"]);
  for (const filter of metadata.appliedFilters) b.push([filter.label, text(filter.value)]);
  b.push();

  b.push(["Qualidade dos dados e cobertura"]);
  b.push(["Indicador", "Valor"]);
  b.push(["Pedidos na população", metadata.population.orderCount]);
  b.push(["Linhas na população", metadata.population.lineCount]);
  b.push(["Fornecedores na população", metadata.population.supplierCount]);
  b.push(["Matérias-primas na população", metadata.population.materialCount]);
  b.push(["Pedidos cancelados excluídos", metadata.population.canceledExcluded]);
  b.push(["Pedidos com valor financeiro", metadata.population.ordersWithFinancialValue]);
  b.push(["Pedidos sem valor financeiro", metadata.population.ordersWithoutValue]);
  b.push(["Status do dado financeiro", metadata.population.financialDataStatus]);
  b.push(["Pedidos elegíveis", summary.eligibleOrders]);
  b.push(["Pedidos avaliados", summary.evaluatedOrders]);
  b.push(["Pedidos pendentes de avaliação", summary.pendingOrders]);
  const coverageRow = b.push(["Cobertura global", summary.coverage]);
  b.push([
    "Avaliação disponível",
    metadata.evaluation.available ? "Sim" : text(metadata.evaluation.reason, "Não"),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(b.rows);
  ws["!cols"] = [{ wch: 40 }, { wch: 90 }];
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };
  applyFormat(ws, coverageRow, 1, NUMBER_FORMAT_PERCENT);
  return ws;
}

/* ------------------------------------------------------------------ *
 * Workbook
 * ------------------------------------------------------------------ */

export const SUPPLIER_CLASSIFICATION_XLSX_SHEETS = [
  "Classificação",
  "Metodologia",
  "Evidências",
  "Parâmetros",
] as const;

export function buildSupplierClassificationWorkbook(
  report: SupplierClassificationReport
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildClassificationSheet(report), SUPPLIER_CLASSIFICATION_XLSX_SHEETS[0]);
  XLSX.utils.book_append_sheet(wb, buildMethodologySheet(report), SUPPLIER_CLASSIFICATION_XLSX_SHEETS[1]);
  XLSX.utils.book_append_sheet(wb, buildEvidenceSheet(report), SUPPLIER_CLASSIFICATION_XLSX_SHEETS[2]);
  XLSX.utils.book_append_sheet(wb, buildParametersSheet(report), SUPPLIER_CLASSIFICATION_XLSX_SHEETS[3]);
  return wb;
}

export function buildSupplierClassificationXlsxBuffer(
  report: SupplierClassificationReport
): Buffer {
  return XLSX.write(buildSupplierClassificationWorkbook(report), {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}
