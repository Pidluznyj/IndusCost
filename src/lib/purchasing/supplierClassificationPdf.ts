/**
 * PDF institucional da Classificação de fornecedores.
 *
 * Documento de auditoria (não print de tela). Consome o read model e não
 * recalcula faixa, nota ou cobertura. Layout em camadas:
 *   1. capa executiva (identidade + KPIs + filtros)
 *   2. classificação macro (cabeçalho repetido por página)
 *   3. notas por pilar
 *   4. legenda, metodologia, política e qualidade dos dados
 */

import {
  buildFormattedLandscapePdf,
  formatPdfMoneyBr,
  formatPdfNumberBr,
  formatPdfPercentBr,
  pdfTableRowLineCount,
  type PdfLine,
  type PdfTone,
} from "../proposalInternalManagementPdfLayout.js";
import {
  SUPPLIER_EVALUATION_RATING_LABELS,
  SUPPLIER_EVALUATION_RATING_VALUES,
} from "./supplierPerformance.js";
import type {
  SupplierClassificationReport,
  SupplierClassificationReportRow,
} from "./supplierClassificationReport.js";

export const SUPPLIER_CLASSIFICATION_PDF_TABLE_LINE_BUDGET = 22;

const MACRO_HEADERS = [
  "Fornecedor",
  "Documento",
  "Situação",
  "Classificação",
  "Nota",
  "Cobertura",
  "Compras no período",
];

/** Soma 770 pt (largura útil da paisagem). */
const MACRO_COL_WIDTHS = [220, 108, 88, 108, 62, 92, 92];

const PILLAR_HEADERS = [
  "Fornecedor",
  "Qualidade",
  "Prazo",
  "Conformidade",
  "Atendimento",
  "Nota",
  "Última avaliação",
];

const PILLAR_COL_WIDTHS = [230, 78, 62, 100, 96, 62, 142];

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

function classificationTone(code: SupplierClassificationReportRow["classification"]["code"]): PdfTone {
  if (code === "APPROVED") return "success";
  if (code === "CONDITIONAL") return "warning";
  if (code === "NOT_APPROVED") return "danger";
  return "muted";
}

function coverageCell(row: SupplierClassificationReportRow): string {
  const ratio = `${row.evaluatedOrders} / ${row.eligibleOrders}`;
  if (row.coverage == null) return `${ratio} · —`;
  return `${ratio} · ${formatPdfPercentBr(row.coverage * 100)}`;
}

function spendCell(row: SupplierClassificationReportRow, unavailable: boolean): string {
  const money = unavailable ? "Indisponível" : formatPdfMoneyBr(row.spend);
  return `${money} · ${row.orderCount} ped.`;
}

function scoreCell(row: SupplierClassificationReportRow): string {
  if (row.overallScore == null) return "—";
  const score = formatPdfNumberBr(row.overallScore);
  return row.scaleMax == null ? score : `${score} / ${row.scaleMax}`;
}

function macroRow(row: SupplierClassificationReportRow, unavailable: boolean): string[] {
  return [
    row.name,
    row.document ?? "—",
    row.registryStatusLabel,
    row.classification.label,
    scoreCell(row),
    coverageCell(row),
    spendCell(row, unavailable),
  ];
}

function pillarRow(row: SupplierClassificationReportRow): string[] {
  return [
    row.name,
    formatPdfNumberBr(row.qualityScore),
    formatPdfNumberBr(row.deliveryScore),
    formatPdfNumberBr(row.conformityScore),
    formatPdfNumberBr(row.serviceScore),
    scoreCell(row),
    dateBr(row.lastEvaluationAt),
  ];
}

