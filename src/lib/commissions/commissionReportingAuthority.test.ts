/**
 * Autoridade dos relatórios de comissão: até 09/2026 o Nomus é a fonte oficial e o
 * IndusCost só gera espelho técnico (não oficial); a partir de 10/2026 o IndusCost
 * gera os documentos oficiais. CASOS 1–15 da especificação + regressões.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  aggregateCommissionReceiptPreview,
  type CommissionReceiptPreviewLine,
} from "./commissionReceiptEngine.js";
import { buildCommissionReceiptLedgerLineKey } from "./commissionReceiptLedger.js";
import {
  COMMISSION_LEGACY_REPORT_TEXT,
  COMMISSION_PERIOD_BEFORE_INDUSCOST_CUTOVER,
  COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON,
  buildCommissionTechnicalMirrorFilename,
  getCommissionReportingAuthority,
  getCommissionReportingAuthorityForRange,
  isCommissionDateOfficialInIndusCost,
} from "./commissionCoverageCutover.js";
import {
  buildReceiptClosingExportCsv,
  buildReceiptClosingPageEmpty,
  buildReceiptClosingPageFromPreview,
  mapPreviewLineToApiLine,
  type ReceiptClosingPagePayload,
} from "./commissionReceiptClosingApi.js";
import type { ReceiptClosingSnapshot } from "./commissionReceiptClosing.js";
import {
  RECEIPT_CLOSING_LEGACY_SHEET_TABLE_OFFSET,
  buildReceiptClosingDetailExportFilename,
  buildReceiptClosingDetailExportWorkbook,
} from "./commissionReceiptClosingDetailExport.shared.js";
import {
  applyReceiptClosingFromApi,
  buildReceiptClosingCsvFilename,
  reprocessReceiptClosingApplyFromApi,
  reprocessReceiptClosingPreviewFromApi,
} from "./commissionReceiptClosingApi.server.js";
import {
  approveCommissionPaymentBatch,
  createCommissionPaymentBatch,
  markCommissionPaymentBatchPaid,
} from "./commission-payment-service.server.js";
import {
  assembleCommissionReportsPayload,
  buildCommissionReportsExportFilename,
  buildCommissionReportsExportWorkbook,
  mapSourceLineToReportRecord,
  resolveCommissionReportsAuthority,
  type CommissionReportSourceLine,
} from "./commissionReports.shared.js";
import {
  buildClosingSellerReport,
  mapClosingListItemFromPage,
  resolveCommissionClosingDocumentTexts,
} from "./commissionClosings.shared.js";
import {
  buildCommissionClosingSellerXlsx,
  buildCommissionClosingSellerXlsxFilename,
} from "./commissionClosings.server.js";
import {
  enrichReceiptClosingPageCoverage,
  listLegacyOfficialReportStatuses,
} from "./commissionReceiptCoverage.server.js";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function previewLine(year: number, month: number, partial: Partial<CommissionReceiptPreviewLine> = {}): CommissionReceiptPreviewLine {
  const nomusReceivableId = partial.nomusReceivableId ?? 19236;
  return {
    ledgerLineKey: buildCommissionReceiptLedgerLineKey({
      year,
      month,
      nomusReceivableId,
      commissionRecordId: null,
      commissionPaymentScheduleId: null,
      commissionReceivableScheduleId: "sch-1",
      installmentNumber: 1,
      nomusOrderItemId: null,
      ruleId: null,
    }),
    year,
    month,
    nomusReceivableId,
    receivableNumber: String(nomusReceivableId),
    installmentNumber: 1,
    settlementDate: `${year}-${String(month).padStart(2, "0")}-20T00:00:00.000Z`,
    receiptDate: `${year}-${String(month).padStart(2, "0")}-15`,
    receiptIds: [90001],
    dueDate: null,
    receivableAmount: 499.35,
    receivedAmount: 499.35,
    receivedSharePercent: 100,
    customerExternalId: 10,
    customerId: null,
    customerName: "ACQUAPER BEBEDOUROS E EQUIPAMENTOS LTDA",
    nomusNfeId: 7704,
    nfeNumber: "7704",
    orderCode: "PD 02790",
    localOrderId: null,
    nomusOrderItemId: null,
    localItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: 464,
    rawSellerName: "JOSEANE",
    canonicalSellerId: "seller-joseane",
    canonicalSellerName: "JOSEANE",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: "sch-1",
    ruleId: null,
    ruleName: null,
    ratePercent: 3.44,
    commissionableBaseAmount: 499.35,
    expectedCommissionAmount: 17.2,
    releasedCommissionAmount: 17.2,
    grossCommissionAmount: 17.2,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "RECEIVABLE_SCHEDULE",
    ...partial,
  };
}

function previewPage(year: number, month: number): ReceiptClosingPagePayload {
  const lines = [previewLine(year, month)];
  return buildReceiptClosingPageFromPreview({
    preview: aggregateCommissionReceiptPreview(lines, { year, month }, 1),
    closing: null,
    canApply: false,
    applyBlockedReason: null,
  });
}

function closingSnapshot(year: number, month: number): ReceiptClosingSnapshot {
  return {
    closingId: `closing-${year}-${month}`,
    year,
    month,
    status: "CLOSED",
    source: "RECEIPT_BASED",
    calculationHash: "hash",
    totalReceivedAmount: 499.35,
    totalCommissionableBase: 499.35,
    totalExpectedCommission: 17.2,
    totalReleasedCommission: 17.2,
    totalExcludedAmount: 0,
    totalExceptionAmount: 0,
    lineCount: 1,
    closedAt: "2026-10-01T12:00:00.000Z",
    closedBy: "tester",
    notes: null,
  } as ReceiptClosingSnapshot;
}

function workbookText(wb: XLSX.WorkBook, sheet: string): string {
  return JSON.stringify(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet]!, { header: 1 }));
}

function reportSourceLine(year: number, month: number): CommissionReportSourceLine {
  return {
    ...mapPreviewLineToApiLine(previewLine(year, month)),
    year,
    month,
    periodStatus: "PREVIEW",
    closingId: null,
  };
}

async function rejectsWithCutoverCode(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code?: string }).code, COMMISSION_PERIOD_BEFORE_INDUSCOST_CUTOVER);
    return true;
  });
}

/* ------------------------------------------------------------------ */

