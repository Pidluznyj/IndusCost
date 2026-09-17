/**
 * PDF da Classificação de fornecedores — documento de auditoria, não print de tela.
 *
 * Reutiliza o gerador PDF já existente do projeto
 * (`proposalInternalManagementPdfLayout`, A4 paisagem, tabelas + WinAnsi).
 * NÃO recalcula regra: consome `SupplierClassificationReport`.
 *
 * A tabela principal é quebrada em blocos que cabem em uma página, cada bloco
 * reemitindo o cabeçalho — é assim que o cabeçalho "repete na página nova" sem
 * mudar a semântica do layout compartilhado.
 */

import {
  buildFormattedLandscapePdf,
  formatPdfMoneyBr,
  formatPdfNumberBr,
  formatPdfPercentBr,
  type PdfLine,
} from "../proposalInternalManagementPdfLayout.js";
import {
  SUPPLIER_EVALUATION_RATING_LABELS,
  SUPPLIER_EVALUATION_RATING_VALUES,
} from "./supplierPerformance.js";
import type { SupplierClassificationCode } from "./supplierClassificationPolicy.js";
import type {
  SupplierClassificationReport,
  SupplierClassificationReportRow,
} from "./supplierClassificationReport.js";

/** Linhas por página da tabela principal — cabe na altura útil da paisagem. */
export const SUPPLIER_CLASSIFICATION_PDF_ROWS_PER_PAGE = 26;

/** Rótulos curtos: a coluna da tabela paisagem não comporta o rótulo completo. */
const SHORT_CLASSIFICATION_LABELS: Record<SupplierClassificationCode, string> = {
  APPROVED: "Aprovado",
  CONDITIONAL: "Condicional",
  NOT_APPROVED: "Nao aprovado",
  NOT_EVALUATED: "Nao avaliado",
  LEGACY_METHODOLOGY: "Metodologia V1",
};

const TABLE_HEADERS = [
  "Fornecedor",
  "Documento",
  "Sit. cadastral",
  "Classificacao",
  "Nota",
  "Qualid.",
  "Prazo",
  "Conform.",
  "Atend.",
  "Aval./Eleg.",
  "Cobert.",
  "Ult. aval.",
];

/** Soma exata da largura útil da paisagem (842 - 2 x 36 = 770 pt). */
const TABLE_COL_WIDTHS = [150, 96, 74, 80, 42, 42, 40, 46, 46, 52, 46, 56];

function dateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function dateBr(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function periodLabel(report: SupplierClassificationReport): string {
  const { from, to } = report.metadata.period;
  return `${from ?? "inicio"} a ${to ?? "hoje"}`;
}

function tableRow(row: SupplierClassificationReportRow): string[] {
  return [
    row.name,
    row.document ?? "-",
    row.registryStatusLabel,
    SHORT_CLASSIFICATION_LABELS[row.classification.code],
    formatPdfNumberBr(row.overallScore),
    formatPdfNumberBr(row.qualityScore),
    formatPdfNumberBr(row.deliveryScore),
    formatPdfNumberBr(row.conformityScore),
    formatPdfNumberBr(row.serviceScore),
    `${row.evaluatedOrders} / ${row.eligibleOrders}`,
    row.coverage == null ? "-" : formatPdfPercentBr(row.coverage * 100),
    dateBr(row.lastEvaluationAt),
  ];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildSupplierClassificationPdfLines(
  report: SupplierClassificationReport
): PdfLine[] {
  const { metadata, summary, rows } = report;
  const lines: PdfLine[] = [];

  /* ---------- Página 1 — capa institucional ---------- */
  lines.push({ type: "title", text: metadata.title });
  lines.push({ type: "banner", text: metadata.purpose });
  lines.push({ type: "kv", label: "Periodo", value: periodLabel(report) });
  lines.push({ type: "kv", label: "Emitido em", value: dateTimeBr(metadata.generatedAt) });
  lines.push({ type: "kv", label: "Fonte dos dados", value: metadata.dataSource });
  lines.push({
    type: "kv",
    label: "Ultima sincronizacao Nomus",
    value: dateTimeBr(metadata.lastSyncedAt),
  });
  lines.push({
    type: "kv",
    label: "Qualidade do dado financeiro",
    value: `${metadata.population.financialDataStatus} — ${metadata.population.ordersWithFinancialValue} de ${metadata.population.orderCount} pedidos com valor`,
  });
  lines.push({
    type: "kv",
    label: "Metodologia de avaliacao",
    value: `${metadata.methodology.id} (versao ${metadata.methodology.version}) — escala ${metadata.methodology.scaleMin} a ${metadata.methodology.scaleMax}`,
  });
  lines.push({
    type: "kv",
    label: "Politica de classificacao",
    value: `${metadata.policy.id} (versao ${metadata.policy.version}) — criterio interno da empresa`,
  });
  if (!metadata.evaluation.available && metadata.evaluation.reason) {
    lines.push({ type: "kv", label: "Avaliacao", value: metadata.evaluation.reason });
  }

  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Filtros aplicados" });
  lines.push({
    type: "text",
    text: metadata.appliedFilters.map((filter) => `${filter.label}: ${filter.value}`).join(" · "),
  });

  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Resumo executivo" });
  lines.push({
    type: "table",
    headers: ["Indicador", "Valor"],
    rows: [
      ["Fornecedores na populacao", String(summary.suppliersInPopulation)],
      ["Fornecedores avaliados", String(summary.suppliersEvaluated)],
      ["Fornecedores sem avaliacao", String(summary.suppliersWithoutEvaluation)],
      ["Aprovados", String(summary.approved)],
      ["Condicionais", String(summary.conditional)],
      ["Nao aprovados", String(summary.notApproved)],
      ["Nao avaliados", String(summary.notEvaluated)],
      ["Nao classificados (metodologia anterior)", String(summary.legacyMethodology)],
      ["Pedidos elegiveis", String(summary.eligibleOrders)],
      ["Pedidos avaliados", String(summary.evaluatedOrders)],
      ["Pedidos pendentes de avaliacao", String(summary.pendingOrders)],
      [
        "Cobertura global",
        summary.coverage == null ? "Sem pedidos elegiveis" : formatPdfPercentBr(summary.coverage * 100),
      ],
    ],
    colWidths: [420, 350],
  });
  lines.push({ type: "pagebreak" });

  /* ---------- Tabela principal — cabeçalho repetido por página ---------- */
  const blocks = chunk(rows, SUPPLIER_CLASSIFICATION_PDF_ROWS_PER_PAGE);
  if (blocks.length === 0) {
    lines.push({ type: "subtitle", text: "Classificacao de fornecedores" });
    lines.push({
      type: "text",
      text: "Nenhum fornecedor na populacao para o periodo e filtros aplicados.",
    });
    lines.push({ type: "pagebreak" });
  }
  blocks.forEach((block) => {
    lines.push({
      type: "table",
      headers: TABLE_HEADERS,
      rows: block.map(tableRow),
      colWidths: TABLE_COL_WIDTHS,
    });
    lines.push({ type: "pagebreak" });
  });

  /* ---------- Legenda, metodologia e critérios ---------- */
  lines.push({ type: "subtitle", text: "Legenda da classificacao de desempenho" });
  lines.push({
    type: "table",
    headers: ["Faixa", "Criterio"],
    rows: metadata.policy.bands.map((band) => [band.label, band.rule]),
    colWidths: [200, 570],
  });
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Abreviacoes da tabela" });
  lines.push({
    type: "text",
    text: "Qualid. = Qualidade do produto/material · Conform. = Quantidade/conformidade · Atend. = Atendimento/solucao de problemas · Aval./Eleg. = pedidos avaliados sobre pedidos elegiveis · Cobert. = cobertura de avaliacao · Ult. aval. = data da ultima avaliacao registrada no periodo.",
  });
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Criterios e pesos" });
  lines.push({
    type: "table",
    headers: ["Criterio", "Peso"],
    rows: metadata.methodology.criteria.map((criterion) => [
      criterion.label,
      `${criterion.weightPercent}%`,
    ]),
    colWidths: [620, 150],
  });
  lines.push({ type: "pagebreak" });

  lines.push({ type: "subtitle", text: "Regua da nota por pedido" });
  lines.push({
    type: "table",
    headers: ["Nota", "Significado"],
    rows: SUPPLIER_EVALUATION_RATING_VALUES.map((value) => [
      String(value),
      SUPPLIER_EVALUATION_RATING_LABELS[value],
    ]),
    colWidths: [100, 670],
  });
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Metodologia de avaliacao" });
  for (const text of metadata.methodology.text) lines.push({ type: "text", text });
  lines.push({ type: "pagebreak" });

  lines.push({ type: "subtitle", text: "Politica de classificacao (criterio interno)" });
  for (const text of metadata.policy.text) lines.push({ type: "text", text });
  lines.push({ type: "spacer" });
  lines.push({ type: "subtitle", text: "Qualidade dos dados e cobertura" });
  lines.push({
    type: "table",
    headers: ["Indicador", "Valor"],
    rows: [
      ["Pedidos na populacao", String(metadata.population.orderCount)],
      ["Fornecedores na populacao", String(metadata.population.supplierCount)],
      ["Pedidos cancelados excluidos", String(metadata.population.canceledExcluded)],
      ["Pedidos com valor financeiro", String(metadata.population.ordersWithFinancialValue)],
      ["Pedidos sem valor financeiro", String(metadata.population.ordersWithoutValue)],
      ["Status do dado financeiro", metadata.population.financialDataStatus],
      ["Moeda apresentada", metadata.currency.selected],
      ["Base multimoeda", metadata.currency.multiCurrency ? "Sim" : "Nao"],
      [
        "Cobertura global",
        summary.coverage == null ? "Sem pedidos elegiveis" : formatPdfPercentBr(summary.coverage * 100),
      ],
    ],
    colWidths: [420, 350],
  });
  lines.push({ type: "spacer" });
  lines.push({
    type: "text",
    text: "Pedido elegivel sem avaliacao nao recebe nota zero: permanece contabilizado na cobertura e sinalizado como pendente. Valor comprado e numero de pedidos sao informacao de contexto e nao entram no calculo da classificacao.",
  });
  if (report.evidence != null) {
    lines.push({
      type: "text",
      text: `Evidencia detalhada por pedido: ${report.evidence.length} registros disponiveis na exportacao XLSX (aba Evidencias).`,
    });
  } else {
    lines.push({
      type: "text",
      text: "Evidencia detalhada por pedido disponivel na exportacao XLSX (aba Evidencias).",
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
    footerNote: `${report.metadata.title} — periodo ${periodLabel(report)} — gerado em ${dateTimeBr(
      report.metadata.generatedAt
    )}`,
  });
}

/** Usado no rodapé/legenda quando o valor monetário precisa aparecer no PDF. */
export const formatSupplierClassificationPdfMoney = formatPdfMoneyBr;