function chunkByVisualLines(
  rows: readonly SupplierClassificationReportRow[],
  headers: string[],
  widths: number[],
  cellsOf: (row: SupplierClassificationReportRow) => string[]
): SupplierClassificationReportRow[][] {
  if (rows.length === 0) return [];
  const blocks: SupplierClassificationReportRow[][] = [];
  let current: SupplierClassificationReportRow[] = [];
  let used = pdfTableRowLineCount(headers, widths);
  for (const row of rows) {
    const height = pdfTableRowLineCount(cellsOf(row), widths);
    if (current.length > 0 && used + height > SUPPLIER_CLASSIFICATION_PDF_TABLE_LINE_BUDGET) {
      blocks.push(current);
      current = [];
      used = pdfTableRowLineCount(headers, widths);
    }
    current.push(row);
    used += height;
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function reportTable(
  headers: string[],
  rows: string[][],
  colWidths: number[],
  extras: Pick<Extract<PdfLine, { type: "table" }>, "accentColumn" | "rowAccents"> = {}
): PdfLine {
  return {
    type: "table",
    headers,
    rows,
    colWidths,
    wrapCells: true,
    zebra: true,
    headerStyle: "navy",
    ...extras,
  };
}

export function buildSupplierClassificationPdfLines(
  report: SupplierClassificationReport
): PdfLine[] {
  const { metadata, summary, rows } = report;
  const unavailable = metadata.population.financialDataStatus === "UNAVAILABLE";
  const lines: PdfLine[] = [];

  lines.push({
    type: "masthead",
    kicker: "IndusCost  ·  Compras  ·  Performance",
    title: metadata.title,
    subtitle: metadata.purpose,
  });
  lines.push({
    type: "meta",
    columns: [
      { label: "Período", value: periodLabel(report) },
      { label: "Emitido em", value: dateTimeBr(metadata.generatedAt) },
      { label: "Última sincronização Nomus", value: dateTimeBr(metadata.lastSyncedAt) },
      {
        label: "Qualidade financeira",
        value: `${metadata.population.financialDataStatus} · ${metadata.population.ordersWithFinancialValue} de ${metadata.population.orderCount} pedidos com valor`,
      },
    ],
  });
  lines.push({
    type: "kpis",
    items: [
      {
        label: "Aprovados",
        value: String(summary.approved),
        hint: "Nota geral ≥ 3,00",
        tone: "success",
      },
      {
        label: "Condicionais",
        value: String(summary.conditional),
        hint: "Nota geral de 2,00 a 2,99",
        tone: "warning",
      },
      {
        label: "Não aprovados",
        value: String(summary.notApproved),
        hint: "Nota geral < 2,00",
        tone: "danger",
      },
      {
        label: "Não avaliados",
        value: String(summary.notEvaluated),
        hint: "Sem nota — não é zero",
        tone: "muted",
      },
      {
        label: "Metodologia anterior",
        value: String(summary.legacyMethodology),
        hint: "V1 (0 a 10), sem faixa vigente",
        tone: "info",
      },
    ],
  });
  lines.push({
    type: "kpis",
    items: [
      {
        label: "Fornecedores na população",
        value: String(summary.suppliersInPopulation),
        hint: `${summary.suppliersEvaluated} avaliados · ${summary.suppliersWithoutEvaluation} sem avaliação`,
      },
      {
        label: "Cobertura global",
        value: summary.coverage == null ? "—" : formatPdfPercentBr(summary.coverage * 100),
        hint: `${summary.evaluatedOrders} de ${summary.eligibleOrders} pedidos`,
        tone: "info",
      },
      {
        label: "Pedidos pendentes",
        value: String(summary.pendingOrders),
        hint: "Elegíveis ainda sem avaliação",
        tone: summary.pendingOrders > 0 ? "warning" : "neutral",
      },
      {
        label: "Pedidos avaliados",
        value: String(summary.evaluatedOrders),
        hint: `${summary.eligibleOrders} elegíveis no período`,
      },
    ],
  });
  lines.push({
    type: "callout",
    text: `Fonte: ${metadata.dataSource}. Metodologia ${metadata.methodology.id} (versão ${metadata.methodology.version}, escala ${metadata.methodology.scaleMin} a ${metadata.methodology.scaleMax}). Política ${metadata.policy.id} (versão ${metadata.policy.version}) — critério interno da empresa.`,
  });
  if (!metadata.evaluation.available && metadata.evaluation.reason) {
    lines.push({ type: "callout", text: `Avaliação: ${metadata.evaluation.reason}` });
  }
  lines.push({ type: "subtitle", text: "Filtros aplicados" });
  lines.push({
    type: "text",
    text: metadata.appliedFilters.map((filter) => `${filter.label}: ${filter.value}`).join("   ·   "),
  });
  lines.push({ type: "pagebreak" });

  lines.push({
    type: "subtitle",
    text: "Classificação de desempenho",
  });
  lines.push({
    type: "text",
    text: "Situação cadastral e classificação de desempenho são informações distintas. Valor comprado e número de pedidos são contexto e não entram no cálculo da faixa.",
  });
  const macroBlocks = chunkByVisualLines(rows, MACRO_HEADERS, MACRO_COL_WIDTHS, (row) =>
    macroRow(row, unavailable)
  );
  if (macroBlocks.length === 0) {
    lines.push({
      type: "text",
      text: "Nenhum fornecedor na população para o período e filtros aplicados.",
    });
  }
  macroBlocks.forEach((block, index) => {
    if (index > 0) lines.push({ type: "subtitle", text: "Classificação de desempenho (continuação)" });
    lines.push(
      reportTable(
        MACRO_HEADERS,
        block.map((row) => macroRow(row, unavailable)),
        MACRO_COL_WIDTHS,
        {
          accentColumn: 3,
          rowAccents: block.map((row) => classificationTone(row.classification.code)),
        }
      )
    );
    lines.push({ type: "pagebreak" });
  });
  if (macroBlocks.length === 0) lines.push({ type: "pagebreak" });

  lines.push({
    type: "subtitle",
    text: "Notas por pilar avaliado",
  });
  lines.push({
    type: "text",
    text: `Quatro critérios com peso de 25% cada, na escala da metodologia em que a nota foi consolidada. Ausência de nota permanece em branco — nunca vira zero.`,
  });
  const pillarBlocks = chunkByVisualLines(rows, PILLAR_HEADERS, PILLAR_COL_WIDTHS, pillarRow);
  if (pillarBlocks.length === 0) {
    lines.push({
      type: "text",
      text: "Sem fornecedores para detalhar notas por pilar.",
    });
  }
  pillarBlocks.forEach((block, index) => {
    if (index > 0) lines.push({ type: "subtitle", text: "Notas por pilar avaliado (continuação)" });
    lines.push(reportTable(PILLAR_HEADERS, block.map(pillarRow), PILLAR_COL_WIDTHS));
    lines.push({ type: "pagebreak" });
  });
  if (pillarBlocks.length === 0) lines.push({ type: "pagebreak" });

  lines.push({ type: "subtitle", text: "Legenda da classificação de desempenho" });
  lines.push(
    reportTable(
      ["Faixa", "Critério"],
      metadata.policy.bands.map((band) => [band.label, band.rule]),
      [200, 570]
    )
  );
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Critérios e pesos da metodologia vigente" });
  lines.push(
    reportTable(
      ["Critério", "Peso"],
      metadata.methodology.criteria.map((criterion) => [criterion.label, `${criterion.weightPercent}%`]),
      [620, 150]
    )
  );
  lines.push({ type: "pagebreak" });

  lines.push({ type: "subtitle", text: "Régua da nota por pedido" });
  lines.push(
    reportTable(
      ["Nota", "Significado"],
      SUPPLIER_EVALUATION_RATING_VALUES.map((value) => [String(value), SUPPLIER_EVALUATION_RATING_LABELS[value]]),
      [80, 690]
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
    reportTable(
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
        ["Não classificados (metodologia anterior)", String(summary.legacyMethodology)],
      ],
      [420, 350]
    )
  );
  lines.push({ type: "spacer" });
  lines.push({
    type: "callout",
    text: "Pedido elegível sem avaliação não recebe nota zero: permanece na cobertura e é sinalizado como pendente. A evidência detalhada por pedido está na exportação XLSX (aba Evidências).",
  });
  if (report.evidence != null) {
    lines.push({
      type: "text",
      text: `Evidência detalhada por pedido: ${report.evidence.length} registros na aba Evidências do XLSX.`,
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
    chrome: {
      kicker: "IndusCost  ·  Compras  ·  Performance",
      title: "Classificação de fornecedores",
    },
    footerNote: `Período ${periodLabel(report)}  ·  gerado em ${dateTimeBr(report.metadata.generatedAt)}  ·  critério interno`,
  });
}

export const formatSupplierClassificationPdfMoney = formatPdfMoneyBr;
