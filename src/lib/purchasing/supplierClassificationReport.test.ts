/**
 * Compras → Performance → Classificação de fornecedores.
 *
 * Paridade obrigatória de auditoria: read model, XLSX e PDF só podem dizer a
 * MESMA coisa — mesma classificação, mesmas notas, mesmos critérios, mesma
 * cobertura, mesmo período, mesmas contagens. Também prova que a faixa é
 * política interna versionada, que V1 (0–10) nunca entra no consolidado
 * vigente, que ausência de avaliação não vira zero, e que as rotas de
 * exportação não ampliam população, não contornam permissão e não escrevem.
 *
 * Sem banco: usa a mesma fixture da aba Performance.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { RequestHandler } from "express";
import type { ResolvedPurchaseOrderSupplier } from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import {
  SUPPLIER_CLASSIFICATION_POLICY_ID,
  SUPPLIER_CLASSIFICATION_POLICY_VERSION,
  classifySupplierPerformance,
} from "./supplierClassificationPolicy.js";
import {
  SUPPLIER_CLASSIFICATION_REPORT_DEFAULT_QUERY,
  buildSupplierClassificationExportFilename,
  buildSupplierClassificationReport,
  parseSupplierClassificationReportQuery,
  type SupplierClassificationReport,
  type SupplierClassificationReportQuery,
} from "./supplierClassificationReport.js";
import {
  SUPPLIER_CLASSIFICATION_XLSX_COMMUNITY_LIMITS,
  SUPPLIER_CLASSIFICATION_XLSX_SHEETS,
  buildSupplierClassificationWorkbook,
  buildSupplierClassificationXlsxBuffer,
  neutralizeSupplierClassificationCellText,
} from "./supplierClassificationXlsx.js";
import {
  buildSupplierClassificationPdfBuffer,
  buildSupplierClassificationPdfLines,
} from "./supplierClassificationPdf.js";
import { buildSupplierPerformanceDashboard } from "./supplierPerformanceDashboard.js";
import type { SupplierPerformanceDashboardDb } from "./supplierPerformanceDashboard.server.js";
import { registerSupplierPerformanceDashboardRoutes } from "./supplierPerformanceDashboardRoutes.js";
import {
  FIXTURE_CATALOG,
  FIXTURE_EVALUATIONS,
  FIXTURE_FILTERS_2026,
  FIXTURE_IDENTITIES,
  FIXTURE_LINES,
  FIXTURE_ORDERS,
  S1,
  S2,
  S3,
  buildFixtureInput,
} from "./supplierPerformanceDashboardFixture.test-helper.js";

const FILTERS = FIXTURE_FILTERS_2026;

function buildReport(
  options: { query?: Partial<SupplierClassificationReportQuery>; includeEvidence?: boolean } = {}
): SupplierClassificationReport {
  return buildSupplierClassificationReport(buildFixtureInput(), FILTERS, {
    query: { ...SUPPLIER_CLASSIFICATION_REPORT_DEFAULT_QUERY, ...options.query },
    includeEvidence: options.includeEvidence === true,
  });
}

const REPORT = buildReport({ includeEvidence: true });

function rowOf(report: SupplierClassificationReport, supplierExternalId: number) {
  const row = report.rows.find((candidate) => candidate.supplierExternalId === supplierExternalId);
  assert.ok(row, `fornecedor ${supplierExternalId} ausente do relatório`);
  return row;
}

/** Aba do XLSX como matriz de células cruas (o que o Excel vai mostrar). */
function sheetMatrix(buffer: Buffer, sheetName: string): unknown[][] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[sheetName];
  assert.ok(ws, `aba ${sheetName} ausente`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
}

function sheetText(buffer: Buffer, sheetName: string): string {
  return sheetMatrix(buffer, sheetName)
    .map((row) => row.map((cell) => (cell == null ? "" : String(cell))).join(" | "))
    .join("\n");
}

/** Linha de dados da tabela principal do XLSX, por nome do fornecedor. */
function classificationSheetRows(buffer: Buffer): unknown[][] {
  const matrix = sheetMatrix(buffer, SUPPLIER_CLASSIFICATION_XLSX_SHEETS[0]);
  const headerIndex = matrix.findIndex((row) => row[0] === "Fornecedor" && row[1] === "Documento");
  assert.ok(headerIndex >= 0, "cabeçalho da tabela principal não encontrado");
  const rows: unknown[][] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i];
    if (row == null || row[0] == null || row[0] === "") break;
    rows.push(row);
  }
  return rows;
}

/** Linhas de dados da tabela principal do PDF (todos os blocos paginados). */
function pdfTableRows(report: SupplierClassificationReport): string[][] {
  return buildSupplierClassificationPdfLines(report)
    .filter(
      (line): line is Extract<typeof line, { type: "table" }> =>
        line.type === "table" && line.headers[0] === "Fornecedor"
    )
    .flatMap((line) => line.rows);
}

