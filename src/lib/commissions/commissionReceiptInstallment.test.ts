/**
 * Coluna "Parcela" (n/total) do fechamento por recebimento.
 *   - número: o que a linha já traz (schedule / ledger) — nunca recalculado;
 *   - total: TODOS os CRs da NF (sourceInvoiceId), recebidos ou não no mês;
 *   - ordem do scheduler: dueDate ASC, externalId ASC;
 *   - duas consultas em lote (sem N+1), só leitura, PREVIEW e CLOSED iguais;
 *   - total que não dá para afirmar nunca vira "1/1".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import {
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
} from "./commissionReceiptClosingApi.js";
import type {
  ReceiptClosingLedgerLineSnapshot,
  ReceiptClosingSnapshot,
} from "./commissionReceiptClosing.js";
import { buildReceiptClosingDetailExportWorkbook } from "./commissionReceiptClosingDetailExport.js";
import {
  applyReceiptClosingInstallmentTotals,
  buildReceivableInstallmentPositions,
  compareReceivablesInInstallmentOrder,
  formatInstallmentLabel,
  resolveReceiptClosingInstallmentTotal,
  type ReceivableInstallmentSourceRow,
} from "./commissionReceiptInstallment.shared.js";
import {
  enrichReceiptClosingPageInstallments,
  loadReceivableInstallmentPositions,
} from "./commissionReceiptInstallment.server.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function cr(externalId: number, sourceInvoiceId: number | null, dueDate: string | null): ReceivableInstallmentSourceRow {
  return { externalId, sourceInvoiceId, dueDate: dueDate ? new Date(`${dueDate}T12:00:00.000Z`) : null };
}

function labelFor(
  line: { nomusReceivableId: number | null; installmentNumber: number | null },
  rows: ReceivableInstallmentSourceRow[]
): string {
  const positions = buildReceivableInstallmentPositions(rows);
  return formatInstallmentLabel(line.installmentNumber, resolveReceiptClosingInstallmentTotal(line, positions));
}

describe("formatInstallmentLabel", () => {
  it("número/total; sem total confirmado não inventa denominador", () => {
    assert.equal(formatInstallmentLabel(1, 1), "1/1");
    assert.equal(formatInstallmentLabel(1, 2), "1/2");
    assert.equal(formatInstallmentLabel(2, 2), "2/2");
    assert.equal(formatInstallmentLabel(2, 3), "2/3");
    assert.equal(formatInstallmentLabel(null, null), "—");
    assert.equal(formatInstallmentLabel(undefined, undefined), "—");
    assert.equal(formatInstallmentLabel(null, 3), "—");
    assert.equal(formatInstallmentLabel(2, null), "2/—");
    assert.equal(formatInstallmentLabel(3, 2), "3/—", "total menor que o número = desconhecido");
    assert.equal(formatInstallmentLabel(0, 3), "—");
    assert.equal(formatInstallmentLabel(1.5, 3), "—");
    assert.equal(formatInstallmentLabel(null, null, ""), "", "XLSX usa célula vazia");
    assert.equal(formatInstallmentLabel(2, null, ""), "2/—");
  });
});

describe("parcela do CR na NF (regra do scheduler)", () => {
  it("CASO A — uma parcela: 1/1", () => {
    const rows = [cr(100, 7651, "2026-09-10")];
    assert.equal(labelFor({ nomusReceivableId: 100, installmentNumber: 1 }, rows), "1/1");
  });

  it("CASO B — duas parcelas: 1/2 e 2/2", () => {
    const rows = [cr(102, 7652, "2026-10-10"), cr(101, 7652, "2026-09-10")];
    assert.equal(labelFor({ nomusReceivableId: 101, installmentNumber: 1 }, rows), "1/2");
    assert.equal(labelFor({ nomusReceivableId: 102, installmentNumber: 2 }, rows), "2/2");
  });

  it("CASO C — três parcelas, só duas recebidas no mês: 1/3 e 2/3 (nunca 1/2 e 2/2)", () => {
    // Todos os CRs da NF entram na conta, inclusive o 203 ainda aberto.
    const rows = [cr(201, 7653, "2026-09-10"), cr(202, 7653, "2026-09-20"), cr(203, 7653, "2026-10-10")];
    const monthLines = [
      { nomusReceivableId: 201, installmentNumber: 1 },
      { nomusReceivableId: 202, installmentNumber: 2 },
    ];
    assert.deepEqual(
      monthLines.map((line) => labelFor(line, rows)),
      ["1/3", "2/3"]
    );
  });

  it("CASO D — mesmo vencimento desempata por externalId; sem vencimento vai por último", () => {
    const rows = [cr(302, 7654, "2026-09-10"), cr(301, 7654, "2026-09-10"), cr(300, 7654, null), cr(305, 7654, "2026-08-01")];
    const ordered = [...rows].sort(compareReceivablesInInstallmentOrder).map((row) => row.externalId);
    assert.deepEqual(ordered, [305, 301, 302, 300]);
    const positions = buildReceivableInstallmentPositions(rows);
    assert.deepEqual(
      [305, 301, 302, 300].map((id) => positions.get(id)?.position),
      [1, 2, 3, 4]
    );
    assert.equal(positions.get(301)?.total, 4);
    // Várias NFs no mesmo lote: cada uma conta só os seus CRs.
    const mixed = buildReceivableInstallmentPositions([...rows, cr(900, 8000, "2026-01-01")]);
    assert.deepEqual(mixed.get(900), { sourceInvoiceId: 8000, position: 1, total: 1 });
    assert.equal(mixed.get(301)?.total, 4);
  });

  it("CASO E — número existente nunca é recalculado; divergência deixa o total desconhecido", () => {
    const rows = [cr(401, 7655, "2026-09-10"), cr(402, 7655, "2026-10-10"), cr(403, 7655, "2026-11-10")];
    const positions = buildReceivableInstallmentPositions(rows);
    // Número gravado 1, mas hoje o CR é o 2º da NF (população mudou desde a numeração).
    const lines = [{ nomusReceivableId: 402, installmentNumber: 1, lineKey: "k" }];
    const [enriched] = applyReceiptClosingInstallmentTotals(lines, positions);
    assert.equal(enriched?.installmentNumber, 1, "número do schedule/ledger preservado");
    assert.equal(enriched?.installmentTotal, null);
    assert.equal(formatInstallmentLabel(enriched?.installmentNumber, enriched?.installmentTotal), "1/—");
    assert.equal(lines[0] && "installmentTotal" in lines[0], false, "linha original não é alterada");
  });

  it("CASO F — total impossível de resolver não vira 1/1", () => {
    const rows = [cr(501, null, "2026-09-10"), cr(502, 7656, "2026-09-10")];
    // CR sem NF, CR desconhecido, linha sem CR, linha sem número.
    assert.equal(labelFor({ nomusReceivableId: 501, installmentNumber: 1 }, rows), "1/—");
    assert.equal(labelFor({ nomusReceivableId: 999, installmentNumber: 1 }, rows), "1/—");
    assert.equal(labelFor({ nomusReceivableId: null, installmentNumber: 1 }, rows), "1/—");
    assert.equal(labelFor({ nomusReceivableId: 502, installmentNumber: null }, rows), "—");
  });

  it("mesma população e ordem do scheduler (loadReceivablesForNfe)", () => {
    const scheduler = read("src/lib/commissions/commissionReceivableScheduler.server.ts");
    assert.match(scheduler, /where: \{ sourceInvoiceId: nfeId \},/);
    assert.match(scheduler, /orderBy: \[\{ dueDate: "asc" \}, \{ externalId: "asc" \}\],/);
    assert.match(scheduler, /installmentNumber: index \+ 1,/);
    const loader = read("src/lib/commissions/commissionReceiptInstallment.server.ts");
    assert.match(loader, /where: \{ sourceInvoiceId: \{ in: invoiceIds \} \},/);
    assert.match(
      loader,
      /orderBy: \[\{ sourceInvoiceId: "asc" \}, \{ dueDate: "asc" \}, \{ externalId: "asc" \}\],/
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Servidor: consultas em lote, PREVIEW e CLOSED                       */
/* ------------------------------------------------------------------ */