describe("autoridade dos relatórios — helper central", () => {
  it("CASO 1 — 09/2026: fonte oficial Nomus, não oficial no IndusCost (espelho técnico)", () => {
    const authority = getCommissionReportingAuthority(2026, 9);
    assert.equal(authority.source, "NOMUS");
    assert.equal(authority.officialInIndusCost, false);
    assert.equal(authority.isLegacyPeriod, true);
    assert.equal(authority.documentType, "LEGACY_TECHNICAL_MIRROR");
    assert.equal(authority.cutoverDate, "2026-10-01");
  });

  it("CASO 2 — 10/2026: fonte oficial IndusCost", () => {
    const authority = getCommissionReportingAuthority(2026, 10);
    assert.equal(authority.source, "INDUSCOST");
    assert.equal(authority.officialInIndusCost, true);
    assert.equal(authority.documentType, "INDUSCOST_OFFICIAL");
    // Competência inválida é conservadora: nunca vira documento oficial.
    assert.equal(getCommissionReportingAuthority(Number.NaN, 13).officialInIndusCost, false);
    assert.equal(isCommissionDateOfficialInIndusCost("2026-09-30"), false);
    assert.equal(isCommissionDateOfficialInIndusCost("2026-10-01"), true);
  });

  it("intervalo que cruza o cutover é MIXED e não oficial", () => {
    const mixed = getCommissionReportingAuthorityForRange({ year: 2026, month: 8 }, { year: 2026, month: 10 });
    assert.equal(mixed.source, "MIXED");
    assert.equal(mixed.officialInIndusCost, false);
    assert.equal(mixed.documentType, "LEGACY_TECHNICAL_MIRROR");
    const official = getCommissionReportingAuthorityForRange({ year: 2026, month: 10 }, { year: 2026, month: 12 });
    assert.equal(official.source, "INDUSCOST");
    assert.equal(official.officialInIndusCost, true);
  });

  it("payload do fechamento traz reportingAuthority calculada no servidor", () => {
    assert.equal(previewPage(2026, 9).reportingAuthority?.documentType, "LEGACY_TECHNICAL_MIRROR");
    assert.equal(previewPage(2026, 10).reportingAuthority?.documentType, "INDUSCOST_OFFICIAL");
    assert.equal(buildReceiptClosingPageEmpty(2026, 8).reportingAuthority?.source, "NOMUS");
  });
});