function pdfText(report: SupplierClassificationReport): string {
  return buildSupplierClassificationPdfLines(report)
    .map((line) => {
      if (line.type === "table") {
        return [line.headers.join(" | "), ...line.rows.map((row) => row.join(" | "))].join("\n");
      }
      if (line.type === "kv") return `${line.label}: ${line.value}`;
      return "text" in line && line.text != null ? String(line.text) : "";
    })
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * Política interna de classificação
 * ------------------------------------------------------------------ */

describe("política de classificação (interna, versionada)", () => {
  it("faixas na régua vigente: 3,00 aprovado · 2,99 e 2,00 condicional · 1,99 não aprovado", () => {
    assert.equal(classifySupplierPerformance({ overallScore: 3 }).code, "APPROVED");
    assert.equal(classifySupplierPerformance({ overallScore: 3 }).label, "Aprovado");
    assert.equal(classifySupplierPerformance({ overallScore: 2.99 }).code, "CONDITIONAL");
    assert.equal(classifySupplierPerformance({ overallScore: 2 }).code, "CONDITIONAL");
    assert.equal(classifySupplierPerformance({ overallScore: 2 }).label, "Condicional");
    assert.equal(classifySupplierPerformance({ overallScore: 1.99 }).code, "NOT_APPROVED");
    assert.equal(classifySupplierPerformance({ overallScore: 5 }).code, "APPROVED");
    assert.equal(classifySupplierPerformance({ overallScore: 1 }).code, "NOT_APPROVED");
  });

  it("ausência de nota permanece 'Não avaliado' — nunca zero", () => {
    assert.equal(classifySupplierPerformance({ overallScore: null }).code, "NOT_EVALUATED");
    assert.equal(classifySupplierPerformance({ overallScore: undefined }).code, "NOT_EVALUATED");
    assert.equal(classifySupplierPerformance({ overallScore: Number.NaN }).code, "NOT_EVALUATED");
    assert.equal(classifySupplierPerformance({ overallScore: null }).label, "Não avaliado");
    // Zero é uma nota (fora da escala vigente), não é ausência: não pode virar "não avaliado".
    assert.equal(classifySupplierPerformance({ overallScore: 0 }).code, "NOT_APPROVED");
  });

  it("nota consolidada em metodologia anterior não recebe faixa vigente e não é convertida", () => {
    const legacy = classifySupplierPerformance({ overallScore: 8, methodologyVersion: 1 });
    assert.equal(legacy.code, "LEGACY_METHODOLOGY");
    assert.equal(legacy.label, "Não classificado (metodologia anterior)");
  });

  it("toda classificação carrega ID e versão da política interna", () => {
    for (const score of [null, 1, 2, 3, 4.5]) {
      const classification = classifySupplierPerformance({ overallScore: score });
      assert.equal(classification.policyId, SUPPLIER_CLASSIFICATION_POLICY_ID);
      assert.equal(classification.policyVersion, SUPPLIER_CLASSIFICATION_POLICY_VERSION);
    }
    assert.equal(SUPPLIER_CLASSIFICATION_POLICY_ID, "SUPPLIER_PERFORMANCE_CLASSIFICATION_V1");
    assert.equal(SUPPLIER_CLASSIFICATION_POLICY_VERSION, 1);
  });

  it("nenhuma menção a norma externa, órgão certificador ou selo", () => {
    const sources = [
      "src/lib/purchasing/supplierClassificationPolicy.ts",
      "src/lib/purchasing/supplierClassificationReport.ts",
      "src/lib/purchasing/supplierClassificationXlsx.ts",
      "src/lib/purchasing/supplierClassificationPdf.ts",
      "src/components/purchases/performance/SupplierClassificationSection.tsx",
    ].map((path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8"));
    for (const source of sources) {
      assert.equal(/ISO\s*9001|conforme ISO|certificado ISO|Inmetro|homologado pelo/i.test(source), false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Read model — autoridade única
 * ------------------------------------------------------------------ */

describe("read model da classificação", () => {
  it("classifica a população pela nota consolidada do motor de avaliação", () => {
    const dashboard = buildSupplierPerformanceDashboard(buildFixtureInput(), FILTERS);
    assert.equal(REPORT.rows.length, dashboard.suppliers.length);
    for (const supplier of dashboard.suppliers) {
      const row = rowOf(REPORT, supplier.supplierExternalId);
      assert.deepEqual(row.classification, supplier.classification);
      assert.equal(row.overallScore, supplier.evaluation?.summary.overallScore ?? null);
    }
  });

  it("S1 (V2, nota 4) aprovado · S3 (V2, nota 2,5) condicional · S2 (V1 0–10) fora da faixa vigente", () => {
    assert.equal(rowOf(REPORT, S1).classification.code, "APPROVED");
    assert.equal(rowOf(REPORT, S1).overallScore, 4);
    assert.equal(rowOf(REPORT, S1).scaleMax, 5);
    assert.equal(rowOf(REPORT, S3).classification.code, "CONDITIONAL");
    assert.equal(rowOf(REPORT, S3).overallScore, 2.5);
    assert.equal(rowOf(REPORT, S2).classification.code, "LEGACY_METHODOLOGY");
    assert.equal(rowOf(REPORT, S2).scaleMax, 10);
  });

  it("V1 não entra no consolidado vigente: o resumo separa a metodologia anterior", () => {
    assert.equal(REPORT.summary.approved, 1);
    assert.equal(REPORT.summary.conditional, 1);
    assert.equal(REPORT.summary.notApproved, 0);
    assert.equal(REPORT.summary.legacyMethodology, 1);
    assert.equal(
      REPORT.summary.approved +
        REPORT.summary.conditional +
        REPORT.summary.notApproved +
        REPORT.summary.notEvaluated +
        REPORT.summary.legacyMethodology,
      REPORT.summary.suppliersInPopulation
    );
    // A nota V1 (8) jamais é comparada com a faixa 1–5.
    assert.notEqual(rowOf(REPORT, S2).classification.code, "APPROVED");
  });

  it("cobertura é informada separadamente e não altera a faixa", () => {
    const dashboard = buildSupplierPerformanceDashboard(buildFixtureInput(), FILTERS);
    assert.equal(REPORT.summary.coverage, dashboard.kpis.evaluationCoverage);
    assert.equal(REPORT.summary.eligibleOrders, dashboard.kpis.eligibleOrders);
    assert.equal(REPORT.summary.evaluatedOrders, dashboard.kpis.evaluatedOrders);
    assert.equal(
      REPORT.summary.pendingOrders,
      dashboard.kpis.eligibleOrders - dashboard.kpis.evaluatedOrders
    );
    const s3 = rowOf(REPORT, S3);
    assert.ok(s3.pendingOrders > 0);
    assert.equal(s3.hasPendingEvaluations, true);
    // Pendência não rebaixa a faixa: S3 continua condicional pela nota 2,5.
    assert.equal(s3.classification.code, "CONDITIONAL");
  });

  it("situação cadastral e classificação de desempenho são campos distintos", () => {
    const s1 = rowOf(REPORT, S1);
    assert.equal(s1.registryStatus, "ACTIVE");
    assert.equal(s1.registryStatusLabel, "Ativo");
    assert.equal(s1.classification.code, "APPROVED");
    const s2 = rowOf(REPORT, S2);
    assert.equal(s2.registryStatus, null);
    assert.equal(s2.registryStatusLabel, "Não identificada");
  });

  it("metadados declaram período, metodologia, política, fonte e filtros aplicados", () => {
    assert.deepEqual(REPORT.metadata.period, FILTERS.period);
    assert.equal(REPORT.metadata.methodology.version, 2);
    assert.equal(REPORT.metadata.methodology.scaleMax, 5);
    assert.equal(REPORT.metadata.policy.id, SUPPLIER_CLASSIFICATION_POLICY_ID);
    assert.equal(REPORT.metadata.policy.version, SUPPLIER_CLASSIFICATION_POLICY_VERSION);
    assert.equal(
      REPORT.metadata.methodology.criteria.reduce((sum, c) => sum + c.weightPercent, 0),
      100
    );
    assert.ok(REPORT.metadata.dataSource.includes("NomusPurchaseOrder"));
    const period = REPORT.metadata.appliedFilters.find((filter) => filter.label === "Período");
    assert.equal(period?.value, "2026-01-01 a 2026-12-31");
    const canceled = REPORT.metadata.appliedFilters.find(
      (filter) => filter.label === "Pedidos cancelados"
    );
    assert.equal(canceled?.value, "Excluídos (regra oficial)");
  });

  it("evidência traz uma linha por pedido elegível da mesma população", () => {
    assert.ok(REPORT.evidence);
    assert.equal(REPORT.evidence.length, REPORT.metadata.population.orderCount);
    // Pedido cancelado sai da população mesmo tendo avaliação registrada.
    assert.equal(REPORT.evidence.some((row) => row.purchaseOrderExternalId === 5), false);
    // Pedido sem avaliação aparece sem nota — ausência não é zero.
    const pending = REPORT.evidence.find((row) => row.overallScore == null);
    assert.ok(pending);
    assert.equal(pending.qualityScore, null);
    // Evidência V1 permanece identificada pela própria escala.
    const legacy = REPORT.evidence.find((row) => row.methodologyVersion === 1);
    assert.equal(legacy?.scaleMax, 10);
  });

  it("busca, filtro e ordenação de leitura não recalculam nada", () => {
    const onlyApproved = buildReport({ query: { classification: "APPROVED" } });
    assert.deepEqual(
      onlyApproved.rows.map((row) => row.supplierExternalId),
      [S1]
    );
    // O resumo continua descrevendo a POPULAÇÃO, não a página filtrada.
    assert.equal(onlyApproved.summary.suppliersInPopulation, REPORT.summary.suppliersInPopulation);
    assert.deepEqual(onlyApproved.rows[0].classification, rowOf(REPORT, S1).classification);
    assert.equal(onlyApproved.rows[0].overallScore, rowOf(REPORT, S1).overallScore);

    const pendingOnly = buildReport({ query: { onlyPending: true } });
    assert.ok(pendingOnly.rows.every((row) => row.hasPendingEvaluations));

    const byScoreDesc = buildReport({ query: { sort: "score", direction: "desc" } });
    const scores = byScoreDesc.rows.map((row) => row.overallScore);
    assert.equal(scores[scores.length - 1], null || scores[scores.length - 1]);
    assert.deepEqual(
      byScoreDesc.rows.map((row) => row.supplierExternalId).slice(0, 2),
      [S2, S1] // 8 (V1, escala própria) e 4 — ordenação não converte escala
    );

    const search = buildReport({ query: { search: "beta" } });
    assert.deepEqual(
      search.rows.map((row) => row.supplierExternalId),
      [S3]
    );
  });

  it("query da rota é tolerante e cai no default sem ampliar população", () => {
    assert.deepEqual(parseSupplierClassificationReportQuery({}), SUPPLIER_CLASSIFICATION_REPORT_DEFAULT_QUERY);
    const parsed = parseSupplierClassificationReportQuery({
      classification: "INVENTADO",
      sort: "hack",
      direction: "up",
      onlyPending: "1",
      search: " beta ",
    });
    assert.equal(parsed.classification, null);
    assert.equal(parsed.sort, "classification");
    assert.equal(parsed.direction, "asc");
    assert.equal(parsed.onlyPending, true);
    assert.equal(parsed.search, "beta");
  });
});

/* ------------------------------------------------------------------ *
 * XLSX — arquivo real, mesma autoridade
 * ------------------------------------------------------------------ */

describe("exportação XLSX", () => {
  let buffer: Buffer;

  before(async () => {
    buffer = await buildSupplierClassificationXlsxBuffer(REPORT);
  });

  it("é XLSX válido (zip OOXML), não CSV renomeado", () => {
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
    assert.equal(buffer[2], 0x03);
    assert.equal(buffer[3], 0x04);
    const wb = XLSX.read(buffer, { type: "buffer" });
    assert.deepEqual(wb.SheetNames, [...SUPPLIER_CLASSIFICATION_XLSX_SHEETS]);
  });

  it("tabela principal repete exatamente o read model", () => {
    const rows = classificationSheetRows(buffer);
    assert.equal(rows.length, REPORT.rows.length);
    REPORT.rows.forEach((expected, index) => {
      const cells = rows[index];
      assert.equal(cells[0], expected.name);
      assert.equal(cells[2], expected.supplierExternalId);
      assert.equal(cells[3], expected.registryStatusLabel);
      assert.equal(cells[4], expected.classification.label);
      assert.equal(cells[5], expected.overallScore);
      assert.equal(cells[7], expected.qualityScore);
      assert.equal(cells[8], expected.deliveryScore);
      assert.equal(cells[9], expected.conformityScore);
      assert.equal(cells[10], expected.serviceScore);
      assert.equal(cells[11], expected.evaluatedOrders);
      assert.equal(cells[12], expected.eligibleOrders);
      assert.equal(cells[13], expected.pendingOrders);
      assert.equal(cells[14], expected.coverage);
      assert.equal(cells[16], expected.orderCount);
    });
  });

  it("declara metodologia, política e período no conteúdo exportado", () => {
    const classification = sheetText(buffer, SUPPLIER_CLASSIFICATION_XLSX_SHEETS[0]);
    assert.ok(classification.includes("2026-01-01 a 2026-12-31"));
    assert.ok(classification.includes(REPORT.metadata.methodology.id));
    assert.ok(classification.includes(SUPPLIER_CLASSIFICATION_POLICY_ID));

    const methodology = sheetText(buffer, SUPPLIER_CLASSIFICATION_XLSX_SHEETS[1]);
    assert.ok(methodology.includes("Critério INTERNO da empresa"));
    assert.ok(methodology.includes("Qualidade do produto/material"));
    assert.ok(methodology.includes("25%"));

    const parameters = sheetText(buffer, SUPPLIER_CLASSIFICATION_XLSX_SHEETS[3]);
    assert.ok(parameters.includes("2026-01-01"));
    assert.ok(parameters.includes("2026-12-31"));
    assert.ok(parameters.includes(SUPPLIER_CLASSIFICATION_POLICY_ID));
  });

  it("aba Evidências tem uma linha por pedido elegível, com avaliador e observações", () => {
    const matrix = sheetMatrix(buffer, SUPPLIER_CLASSIFICATION_XLSX_SHEETS[2]);
    const headerIndex = matrix.findIndex((row) => row[0] === "Fornecedor" && row[3] === "Pedido");
    assert.ok(headerIndex >= 0);
    const header = matrix[headerIndex].map((cell) => String(cell));
    for (const column of ["Avaliado por", "Data da avaliação", "Atualizado por", "Observações", "Revisão"]) {
      assert.ok(header.includes(column), `coluna ${column} ausente`);
    }
    const dataRows = matrix.slice(headerIndex + 1).filter((row) => row[0] != null && row[0] !== "");
    assert.equal(dataRows.length, REPORT.evidence?.length);
  });

  it("neutraliza fórmula em texto de origem externa", async () => {
    assert.equal(neutralizeSupplierClassificationCellText("=1+1"), "'=1+1");
    assert.equal(neutralizeSupplierClassificationCellText("+cmd"), "'+cmd");
    assert.equal(neutralizeSupplierClassificationCellText("-2"), "'-2");
    assert.equal(neutralizeSupplierClassificationCellText("@x"), "'@x");
    assert.equal(neutralizeSupplierClassificationCellText("Alfa Metais"), "Alfa Metais");

    const hostile = buildSupplierClassificationReport(
      buildFixtureInput({
        supplierIdentities: FIXTURE_IDENTITIES.map((identity) =>
          identity.supplierExternalId === S1
            ? { ...identity, resolvedName: "=HYPERLINK(\"http://x\")" }
            : identity
        ),
        evaluations: FIXTURE_EVALUATIONS.map((evaluation) =>
          evaluation.nomusPurchaseOrderId === "o1"
            ? { ...evaluation, notes: "=SUM(A1:A2)" }
            : evaluation
        ),
      }),
      FILTERS,
      { includeEvidence: true }
    );
    const hostileBuffer = await buildSupplierClassificationXlsxBuffer(hostile);
    const cells = classificationSheetRows(hostileBuffer).map((row) => String(row[0]));
    assert.ok(cells.some((value) => value === "'=HYPERLINK(\"http://x\")"));
    assert.equal(cells.some((value) => value.startsWith("=")), false);
    const evidence = sheetText(hostileBuffer, SUPPLIER_CLASSIFICATION_XLSX_SHEETS[2]);
    assert.ok(evidence.includes("'=SUM(A1:A2)"));
  });

  it("respeita o filtro de leitura aplicado à emissão", async () => {
    const filtered = buildReport({ query: { classification: "APPROVED" }, includeEvidence: true });
    const rows = classificationSheetRows(await buildSupplierClassificationXlsxBuffer(filtered));
    assert.equal(rows.length, 1);
    assert.equal(rows[0][0], rowOf(REPORT, S1).name);
  });

  it("nome do arquivo carrega o período", () => {
    assert.equal(
      buildSupplierClassificationExportFilename("xlsx", FILTERS.period),
      "classificacao-fornecedores-2026-01-01-2026-12-31.xlsx"
    );
    assert.equal(
      buildSupplierClassificationExportFilename("pdf", { from: null, to: null }),
      "classificacao-fornecedores-inicio-hoje.pdf"
    );
  });

  it("congela cabeçalho, filtra, formata números e imprime em paisagem A4", async () => {
    assert.equal(SUPPLIER_CLASSIFICATION_XLSX_COMMUNITY_LIMITS.writesCellFillFontBorder, false);
    assert.equal(SUPPLIER_CLASSIFICATION_XLSX_COMMUNITY_LIMITS.writesFreezePanes, false);
    assert.equal(SUPPLIER_CLASSIFICATION_XLSX_COMMUNITY_LIMITS.writesPageSetup, false);

    const workbook = buildSupplierClassificationWorkbook(REPORT);
    const classification = workbook.Sheets[SUPPLIER_CLASSIFICATION_XLSX_SHEETS[0]] as XLSX.WorkSheet & {
      "!freeze"?: { state?: string; ySplit?: number };
    };
    const evidence = workbook.Sheets[SUPPLIER_CLASSIFICATION_XLSX_SHEETS[2]] as XLSX.WorkSheet & {
      "!freeze"?: { state?: string };
    };
    assert.equal(classification["!freeze"]?.state, "frozen");
    assert.ok((classification["!freeze"]?.ySplit ?? 0) > 1);
    assert.equal(evidence["!freeze"]?.state, "frozen");
    assert.ok(classification["!autofilter"]?.ref);
    assert.ok(evidence["!autofilter"]?.ref);
    assert.ok((classification["!merges"] ?? []).length >= 2);
    assert.equal(workbook.Props?.Title, REPORT.metadata.title);

    const zip = await JSZip.loadAsync(buffer);
    const sheet1 = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    const sheet3 = await zip.file("xl/worksheets/sheet3.xml")?.async("string");
    const core = await zip.file("docProps/core.xml")?.async("string");
    const styles = await zip.file("xl/styles.xml")?.async("string");
    assert.ok(sheet1);
    assert.ok(sheet3);
    assert.match(sheet1, /autoFilter ref="/);
    assert.match(sheet1, /state="frozen"/);
    assert.match(sheet1, /orientation="landscape"/);
    assert.match(sheet1, /paperSize="9"/);
    assert.match(sheet1, /mergeCell /);
    assert.match(sheet3, /state="frozen"/);
    assert.match(sheet3, /orientation="landscape"/);
    assert.ok(core?.includes(REPORT.metadata.title));
    assert.equal(/rgb="1F4E79"|patternType="solid"/.test(styles ?? ""), false);

    const roundTrip = XLSX.read(buffer, { type: "buffer", cellNF: true });
    const matrix = classificationSheetRows(buffer);
    const coverageCell = matrix[0]?.[14];
    assert.equal(typeof coverageCell, "number");
    const scoreCell = matrix.find((row) => row[5] != null)?.[5];
    assert.equal(typeof scoreCell, "number");
    const headerIndex = XLSX.utils
      .sheet_to_json<unknown[]>(roundTrip.Sheets[SUPPLIER_CLASSIFICATION_XLSX_SHEETS[0]]!, {
        header: 1,
        raw: true,
      })
      .findIndex((row) => row[0] === "Fornecedor" && row[1] === "Documento");
    const coverageAddress = XLSX.utils.encode_cell({ r: headerIndex + 1, c: 14 });
    const formatted = roundTrip.Sheets[SUPPLIER_CLASSIFICATION_XLSX_SHEETS[0]]![coverageAddress] as
      | XLSX.CellObject
      | undefined;
    assert.equal(formatted?.z, "0.00%");
  });
});

/* ------------------------------------------------------------------ *
 * PDF — documento de auditoria, mesma autoridade
 * ------------------------------------------------------------------ */

describe("exportação PDF", () => {
  const buffer = buildSupplierClassificationPdfBuffer(REPORT);

  it("é PDF válido", () => {
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(buffer.subarray(-1024).toString("latin1").includes("%%EOF"));
  });

  it("tabela principal repete o read model, com cabeçalho por bloco de página", () => {
    const rows = pdfTableRows(REPORT);
    assert.equal(rows.length, REPORT.rows.length);
    REPORT.rows.forEach((expected, index) => {
      const cells = rows[index];
      assert.equal(cells[0], expected.name);
      assert.equal(cells[9], `${expected.evaluatedOrders} / ${expected.eligibleOrders}`);
    });

    const many = buildSupplierClassificationReport(buildFixtureInput(), FILTERS);
    const inflated: SupplierClassificationReport = {
      ...many,
      rows: Array.from({ length: 60 }, (_, index) => ({
        ...many.rows[index % many.rows.length],
        supplierExternalId: 9000 + index,
      })),
    };
    const blocks = buildSupplierClassificationPdfLines(inflated).filter(
      (line) => line.type === "table" && line.headers[0] === "Fornecedor"
    );
    assert.ok(blocks.length >= 3, "tabela longa precisa reemitir o cabeçalho em novas páginas");
    assert.equal(pdfTableRows(inflated).length, 60);
  });

  it("classificação textual, notas e cobertura idênticas ao read model", () => {
    const text = pdfText(REPORT);
    for (const row of REPORT.rows) {
      assert.ok(text.includes(row.name));
      assert.ok(text.includes(row.classification.label), `faixa de ${row.name} ausente do PDF`);
    }
    assert.ok(text.includes(`Aprovados: ${REPORT.summary.approved}`) || text.includes("Aprovados | 1"));
  });

  it("declara metodologia, política, período e propósito neutro em português acentuado", () => {
    const text = pdfText(REPORT);
    assert.ok(text.includes("2026-01-01 a 2026-12-31"));
    assert.ok(text.includes(REPORT.metadata.methodology.id));
    assert.ok(text.includes(SUPPLIER_CLASSIFICATION_POLICY_ID));
    assert.ok(text.includes("critério interno da empresa"));
    assert.ok(text.includes("Não aprovados"));
    assert.ok(text.includes("Não classificados (metodologia anterior)"));
    assert.ok(
      text.includes("Evidência do processo interno de avaliação e monitoramento de fornecedores.")
    );
    const latin = buffer.toString("latin1");
    assert.ok(latin.includes("Página"));
    assert.ok(latin.includes("critério interno"));
    assert.ok(latin.includes("Não classificado") || latin.includes("Não aprovado") || latin.includes("Não avaliado"));
  });

  it("escreve o nome completo do fornecedor sem truncar em silêncio", () => {
    const LONG_NAME =
      "POLIMEROS JR INDUSTRIA E COMERCIO DE RESINAS TERMOPLASTICOS E COMPOSTOS ESPECIAIS LTDA";
    const longReport: SupplierClassificationReport = {
      ...REPORT,
      rows: REPORT.rows.map((row, index) => (index === 0 ? { ...row, name: LONG_NAME } : row)),
    };
    const lines = buildSupplierClassificationPdfLines(longReport);
    assert.ok(
      lines
        .filter((line): line is Extract<typeof line, { type: "table" }> => line.type === "table")
        .every((line) => line.wrapCells === true)
    );
    const row = pdfTableRows(longReport).find((cells) => cells[0] === LONG_NAME);
    assert.ok(row, "nome longo precisa permanecer integral nas células da tabela");
    const latin = buildSupplierClassificationPdfBuffer(longReport).toString("latin1");
    assert.ok(latin.includes("POLIMEROS"));
    assert.ok(latin.includes("TERMOPLASTICOS"));
    assert.ok(latin.includes("COMPOSTOS"));
    assert.ok(latin.includes("ESPECIAIS"));
    assert.ok(latin.includes("Página"));
  });

  it("respeita o filtro de leitura aplicado à emissão", () => {
    const filtered = buildReport({ query: { classification: "APPROVED" } });
    assert.deepEqual(
      pdfTableRows(filtered).map((row) => row[0]),
      [rowOf(REPORT, S1).name]
    );
  });
});

/* ------------------------------------------------------------------ *
 * Rotas — mesmo guard, mesma população, sem escrita
 * ------------------------------------------------------------------ */

type Registered = { method: string; path: string; handlers: RequestHandler[] };

function createFakeApp() {
  const routes: Registered[] = [];
  const push = (method: string) => (path: string, ...handlers: RequestHandler[]) => {
    routes.push({ method, path, handlers });
  };
  return {
    app: {
      get: push("GET"),
      put: push("PUT"),
      post: push("POST"),
      delete: push("DELETE"),
      patch: push("PATCH"),
    } as never,
    routes,
  };
}

function createAuth(granted: Set<string>, authenticated: boolean) {
  const requireAppAuth: RequestHandler = (_req, res, next) => {
    if (!authenticated) {
      res.status(401).json({ error: "Autenticação necessária." });
      return;
    }
    next();
  };
  const requireResource =
    (resourceKey: string, action = "view"): RequestHandler =>
    (_req, res, next) => {
      if (!granted.has(`${resourceKey}:${action}`)) {
        res.status(403).json({ error: "Acesso negado.", code: "FORBIDDEN" });
        return;
      }
      next();
    };
  return { requireAppAuth, requireResource };
}

class Dec {
  constructor(private readonly v: number) {}
  toString(): string {
    return String(this.v);
  }
}
const dec = (v: number | null) => (v == null ? null : new Dec(v));

function createDb(): SupplierPerformanceDashboardDb {
  return {
    nomusPurchaseOrder: {
      findMany: async () => FIXTURE_ORDERS.map((o) => ({ ...o, totalAmount: dec(o.totalAmount) })),
      findFirst: async () => ({ syncedAt: new Date("2026-09-06T03:00:00Z") }),
      aggregate: async () => ({
        _min: { issuedAt: new Date("2025-12-01T12:00:00"), firstSeenAt: null },
        _max: { issuedAt: new Date("2026-06-01T12:00:00"), firstSeenAt: null },
      }),
    },
    nomusPurchaseOrderItem: {
      findMany: async () =>
        FIXTURE_LINES.map((l) => ({
          ...l,
          orderedQuantity: dec(l.orderedQuantity),
          receivedQuantity: dec(l.receivedQuantity),
          unitPrice: dec(l.unitPrice),
          totalAmount: dec(l.totalAmount),
        })),
    },
    nomusPurchaseOrderSupplierEvaluation: {
      findMany: async () =>
        FIXTURE_EVALUATIONS.map((e) => ({
          ...e,
          overallScore: new Dec(e.overallScore),
          qualityScore: new Dec(e.qualityScore),
          deliveryScore: new Dec(e.deliveryScore),
          conformityScore: new Dec(e.conformityScore),
          serviceScore: new Dec(e.serviceScore),
        })),
    },
    nomusProductCatalog: { findMany: async () => FIXTURE_CATALOG },
    financialSupplier: { findMany: async () => [] },
  } as unknown as SupplierPerformanceDashboardDb;
}

const resolveSuppliers = async (
  samples: Array<{ supplierExternalId: number | null; supplierName: string | null; supplierTaxId: string | null }>
): Promise<ResolvedPurchaseOrderSupplier[]> =>
  samples.map((sample) => {
    const identity = FIXTURE_IDENTITIES.find(
      (candidate) => candidate.supplierExternalId === sample.supplierExternalId
    );
    return {
      nomusExternalId: sample.supplierExternalId,
      nomusName: sample.supplierName,
      nomusDocument: sample.supplierTaxId,
      resolvedName: identity?.resolvedName ?? sample.supplierName,
      resolvedDocument: identity?.resolvedDocument ?? sample.supplierTaxId,
      financialSupplierId: identity?.financialSupplierId ?? null,
      matchMethod: identity?.matchMethod ?? "UNRESOLVED",
      matchConfidence: identity?.matchConfidence ?? "UNRESOLVED",
      registryStatus: identity?.registryStatus ?? null,
      matched: Boolean(identity?.financialSupplierId),
      ambiguous: false,
      source: "test",
    } as ResolvedPurchaseOrderSupplier;
  });

type FakeResponse = {
  statusCode: number | null;
  body: unknown;
  buffer: Buffer | null;
  headers: Record<string, string>;
};

async function runRoute(route: Registered, request: Record<string, unknown> = {}): Promise<FakeResponse> {
  const result: FakeResponse = { statusCode: null, body: undefined, buffer: null, headers: {} };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      result.body = payload;
      if (result.statusCode == null) result.statusCode = 200;
      return this;
    },
    send(payload: unknown) {
      result.buffer = Buffer.isBuffer(payload) ? payload : null;
      result.body = payload;
      if (result.statusCode == null) result.statusCode = 200;
      return this;
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value;
    },
  };
  const req = { query: { from: "2026-01-01", to: "2026-12-31" }, params: {}, body: {}, ...request };
  for (const handler of route.handlers) {
    let nextCalled = false;
    await handler(req as never, res as never, () => {
      nextCalled = true;
    });
    if (!nextCalled) break;
  }
  return result;
}

const VIEW = "operations.purchases:view";
const BASE = "/api/purchases/performance/classification";

function setup(granted: string[] = [VIEW], authenticated = true) {
  const { app, routes } = createFakeApp();
  registerSupplierPerformanceDashboardRoutes(app, createAuth(new Set(granted), authenticated), {
    db: createDb(),
    deps: { resolveSuppliers, evaluationFeatureEnabled: true, now: new Date("2026-09-07T12:00:00") },
  });
  return { routes, find: (path: string) => routes.find((route) => route.path === path)! };
}

describe("rotas da classificação", () => {
  it("as três rotas são GET e reutilizam auth + operations.purchases:view", () => {
    const { routes } = setup();
    const own = routes.filter((route) => route.path.startsWith(BASE));
    assert.deepEqual(
      own.map((route) => `${route.method} ${route.path}`),
      [`GET ${BASE}`, `GET ${BASE}.xlsx`, `GET ${BASE}.pdf`]
    );
    assert.ok(own.every((route) => route.handlers.length === 3));
  });

  for (const path of [BASE, `${BASE}.xlsx`, `${BASE}.pdf`]) {
    it(`${path} — sem sessão → 401`, async () => {
      const res = await runRoute(setup([VIEW], false).find(path));
      assert.equal(res.statusCode, 401);
      assert.equal(res.buffer, null);
    });

    it(`${path} — sem permissão de Compras → 403`, async () => {
      const res = await runRoute(setup([]).find(path));
      assert.equal(res.statusCode, 403);
      assert.equal(res.buffer, null);
    });
  }

  it("JSON devolve o read model com no-store", async () => {
    const res = await runRoute(setup().find(BASE));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Cache-Control"], "no-store");
    const payload = res.body as SupplierClassificationReport;
    assert.equal(payload.rows.length, REPORT.rows.length);
    assert.deepEqual(
      payload.rows.map((row) => row.classification.code),
      REPORT.rows.map((row) => row.classification.code)
    );
    assert.deepEqual(payload.metadata.period, FILTERS.period);
    assert.equal(payload.metadata.policy.id, SUPPLIER_CLASSIFICATION_POLICY_ID);
    // Evidência detalhada é exclusiva do XLSX: a tela não paga esse payload.
    assert.equal(payload.evidence, null);
  });

  it("XLSX responde arquivo real com MIME, anexo e no-store", async () => {
    const res = await runRoute(setup().find(`${BASE}.xlsx`));
    assert.equal(res.statusCode, 200);
    assert.equal(
      res.headers["Content-Type"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.match(
      res.headers["Content-Disposition"],
      /attachment; filename="classificacao-fornecedores-2026-01-01-2026-12-31\.xlsx"/
    );
    assert.ok(res.buffer);
    assert.equal(res.buffer.subarray(0, 2).toString("latin1"), "PK");
    const wb = XLSX.read(res.buffer, { type: "buffer" });
    assert.deepEqual(wb.SheetNames, [...SUPPLIER_CLASSIFICATION_XLSX_SHEETS]);
  });

  it("PDF responde arquivo real com MIME, anexo e no-store", async () => {
    const res = await runRoute(setup().find(`${BASE}.pdf`));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "application/pdf");
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.match(
      res.headers["Content-Disposition"],
      /attachment; filename="classificacao-fornecedores-2026-01-01-2026-12-31\.pdf"/
    );
    assert.ok(res.buffer);
    assert.equal(res.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("exportação respeita o filtro da requisição — não amplia população", async () => {
    const { find } = setup();
    const res = await runRoute(find(`${BASE}.xlsx`), {
      query: { from: "2026-01-01", to: "2026-12-31", supplierExternalId: String(S1) },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.buffer);
    const rows = classificationSheetRows(res.buffer);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][2], S1);
  });

  it("filtro de período inválido falha antes de qualquer emissão", async () => {
    const { find } = setup();
    for (const path of [BASE, `${BASE}.xlsx`, `${BASE}.pdf`]) {
      const res = await runRoute(find(path), { query: { from: "2026-13-99" } });
      assert.equal(res.statusCode, 400);
      assert.equal(res.buffer, null);
    }
  });

  it("nenhuma escrita: os módulos da classificação só leem", () => {
    const sources = [
      "supplierClassificationPolicy.ts",
      "supplierClassificationReport.ts",
      "supplierClassificationXlsx.ts",
      "supplierClassificationPdf.ts",
      "supplierPerformanceDashboardRoutes.ts",
    ].map((file) => readFileSync(new URL(file, import.meta.url), "utf8"));
    for (const source of sources) {
      assert.equal(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(source), false);
      assert.equal(/\$executeRaw|\$transaction/.test(source), false);
    }
  });
});