type FakeRow = { externalId: number; sourceInvoiceId: number | null; dueDate: Date | null };

function fakeReceivablesDb(rows: FakeRow[], options: { fail?: boolean } = {}) {
  const calls: Array<{ where: Record<string, unknown>; orderBy?: unknown }> = [];
  const db = {
    nomusAccountsReceivable: {
      findMany: async (args: { where: Record<string, { in?: number[] }>; select: Record<string, boolean>; orderBy?: unknown }) => {
        calls.push({ where: args.where, orderBy: args.orderBy });
        if (options.fail) throw new Error("banco indisponível");
        let result = rows;
        const byId = args.where.externalId?.in;
        const byInvoice = args.where.sourceInvoiceId?.in;
        if (byId) result = result.filter((row) => byId.includes(row.externalId));
        if (byInvoice) {
          result = result.filter((row) => row.sourceInvoiceId != null && byInvoice.includes(row.sourceInvoiceId));
        }
        return result.map((row) =>
          Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key as keyof FakeRow] ?? null]))
        );
      },
    },
  };
  return { db: db as unknown as PrismaClient, calls };
}

const NF = 7651;
const RECEIVABLES: FakeRow[] = [
  { externalId: 203, sourceInvoiceId: NF, dueDate: new Date("2026-10-10T12:00:00.000Z") }, // aberto
  { externalId: 201, sourceInvoiceId: NF, dueDate: new Date("2026-09-10T12:00:00.000Z") },
  { externalId: 202, sourceInvoiceId: NF, dueDate: new Date("2026-09-20T12:00:00.000Z") },
  { externalId: 700, sourceInvoiceId: 7700, dueDate: new Date("2026-09-05T12:00:00.000Z") },
];