describe("autoridade dos relatórios — exportações", () => {
  it("CASO 3 e 11 — XLSX de setembro: NÃO OFICIAL, NOMUS, reconstrução técnica e todas as abas marcadas", () => {
    const wb = buildReceiptClosingDetailExportWorkbook(previewPage(2026, 9));
    const resumo = workbookText(wb, "Resumo");
    assert.match(resumo, /ESPELHO TÉCNICO DE COMISSÕES — NÃO OFICIAL/);
    assert.match(resumo, /RELATÓRIO NÃO OFICIAL/);
    assert.match(resumo, /NOMUS/);
    assert.match(resumo, /Reconstrução técnica/);
    assert.match(resumo, /Cutover oficial:.*01\/10\/2026/);
    assert.match(resumo, /Comissão reconstruída \(não oficial\)/);
    assert.doesNotMatch(resumo, /Comissão final a pagar/);
    for (const sheet of ["Analítico", "Por vendedor"]) {
      const firstRow = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet]!, { header: 1 })[0] as string[];
      assert.match(String(firstRow[0]), /Documento não oficial — fonte oficial: Nomus/);
    }
    // Tabela continua legível logo abaixo do marcador.
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Analítico"]!, {
      range: RECEIPT_CLOSING_LEGACY_SHEET_TABLE_OFFSET,
    });
    assert.equal(detail[0]?.NF, "7704");
    assert.equal(
      buildReceiptClosingDetailExportFilename(2026, 9, "PREVIEW"),
      "espelho-tecnico-comissoes-2026-09-induscost.xlsx"
    );
  });

  it("CSV de setembro também sai como espelho técnico", () => {
    const page = previewPage(2026, 9);
    const csv = buildReceiptClosingExportCsv({
      year: 2026,
      month: 9,
      closing: null,
      exportMode: "PREVIEW",
      lines: page.lines,
      cards: page.cards,
    });
    assert.match(csv.split("\n")[0]!, /ESPELHO TÉCNICO DE COMISSÕES — NÃO OFICIAL/);
    assert.match(csv, /# officialSource,NOMUS/);
    assert.equal(buildReceiptClosingCsvFilename(2026, 9, "PREVIEW"), "espelho-tecnico-comissoes-2026-09-induscost.csv");
  });

  it("CASO 4 — outubro: sem disclaimer histórico, nome e estrutura oficiais", () => {
    const page = previewPage(2026, 10);
    const wb = buildReceiptClosingDetailExportWorkbook(page);
    for (const sheet of wb.SheetNames) {
      const text = workbookText(wb, sheet);
      assert.doesNotMatch(text, /NÃO OFICIAL|ESPELHO TÉCNICO|fonte oficial: Nomus/);
    }
    assert.equal(
      XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Analítico"]!)[0]?.NF,
      "7704"
    );
    assert.equal(
      buildReceiptClosingDetailExportFilename(2026, 10, "CLOSED"),
      "commission-receipt-closing-detalhamento-2026-10-fechado.xlsx"
    );
    const csv = buildReceiptClosingExportCsv({
      year: 2026,
      month: 10,
      closing: null,
      exportMode: "PREVIEW",
      lines: page.lines,
    });
    assert.match(csv.split("\n")[0]!, /^# exportMode=PREVIEW/);
    assert.equal(buildReceiptClosingCsvFilename(2026, 10, "CLOSED"), "commission-receipt-closing-2026-10-closed.csv");
  });

  it("chamada direta do builder: payload que se diz oficial em setembro continua espelho técnico", () => {
    const forged = { ...previewPage(2026, 9), reportingAuthority: getCommissionReportingAuthority(2026, 10) };
    assert.match(workbookText(buildReceiptClosingDetailExportWorkbook(forged), "Resumo"), /NÃO OFICIAL/);
  });
});

