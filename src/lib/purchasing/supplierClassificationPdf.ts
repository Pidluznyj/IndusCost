/**
 * PDF da Classificação de fornecedores — documento de auditoria, não print de tela.
 *
 * Reutiliza o gerador PDF já existente do projeto
 * (`proposalInternalManagementPdfLayout`, A4 paisagem, tabelas + WinAnsi).
 * NÃO recalcula regra: consome `SupplierClassificationReport`.
 *
 * A tabela principal é quebrada em blocos que cabem em uma página, cada bloco
 * reemitindo o cabeçalho — é assim que o cabeçalho "repete na página nova" sem
 * mudar a semântica do layout compartilhado. Células de nome quebram linha;
 * o texto integral nunca é descartado.
 */

import {
  buildFormattedLandscapePdf,
  formatPdfMoneyBr,
  formatPdfNumberBr,
  formatPdfPercentBr,
  pdfTableRowLineCount,
  type PdfLine,
} from "../proposalInternalManagementPdfLayout.js";
import {
  SUPPLIER_EVALUATION_RATING_LABELS,
  SUPPLIER_EVALUATION_RATING_VALUES,
} from "./supplierPerformance.js";
import type {
  SupplierClassificationReport,
  SupplierClassificationReportRow,
} from "./supplierClassificationReport.js";

/**
 * Orçamento de linhas visuais da tabela principal (cabeçalho + corpo) na
 * paisagem. Nomes longos ocupam mais de uma linha e reduzem o nº de registros
 * por página — o cabeçalho continua a ser reemitido a cada bloco.
 */
export const SUPPLIER_CLASSIFICATION_PDF_TABLE_LINE_BUDGET = 28;

const TABLE_HEADERS = [
  "Fornecedor",
  "Documento",
  "Sit. cadastral",
  "Classificação",
  "Nota",
  "Qualid.",
  "Prazo",
  "Conform.",
  "Atend.",
  "Aval./Eleg.",
  "Cobert.",
  "Últ. aval.",
];

/** Soma exata da largura útil da paisagem (842 - 2 x 36 = 770 pt). */
const TABLE_COL_WIDTHS = [180, 88, 70, 84, 40, 40, 38, 42, 42, 50, 44, 52];

function dateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function dateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function periodLabel(report: SupplierClassificationReport): string {
  const { from, to } = report.metadata.period;
  return `${from ?? "início"} a ${to ?? "hoje"}`;
}

function tableRow(row: SupplierClassificationReportRow): string[] {
  return [
    row.name,
    row.document ?? "—",
    row.registryStatusLabel,
    row.classification.label,
    formatPdfNumberBr(row.overallScore),
    formatPdfNumberBr(row.qualityScore),
    formatPdfNumberBr(row.deliveryScore),
    formatPdfNumberBr(row.conformityScore),
    formatPdfNumberBr(row.serviceScore),
    `${row.evaluatedOrders} / ${row.eligibleOrders}`,
    row.coverage == null ? "—" : formatPdfPercentBr(row.coverage * 100),
    dateBr(row.lastEvaluationAt),
  ];
}