function previewLine(
  partial: Partial<CommissionReceiptPreviewLine> & Pick<CommissionReceiptPreviewLine, "ledgerLineKey">
): CommissionReceiptPreviewLine {
  return {
    year: 2026,
    month: 9,
    nomusReceivableId: 201,
    receivableNumber: "7651",
    installmentNumber: 1,
    settlementDate: "2026-09-12T00:00:00.000Z",
    dueDate: "2026-09-10T00:00:00.000Z",
    receivableAmount: 1000,
    receivedAmount: 1000,
    receivedSharePercent: 100,
    customerExternalId: 10,
    customerId: "cust-1",
    customerName: "E Energy",
    nomusNfeId: NF,
    nfeNumber: "7651",
    orderCode: "PD 02838",
    localOrderId: "order-1",
    nomusOrderItemId: null,
    localItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: 464,
    rawSellerName: "JOSEANE",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "Joseane Aparecida Correa",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: "sched-1",
    ruleId: null,
    ruleName: null,
    ratePercent: 2,
    commissionableBaseAmount: 1000,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    grossCommissionAmount: 20,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "MATERIALIZED_SCHEDULE",
    ...partial,
  };
}

function previewResult(lines: CommissionReceiptPreviewLine[]): CommissionReceiptPreviewResult {
  return {
    year: 2026,
    month: 9,
    totalReceivables: lines.length,
    totalReceivedAmount: 2000,
    totalCommissionableBase: 2000,
    totalExpectedCommission: 40,
    totalReleasedCommission: 40,
    totalExcludedAmount: 0,
    totalExceptionAmount: 0,
    countByStatus: { COMMISSIONABLE: lines.length } as CommissionReceiptPreviewResult["countByStatus"],
    bySeller: [],
    byCustomer: [],
    lines,
  };
}