describe("autoridade dos relatórios — bloqueio no servidor", () => {
  it("CASO 5 e 7 — fechar/reprocessar setembro pela API é bloqueado antes de qualquer cálculo", async () => {
    await rejectsWithCutoverCode(applyReceiptClosingFromApi({ year: 2026, month: 9, userId: "manual" }));
    await rejectsWithCutoverCode(applyReceiptClosingFromApi({ year: 2026, month: 8, userId: "manual" }));
    await rejectsWithCutoverCode(reprocessReceiptClosingPreviewFromApi({ year: 2026, month: 9 }));
    await rejectsWithCutoverCode(
      reprocessReceiptClosingApplyFromApi({ year: 2026, month: 9, userId: "manual", reason: "teste" })
    );
    await assert.rejects(applyReceiptClosingFromApi({ year: 2026, month: 9, userId: "manual" }), (error: unknown) => {
      assert.equal((error as Error).message, COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON);
      assert.match((error as Error).message, /histórico oficial do Nomus/);
      return true;
    });
  });

  it("pagar comissão de período pré-cutover é bloqueado (criar, aprovar e pagar lote)", async () => {
    await rejectsWithCutoverCode(
      createCommissionPaymentBatch({} as never, {
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-09-30T00:00:00.000Z"),
        commissionPersonId: "p1",
        recordIds: ["r1"],
      })
    );
    const legacyBatch = { status: "DRAFT", periodStart: new Date("2026-08-01T00:00:00.000Z"), items: [] };
    await rejectsWithCutoverCode(
      approveCommissionPaymentBatch(
        { commissionPaymentBatch: { findUnique: async () => legacyBatch } } as never,
        "batch-1",
        "approver"
      )
    );
    const tx = { commissionPaymentBatch: { findUnique: async () => ({ ...legacyBatch, status: "APPROVED" }) } };
    await rejectsWithCutoverCode(
      markCommissionPaymentBatchPaid(
        {
          commissionSettings: { findMany: async () => [] },
          $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
        } as never,
        { batchId: "batch-1", paymentDate: new Date("2026-10-05T00:00:00.000Z") }
      )
    );
  });

  it("CASO 6 — tela: setembro sem 'Fechar comissão' (botão depende do canApply do servidor)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../components/commissions/pages/CommissionsReceiptClosingPage.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /canClose && data\?\.canApply && data\.mode === "PREVIEW"/);
    // Reprocessar também some no histórico Nomus (o servidor bloqueia de qualquer forma).
    assert.match(source, /canReprocess && isClosed && !legacyPeriod/);
  });
});