function chunkByVisualLines(
  rows: readonly SupplierClassificationReportRow[]
): SupplierClassificationReportRow[][] {
  if (rows.length === 0) return [];
  const blocks: SupplierClassificationReportRow[][] = [];
  let current: SupplierClassificationReportRow[] = [];
  let used = pdfTableRowLineCount(TABLE_HEADERS, TABLE_COL_WIDTHS);
  for (const row of rows) {
    const height = pdfTableRowLineCount(tableRow(row), TABLE_COL_WIDTHS);
    if (current.length > 0 && used + height > SUPPLIER_CLASSIFICATION_PDF_TABLE_LINE_BUDGET) {
      blocks.push(current);
      current = [];
      used = pdfTableRowLineCount(TABLE_HEADERS, TABLE_COL_WIDTHS);
    }
    current.push(row);
    used += height;
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function wrappedTable(headers: string[], rows: string[][], colWidths: number[]): PdfLine {
  return { type: "table", headers, rows, colWidths, wrapCells: true };
}

export function buildSupplierClassificationPdfLines(
  report: SupplierClassificationReport
): PdfLine[] {
  const { metadata, summary, rows } = report;
  const lines: PdfLine[] = [];

  /* ---------- Página 1 — capa institucional ---------- */
  lines.push({ type: "title", text: metadata.title });
  lines.push({ type: "banner", text: metadata.purpose });
  lines.push({ type: "kv", label: "Período", value: periodLabel(report) });
  lines.push({ type: "kv", label: "Emitido em", value: dateTimeBr(metadata.generatedAt) });
  lines.push({ type: "kv", label: "Fonte dos dados", value: metadata.dataSource });
  lines.push({
    type: "kv",
    label: "Última sincronização Nomus",
    value: dateTimeBr(metadata.lastSyncedAt),
  });
  lines.push({
    type: "kv",
    label: "Qualidade do dado financeiro",
    value: `${metadata.population.financialDataStatus} — ${metadata.population.ordersWithFinancialValue} de ${metadata.population.orderCount} pedidos com valor`,
  });
  lines.push({
    type: "kv",
    label: "Metodologia de avaliação",
    value: `${metadata.methodology.id} (versão ${metadata.methodology.version}) — escala ${metadata.methodology.scaleMin} a ${metadata.methodology.scaleMax}`,
  });
  lines.push({
    type: "kv",
    label: "Política de classificação",
    value: `${metadata.policy.id} (versão ${metadata.policy.version}) — critério interno da empresa`,
  });
  if (!metadata.evaluation.available && metadata.evaluation.reason) {
    lines.push({ type: "kv", label: "Avaliação", value: metadata.evaluation.reason });
  }

  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Filtros aplicados" });
  lines.push({
    type: "text",
    text: metadata.appliedFilters.map((filter) => `${filter.label}: ${filter.value}`).join(" · "),
  });

  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Resumo executivo" });
  lines.push(
    wrappedTable(
      ["Indicador", "Valor"],
      [
        ["Fornecedores na população", String(summary.suppliersInPopulation)],
        ["Fornecedores avaliados", String(summary.suppliersEvaluated)],
        ["Fornecedores sem avaliação", String(summary.suppliersWithoutEvaluation)],
        ["Aprovados", String(summary.approved)],
        ["Condicionais", String(summary.conditional)],
        ["Não aprovados", String(summary.notApproved)],
        ["Não avaliados", String(summary.notEvaluated)],
        ["Não classificados (metodologia anterior)", String(summary.legacyMethodology)],
        ["Pedidos elegíveis", String(summary.eligibleOrders)],
        ["Pedidos avaliados", String(summary.evaluatedOrders)],
        ["Pedidos pendentes de avaliação", String(summary.pendingOrders)],
        [
          "Cobertura global",
          summary.coverage == null ? "Sem pedidos elegíveis" : formatPdfPercentBr(summary.coverage * 100),
        ],
      ],
      [420, 350]
    )
  );
  lines.push({ type: "pagebreak" });

  /* ---------- Tabela principal — cabeçalho repetido por página ---------- */
  const blocks = chunkByVisualLines(rows);
  if (blocks.length === 0) {
    lines.push({ type: "subtitle", text: "Classificação de fornecedores" });
    lines.push({
      type: "text",
      text: "Nenhum fornecedor na população para o período e filtros aplicados.",
    });
    lines.push({ type: "pagebreak" });
  }
  blocks.forEach((block) => {
    lines.push(wrappedTable(TABLE_HEADERS, block.map(tableRow), TABLE_COL_WIDTHS));
    lines.push({ type: "pagebreak" });
  });

  /* ---------- Legenda, metodologia e critérios ---------- */
  lines.push({ type: "subtitle", text: "Legenda da classificação de desempenho" });
  lines.push(
    wrappedTable(
      ["Faixa", "Critério"],
      metadata.policy.bands.map((band) => [band.label, band.rule]),
      [200, 570]
    )
  );
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Abreviações da tabela" });
  lines.push({
    type: "text",
    text: "Qualid. = Qualidade do produto/material · Conform. = Quantidade/conformidade · Atend. = Atendimento/solução de problemas · Aval./Eleg. = pedidos avaliados sobre pedidos elegíveis · Cobert. = cobertura de avaliação · Últ. aval. = data da última avaliação registrada no período.",
  });
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Critérios e pesos" });
  lines.push(
    wrappedTable(
      ["Critério", "Peso"],
      metadata.methodology.criteria.map((criterion) => [criterion.label, `${criterion.weightPercent}%`]),
      [620, 150]
    )
  );
  lines.push({ type: "pagebreak" });

  lines.push({ type: "subtitle", text: "Régua da nota por pedido" });
  lines.push(
    wrappedTable(
      ["Nota", "Significado"],
      SUPPLIER_EVALUATION_RATING_VALUES.map((value) => [String(value), SUPPLIER_EVALUATION_RATING_LABELS[value]]),
      [100, 670]
    )
  );
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Metodologia de avaliação" });
  for (const text of metadata.methodology.text) lines.push({ type: "text", text });
  lines.push({ type: "pagebreak" });

  lines.push({ type: "subtitle", text: "Política de classificação (critério interno)" });
  for (const text of metadata.policy.text) lines.push({ type: "text", text });
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Qualidade dos dados e cobertura" });
  lines.push(
    wrappedTable(
      ["Indicador", "Valor"],
      [
        ["Pedidos na população", String(metadata.population.orderCount)],
        ["Fornecedores na população", String(metadata.population.supplierCount)],
        ["Pedidos cancelados excluídos", String(metadata.population.canceledExcluded)],
        ["Pedidos com valor financeiro", String(metadata.population.ordersWithFinancialValue)],
        ["Pedidos sem valor financeiro", String(metadata.population.ordersWithoutValue)],
        ["Status do dado financeiro", metadata.population.financialDataStatus],
        ["Moeda apresentada", metadata.currency.selected],
        ["Base multimeda", metadata.currency.multiCurrency ? "Sim" : "Não"],
        [
          "Cobertura global",
          summary.coverage == null ? "Sem pedidos elegíveis" : formatPdfPercentBr(summary.coverage * 100),
        ],
      ],
      [420, 350]
    )
  );
  lines.push({ type: "spacer" });
  lines.push({
    type: "text",
    text: "Pedido elegível sem avaliação não recebe nota zero: permanece contabilizado na cobertura e sinalizado como pendente. Valor comprado e número de pedidos são informação de contexto e não entram no cálculo da classificação.",
  });
  if (report.evidence != null) {
    lines.push({
      type: "text",
      text: `Evidência detalhada por pedido: ${report.evidence.length} registros disponíveis na exportação XLSX (aba Evidências).`,
    });
  } else {
    lines.push({
      type: "text",
      text: "Evidência detalhada por pedido disponível na exportação XLSX (aba Evidências).",
    });
  }

  return lines;
}

export function buildSupplierClassificationPdfBuffer(
  report: SupplierClassificationReport
): Buffer {
  return buildFormattedLandscapePdf({
    title: report.metadata.title,
    lines: buildSupplierClassificationPdfLines(report),
    footerNote: `${report.metadata.title} — período ${periodLabel(report)} — gerado em ${dateTimeBr(
      report.metadata.generatedAt
    )}`,
  });
}

/** Usado no rodapé/legenda quando o valor monetário precisa aparecer no PDF. */
export const formatSupplierClassificationPdfMoney = formatPdfMoneyBr;