function ledgerLine(partial: Partial<ReceiptClosingLedgerLineSnapshot> & Pick<ReceiptClosingLedgerLineSnapshot, "id">): ReceiptClosingLedgerLineSnapshot {
  return {
    ledgerLineKey: `key-${partial.id}`,
    nomusReceivableId: 201,
    installmentNumber: 1,
    settlementDate: "2026-09-12T00:00:00.000Z",
    customerName: "E Energy",
    orderCode: "PD 02838",
    nfeNumber: "7651",
    productCode: null,
    canonicalSellerId: "seller-1",
    canonicalSellerName: "Joseane Aparecida Correa",
    receivedAmount: 1000,
    allocatedCommercialBase: 1000,
    commissionRatePercent: 2,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    status: "COMMISSIONABLE",
    exceptionReason: null,
    exclusionReason: null,
    ruleNameSnapshot: null,
    ruleSnapshotJson: { commissionReceivableScheduleId: "sched-1" },
    ...partial,
  };
}

const CLOSING: ReceiptClosingSnapshot = {
  closingId: "close-9",
  year: 2026,
  month: 9,
  status: "CLOSED",
  calculationHash: "hash",
  totalReceivedAmount: 2000,
  totalCommissionableBase: 2000,
  totalExpectedCommission: 40,
  totalReleasedCommission: 40,
  totalExcludedAmount: 0,
  totalExceptionAmount: 0,
  lineCount: 2,
  closedAt: "2026-10-01T00:00:00.000Z",
  closedBy: "user-1",
  notes: null,
};