describe("autoridade dos relatórios — consulta, relatórios e fechamentos", () => {
  it("CASO 8 e 9 — agosto e setembro continuam consultáveis (reconstrução técnica)", () => {
    for (const month of [8, 9]) {
      const page = previewPage(2026, month);
      assert.equal(page.lines.length, 1);
      assert.equal(page.lines[0]?.nfeNumber, "7704");
      assert.equal(page.reportingAuthority?.isLegacyPeriod, true);
    }
  });

  it("CASO 12 — Relatórios: setembro = Nomus, outubro = IndusCost; intervalo misto não oficial", () => {
    const september = mapSourceLineToReportRecord(reportSourceLine(2026, 9));
    const october = mapSourceLineToReportRecord(reportSourceLine(2026, 10));
    assert.equal(september.officialSource, "NOMUS");
    assert.equal(october.officialSource, "INDUSCOST");
    const payload = assembleCommissionReportsPayload(
      [reportSourceLine(2026, 9), reportSourceLine(2026, 10)],
      { year: 2026, months: [9, 10], sellerId: "all", status: "all", search: null, page: 1, pageSize: 50 },
      []
    );
    assert.equal(payload.reportingAuthority?.source, "MIXED");
    assert.equal(payload.reportingAuthority?.includesLegacyPeriod, true);
    assert.equal(resolveCommissionReportsAuthority(2026, [10, 11]).officialInIndusCost, true);
    assert.equal(resolveCommissionReportsAuthority(2026, "all").includesLegacyPeriod, true);
  });

  it("CASO 12 — Fechamentos: registro de setembro não é rotulado como oficial; outubro é", () => {
    const legacy = mapClosingListItemFromPage(
      { ...previewPage(2026, 9), mode: "CLOSED", closing: closingSnapshot(2026, 9) },
      1,
      null
    )!;
    const official = mapClosingListItemFromPage(
      { ...previewPage(2026, 10), mode: "CLOSED", closing: closingSnapshot(2026, 10) },
      1,
      null
    )!;
    assert.equal(legacy.reportingAuthority.source, "NOMUS");
    assert.equal(legacy.statusLabel, "Registro técnico — não oficial (período Nomus)");
    assert.equal(official.reportingAuthority.source, "INDUSCOST");
    assert.equal(official.statusLabel, "Fechado");
  });

  it("CASO 13 — vendedor em agosto: sem 'a pagar' nem linguagem de valor oficial", () => {
    const august = mapSourceLineToReportRecord(reportSourceLine(2026, 8));
    assert.equal(august.isPayable, false);
    assert.equal(august.officialSource, "NOMUS");
    assert.equal(mapSourceLineToReportRecord(reportSourceLine(2026, 10)).isPayable, true);
    const texts = resolveCommissionClosingDocumentTexts(getCommissionReportingAuthority(2026, 8), {
      title: "COMERCIAL: RELATÓRIO DE COMISSÕES",
      source: "Ledger oficial",
      footer: "fechamento oficial",
    });
    assert.equal(texts.title, COMMISSION_LEGACY_REPORT_TEXT.documentTitle);
    assert.doesNotMatch(`${texts.title} ${texts.source} ${texts.footer}`, /Ledger oficial|fechamento oficial/);
    assert.equal(texts.pageMarker, "NÃO OFICIAL — PERÍODO NOMUS");
  });

  it("XLSX de Relatórios e por vendedor com setembro: todas as abas marcadas e nome de espelho", () => {
    const record = mapSourceLineToReportRecord(reportSourceLine(2026, 9));
    const wb = buildCommissionReportsExportWorkbook({ sellers: [], records: [record], year: 2026, months: [9] });
    assert.match(workbookText(wb, wb.SheetNames[0]!), /ESPELHO TÉCNICO DE COMISSÕES — NÃO OFICIAL/);
    assert.match(workbookText(wb, wb.SheetNames[0]!), /Reconstrução técnica/);
    for (const sheet of wb.SheetNames.slice(1)) {
      assert.match(workbookText(wb, sheet), /Documento não oficial — fonte oficial: Nomus/);
    }
    assert.match(workbookText(wb, "Registros detalhados"), /NOMUS — espelho técnico \(não oficial\)/);
    assert.equal(
      buildCommissionReportsExportFilename(2026, [9]),
      "espelho-tecnico-comissoes-2026-set-induscost.xlsx"
    );
    assert.equal(buildCommissionReportsExportFilename(2026, [10]), "comissao-relatorio-2026-out.xlsx");
    const officialWb = buildCommissionReportsExportWorkbook({
      sellers: [],
      records: [mapSourceLineToReportRecord(reportSourceLine(2026, 10))],
      year: 2026,
      months: [10],
    });
    for (const sheet of officialWb.SheetNames) {
      assert.doesNotMatch(workbookText(officialWb, sheet), /NÃO OFICIAL|ESPELHO TÉCNICO/);
    }

    const page = previewPage(2026, 9);
    const sellerReport = buildClosingSellerReport(page.lines, page.lines[0]!.canonicalSellerId!, closingSnapshot(2026, 9), null);
    assert.ok(sellerReport);
    const sellerWb = XLSX.read(buildCommissionClosingSellerXlsx(sellerReport), { type: "buffer" });
    assert.match(workbookText(sellerWb, "Resumo"), /RELATÓRIO NÃO OFICIAL/);
    assert.match(workbookText(sellerWb, "Analítico"), /Documento não oficial — fonte oficial: Nomus/);
    assert.equal(
      buildCommissionClosingSellerXlsxFilename(sellerReport),
      buildCommissionTechnicalMirrorFilename(2026, 9, "xlsx", "joseane")
    );
  });
});

describe("autoridade dos relatórios — relatório oficial do Nomus e cobertura", () => {
  function importsDb(rows: Array<Record<string, unknown>>) {
    return {
      commissionLegacyCoverageImport: {
        findMany: async ({ where }: { where: { referenceYear: number; referenceMonth: { in: number[] } } }) =>
          rows.filter(
            (row) => row.referenceYear === where.referenceYear && where.referenceMonth.in.includes(row.referenceMonth as number)
          ),
      },
    } as never;
  }

  it("CASO 14 e 15 — relatório do Nomus importado aparece como registrado; sem importação, orienta consultar o Nomus", async () => {
    const statuses = await listLegacyOfficialReportStatuses(
      importsDb([
        {
          id: "imp-9",
          referenceYear: 2026,
          referenceMonth: 9,
          filename: "nomus-2026-09.xlsx",
          importedAt: new Date("2026-10-02T10:00:00.000Z"),
          importedBy: "admin",
          rowCount: 10,
          matchedCount: 9,
          unmatchedCount: 1,
          ambiguousCount: 0,
          alreadyCoveredCount: 0,
        },
      ]),
      { year: 2026 }
    );
    assert.deepEqual(
      statuses.map((status) => status.month),
      [1, 2, 3, 4, 5, 6, 7, 8, 9]
    );
    const september = statuses.find((status) => status.month === 9)!;
    assert.equal(september.registered, true);
    assert.equal(september.imports[0]?.filename, "nomus-2026-09.xlsx");
    assert.equal(statuses.find((status) => status.month === 8)?.registered, false);
    // Competência oficial do IndusCost não entra na lista do histórico.
    assert.deepEqual(await listLegacyOfficialReportStatuses(importsDb([]), { year: 2027 }), []);
  });

  it("coverage ≠ autoridade: agosto reconstruído explica 'Contemplado pelo Nomus em 09/2026' sem virar oficial", async () => {
    const page = previewPage(2026, 8);
    const enriched = await enrichReceiptClosingPageCoverage(
      {
        commissionReceiptCoverage: {
          findMany: async () => [
            { receiptExternalId: 90001, coverageSource: "NOMUS_LEGACY", coveredYear: 2026, coveredMonth: 9 },
          ],
        },
      } as never,
      page
    );
    const note = enriched.lines[0]?.coverageNote;
    assert.equal(note?.tag, "Contemplado: Nomus 09/2026");
    assert.equal(note?.detail, "Competência natural: 08/2026 · Fonte oficial: Nomus · Contemplado em: 09/2026 (Nomus)");
    assert.equal(enriched.reportingAuthority?.isLegacyPeriod, true);
  });

  it("CR 19236 / NF 7704 aparece na reconstrução de agosto sem provar pagamento (sem cobertura → sem nota)", async () => {
    const page = previewPage(2026, 8);
    const enriched = await enrichReceiptClosingPageCoverage(
      { commissionReceiptCoverage: { findMany: async () => [] } } as never,
      page
    );
    assert.equal(enriched.lines[0]?.nomusReceivableId, 19236);
    assert.equal(enriched.lines[0]?.coverageNote ?? null, null);
    assert.equal(enriched.reportingAuthority?.documentType, "LEGACY_TECHNICAL_MIRROR");
  });
});