describe("enriquecimento no servidor (PREVIEW e CLOSED)", () => {
  it("duas consultas em lote, qualquer quantidade de linhas (sem N+1)", async () => {
    const many: FakeRow[] = Array.from({ length: 60 }, (_, i) => ({
      externalId: 5000 + i,
      sourceInvoiceId: 9000 + Math.floor(i / 3),
      dueDate: new Date(Date.UTC(2026, 8, 1 + (i % 3))),
    }));
    const { db, calls } = fakeReceivablesDb(many);
    const positions = await loadReceivableInstallmentPositions(db, many.map((row) => row.externalId));
    assert.equal(calls.length, 2);
    assert.deepEqual(Object.keys(calls[0]!.where), ["externalId"]);
    assert.deepEqual(Object.keys(calls[1]!.where), ["sourceInvoiceId"], "sem filtro extra: mesma população do scheduler");
    assert.equal(positions.get(5004)?.total, 3);
    assert.equal(positions.get(5004)?.position, 2);

    const none = fakeReceivablesDb(many);
    await loadReceivableInstallmentPositions(none.db, [null, undefined, 0, -1]);
    assert.equal(none.calls.length, 0, "sem CR válido não consulta");
  });

  it("CASO G — PREVIEW: 1/3 e 2/3 com a NF de 3 parcelas (só 2 no mês)", async () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: previewResult([
        previewLine({ ledgerLineKey: "p1", nomusReceivableId: 201, installmentNumber: 1 }),
        previewLine({ ledgerLineKey: "p2", nomusReceivableId: 202, installmentNumber: 2 }),
      ]),
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    assert.deepEqual(page.lines.map((line) => line.installmentTotal), [null, null], "mapper puro não inventa total");
    const { db, calls } = fakeReceivablesDb(RECEIVABLES);
    const enriched = await enrichReceiptClosingPageInstallments(db, page);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      enriched.lines.map((line) => formatInstallmentLabel(line.installmentNumber, line.installmentTotal)),
      ["1/3", "2/3"]
    );
    // Só a coluna nova muda: valores, status e número da parcela intactos.
    assert.deepEqual(
      enriched.lines.map(({ installmentTotal: _total, ...rest }) => rest),
      page.lines.map(({ installmentTotal: _total, ...rest }) => rest)
    );
    assert.deepEqual(enriched.cards, page.cards);
    assert.deepEqual(enriched.summary, page.summary);
  });

  it("CASO H — CLOSED: 1/3 e 2/3 a partir do ledger, sem alterar o ledger", async () => {
    const ledgerLines = [
      ledgerLine({ id: "l1", nomusReceivableId: 201, installmentNumber: 1 }),
      ledgerLine({ id: "l2", nomusReceivableId: 202, installmentNumber: 2 }),
    ];
    const before = structuredClone(ledgerLines);
    const page = buildReceiptClosingPageFromLedger({ closing: CLOSING, ledgerLines });
    assert.equal(page.mode, "CLOSED");
    assert.deepEqual(page.lines.map((line) => line.nomusNfeId), [null, null], "ledger não traz a NF");
    const { db } = fakeReceivablesDb(RECEIVABLES);
    const enriched = await enrichReceiptClosingPageInstallments(db, page);
    assert.deepEqual(
      enriched.lines.map((line) => formatInstallmentLabel(line.installmentNumber, line.installmentTotal)),
      ["1/3", "2/3"]
    );
    assert.deepEqual(ledgerLines, before, "snapshot do ledger intacto");
    assert.deepEqual(enriched.closing, page.closing);
  });

  it("empresas do grupo (auditoria) também recebem o total", async () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: previewResult([
        previewLine({
          ledgerLineKey: "g1",
          nomusReceivableId: 700,
          installmentNumber: 1,
          status: "GROUP_COMPANY_EXCLUDED",
          nomusNfeId: 7700,
        }),
      ]),
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    assert.equal(page.groupCompanyAuditLines.length, 1);
    const enriched = await enrichReceiptClosingPageInstallments(fakeReceivablesDb(RECEIVABLES).db, page);
    assert.equal(enriched.groupCompanyAuditLines[0]?.installmentTotal, 1);
  });

  it("falha na leitura não derruba a tela: linhas seguem sem denominador", async () => {
    const page = buildReceiptClosingPageFromLedger({
      closing: CLOSING,
      ledgerLines: [ledgerLine({ id: "l1", nomusReceivableId: 201, installmentNumber: 1 })],
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const enriched = await enrichReceiptClosingPageInstallments(
        fakeReceivablesDb(RECEIVABLES, { fail: true }).db,
        page
      );
      assert.equal(enriched, page);
      assert.equal(formatInstallmentLabel(enriched.lines[0]?.installmentNumber, enriched.lines[0]?.installmentTotal), "1/—");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("rotas da tela e dos exports passam pelo enriquecimento (PREVIEW e CLOSED)", () => {
    const api = read("src/lib/commissions/commissionReceiptClosingApi.server.ts");
    assert.match(api, /return enrichReceiptClosingPageInstallments\(\s*prisma,\s*buildReceiptClosingPageFromLedger\(/);
    assert.match(api, /return enrichReceiptClosingPageInstallments\(\s*prisma,\s*buildReceiptClosingPageFromPreview\(/);
    const server = read("src/lib/commissions/commissionReceiptInstallment.server.ts");
    assert.doesNotMatch(server, /\.(create|update|upsert|delete)(Many)?\(/, "só leitura");
  });
});

describe("XLSX do detalhamento", () => {
  it("coluna Parcela no formato n/total, sem inventar denominador", () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: previewResult([
        previewLine({ ledgerLineKey: "x1", nomusReceivableId: 201, installmentNumber: 1 }),
        previewLine({ ledgerLineKey: "x2", nomusReceivableId: 202, installmentNumber: 2 }),
        previewLine({ ledgerLineKey: "x3", nomusReceivableId: 999, installmentNumber: null }),
      ]),
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    const withTotals = {
      ...page,
      lines: page.lines.map((line, index) => ({ ...line, installmentTotal: index === 0 ? 3 : null })),
    };
    const workbook = buildReceiptClosingDetailExportWorkbook(withTotals);
    assert.ok(workbook.SheetNames.includes("Analítico"));
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["Analítico"]!, { header: 1, defval: "" });
    const headerIndex = rows.findIndex((row) => row.includes("Parcela"));
    assert.ok(headerIndex >= 0, "coluna Parcela continua no relatório");
    const col = rows[headerIndex]!.indexOf("Parcela");
    const values = rows.slice(headerIndex + 1, headerIndex + 4).map((row) => row[col]);
    assert.deepEqual(values, ["1/3", "2/—", ""]);
  });
});
