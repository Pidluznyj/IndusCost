/**
 * Recebíveis Mensais — população por vencimento, sem corte por emissão.
 *
 * Banco simulado: um Prisma falso que avalia o `where` real da listagem de pedidos
 * (status/emissão) e pagina por id; a carga em lote e a auditoria 360º são trocadas
 * por fixtures equivalentes. O cálculo financeiro (FIN-05/FIN-08 e a matriz) é o real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as XLSX from "xlsx";
import type { PrismaClient } from "@prisma/client";
import {
  loadSalesOrderMonthlyReceivablesReportPayload,
  MONTHLY_RECEIVABLES_CANDIDATE_BATCH_SIZE,
  MONTHLY_RECEIVABLES_POPULATION_PAGE_SIZE,
  type MonthlyReceivablesReportDeps,
} from "./salesOrderMonthlyReceivablesReportService.server.js";
import { buildCandidateDueWindow, projectionHasDueInWindow } from "./salesOrderMonthlyReceivablesCandidates.js";
import { buildSalesOrderMonthlyReceivablesXlsxBuffer } from "./salesOrderMonthlyReceivablesReportExport.js";
import { SalesOrderMonthlyReceivablesReportPrintDocument } from "@/src/components/sales/SalesOrderMonthlyReceivablesReportPrintDocument";
import { DEFAULT_BRANDING } from "@/src/types/branding";

const NOW = new Date("2026-10-14T12:00:00-03:00");
const DEFAULT_QUERY = { dueMonthFrom: "2026-10", dueMonthTo: "2026-12" };

type Cr = { id: number; nfe: number | null; due: string; amount: number; received?: number };
type Plan = { n: number; due: string; amount: number };
type Fixture = {
  id: string;
  code: string;
  issue: string;
  status?: string;
  /** Presença do pedido no Nomus (padrão PRESENT). */
  presence?: string;
  total: number;
  crs?: Cr[];
  plan?: Plan[];
  /** Documento de saída já faturado (NF), alocado ao pedido. */
  doc?: { nfe: number; amount: number };
};

function crRow(cr: Cr) {
  const received = cr.received ?? 0;
  return {
    receivableExternalId: cr.id,
    sourceInvoiceId: cr.nfe,
    dueDate: `${cr.due}T00:00:00.000Z`,
    amountReceivable: cr.amount,
    amountReceived: received,
    balanceReceivable: cr.amount - received,
  };
}

function planRow(p: Plan) {
  return { installmentNumber: p.n, dueDate: p.due, originalExpectedAmount: p.amount, expectedAmount: p.amount };
}

/** Auditoria 360º simulada: só os blocos que a fronteira financeira consome. */
function audit(f: Fixture) {
  const crs = f.crs ?? [];
  return {
    ok: true,
    salesOrderId: f.id,
    orderCode: f.code,
    salesOrder: { orderCode: f.code },
    items: [
      {
        salesOrderItemId: `${f.id}-item`,
        totalNetValue: f.total,
        quantity: 1,
        unitPrice: f.total,
        nomusItemStatusRaw: 1,
        nomusItemStatusNormalized: "OPEN",
        nomusQuantityFulfilled: 0,
        nomusIsCut: false,
        nomusIsCanceled: false,
        nomusIsStale: false,
        linkedReceivableExternalIds: crs.map((cr) => cr.id),
      },
    ],
    receivables: crs.map(crRow),
    stockDocuments: f.doc
      ? [{ stockDocumentExternalId: f.doc.nfe * 10, idNfe: f.doc.nfe, allocatedValue: f.doc.amount, dataDocumento: "2026-09-20", dataMovimentacao: "2026-09-20" }]
      : [],
    stockDocumentItems: [],
    plannedReceivables: (f.plan ?? []).map(planRow),
  };
}

function fakeDb(fixtures: Fixture[], options: { failAudit?: Set<string>; failLoaderAt?: number } = {}) {
  const calls = { findMany: [] as Array<{ take: number; cursor: string | null }>, loader: [] as string[][], audits: [] as string[] };
  const byId = new Map(fixtures.map((f) => [f.id, f]));

  function matches(f: Fixture, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (key === "AND") {
        if (!(value as Record<string, unknown>[]).every((w) => matches(f, w))) return false;
      } else if (key === "status") {
        const v = value as { not?: string; notIn?: string[] };
        const status = f.status ?? "SENT_TO_NOMUS";
        if (v.not != null && status === v.not) return false;
        if (v.notIn && v.notIn.includes(status)) return false;
      } else if (key === "sourcePresenceStatus") {
        // Ligado por NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED (ativo em homologação).
        const v = value as { not?: string };
        if (v.not != null && (f.presence ?? "PRESENT") === v.not) return false;
      } else if (key === "issueDate") {
        const v = value as { gte?: Date; lte?: Date };
        const at = new Date(`${f.issue}T12:00:00-03:00`).getTime();
        if (v.gte && at < new Date(v.gte).getTime()) return false;
        if (v.lte && at > new Date(v.lte).getTime()) return false;
      } else {
        throw new Error(`filtro não simulado: ${key}`);
      }
    }
    return true;
  }

  const prisma = {
    salesOrder: {
      findMany: async (args: { where: Record<string, unknown>; take: number; orderBy: unknown; cursor?: { id: string }; skip?: number }) => {
        assert.deepEqual(args.orderBy, { id: "asc" }, "ordem determinística por id");
        calls.findMany.push({ take: args.take, cursor: args.cursor?.id ?? null });
        const sorted = fixtures.filter((f) => matches(f, args.where)).sort((a, b) => (a.id < b.id ? -1 : 1));
        const start = args.cursor ? sorted.findIndex((f) => f.id === args.cursor!.id) + (args.skip ?? 0) : 0;
        return sorted.slice(start, start + args.take).map((f) => ({
          id: f.id,
          orderCode: f.code,
          status: f.status ?? "SENT_TO_NOMUS",
          issueDate: new Date(`${f.issue}T12:00:00-03:00`),
          totalNetValue: f.total,
          nomusSellerName: "Ana",
          responsible: null,
          sourcePresenceStatus: f.presence ?? "PRESENT",
          companyIssuer: "Empresa",
          Customer: { companyName: `Cliente ${f.code}`, tradeName: null, taxId: null },
          externalCustomerId: 1,
        }));
      },
    },
  } as unknown as PrismaClient;

  const deps: MonthlyReceivablesReportDeps = {
    loadProjections: async (_prisma, input) => {
      calls.loader.push(input.salesOrderIds);
      if (options.failLoaderAt === calls.loader.length) throw new Error("timeout na carga em lote");
      const out = new Map();
      for (const id of input.salesOrderIds) {
        const a = audit(byId.get(id)!);
        out.set(id, { receivables: a.receivables, plannedReceivables: a.plannedReceivables });
      }
      return out;
    },
    getOrderFullAudit: (async (input: { salesOrderId: string }) => {
      calls.audits.push(input.salesOrderId);
      if (options.failAudit?.has(input.salesOrderId)) throw new Error("falha na auditoria");
      return audit(byId.get(input.salesOrderId)!);
    }) as unknown as MonthlyReceivablesReportDeps["getOrderFullAudit"],
  };
  return { prisma, deps, calls };
}

/** Sem pré-seleção: todo pedido é candidato (referência canônica para comparar). */
function withoutPreselection(deps: MonthlyReceivablesReportDeps): MonthlyReceivablesReportDeps {
  return {
    ...deps,
    loadProjections: async (_p, input) =>
      new Map(input.salesOrderIds.map((id) => [id, { receivables: [], plannedReceivables: [{ dueDate: "2026-10-01" }] }])),
  };
}

function load(db: ReturnType<typeof fakeDb>, query: Record<string, unknown> = DEFAULT_QUERY, deps = db.deps) {
  return loadSalesOrderMonthlyReceivablesReportPayload(db.prisma, { query: { ...query, includeAllRows: "1" }, referenceDate: NOW }, deps);
}

const pad = (n: number) => String(n).padStart(5, "0");

/** 600 pedidos recentes sem recebível no período + casos de integridade. */
function scenario(): Fixture[] {
  const recent: Fixture[] = Array.from({ length: 600 }, (_, i) => ({
    id: `so-${pad(1000 + i)}`,
    code: `PD ${pad(1000 + i)}`,
    issue: "2026-09-01",
    total: 1000,
    // Vence fora da janela de candidatos (set/2026 já estaria nela: um mês antes do período).
    plan: [{ n: 1, due: "2026-07-31", amount: 1000 }],
  }));
  return [
    ...recent,
    // 1/2. Pedido antigo (emitido em 2025, o mais antigo de todos), CR vencendo em out/2026.
    { id: "so-00001", code: "PD 00001", issue: "2025-02-10", total: 5000, crs: [{ id: 1, nfe: 101, due: "2026-10-20", amount: 5000 }] },
    // 2. Emitido em 2025, só previsão (sem CR real) vencendo em nov/2026.
    { id: "so-00002", code: "PD 00002", issue: "2025-11-05", total: 8000, plan: [{ n: 1, due: "2026-11-05", amount: 8000 }] },
    // 4. Múltiplas parcelas em meses diferentes (uma fora do período).
    {
      id: "so-00003",
      code: "PD 00003",
      issue: "2026-08-01",
      total: 9000,
      plan: [
        { n: 1, due: "2026-09-01", amount: 3000 },
        { n: 2, due: "2026-10-01", amount: 3000 },
        { n: 3, due: "2026-12-01", amount: 3000 },
      ],
    },
    // 5. CR real cobrindo a previsão de outubro: não soma duas vezes.
    {
      id: "so-00004",
      code: "PD 00004",
      issue: "2026-07-01",
      total: 10000,
      plan: [{ n: 1, due: "2026-10-10", amount: 10000 }],
      crs: [{ id: 4, nfe: 104, due: "2026-10-10", amount: 10000 }],
    },
    // 6. Documento fiscal e CR da mesma NF: o CR substitui o documento.
    { id: "so-00005", code: "PD 00005", issue: "2026-06-01", total: 7000, doc: { nfe: 105, amount: 7000 }, crs: [{ id: 5, nfe: 105, due: "2026-11-15", amount: 7000 }] },
    // 7. Recebimento parcial.
    { id: "so-00006", code: "PD 00006", issue: "2026-05-01", total: 6000, crs: [{ id: 6, nfe: 106, due: "2026-12-10", amount: 6000, received: 2500 }] },
    // 8. Cancelado, com parcela no período: fora.
    { id: "so-00007", code: "PD 00007", issue: "2026-04-01", status: "CANCELLED", total: 4000, plan: [{ n: 1, due: "2026-10-15", amount: 4000 }] },
    // 3. Pedido novo sem recebível no período (vence em 2027).
    { id: "so-09999", code: "PD 09999", issue: "2026-10-10", total: 3000, plan: [{ n: 1, due: "2027-02-10", amount: 3000 }] },
  ];
}

const ELIGIBLE = ["so-00001", "so-00002", "so-00003", "so-00004", "so-00005", "so-00006"];

describe("Recebíveis Mensais — seleção por vencimento", () => {
  it("1–8. mais de 500 pedidos: entram exatamente os que têm recebível no período, inclusive os antigos", async () => {
    const db = fakeDb(scenario());
    const payload = await load(db);
    assert.deepEqual(payload.rows.map((r) => r.salesOrderId).sort(), ELIGIBLE);
    assert.deepEqual(payload.selection, {
      populationOrders: 607, // 608 pedidos, 1 cancelado excluído pelo filtro do pedido
      candidateOrders: 6,
      eligibleOrders: 6,
      failedOrders: 0,
      complete: true,
    });
    assert.deepEqual(payload.warnings, []);
    // Só os candidatos passam pela auditoria 360º (antes: os 500 mais recentes).
    assert.deepEqual([...db.calls.audits].sort(), ELIGIBLE);

    const row = (id: string) => payload.rows.find((r) => r.salesOrderId === id)!;
    // 1/2. CR real e previsão de pedidos de 2025.
    assert.equal(row("so-00001").months["2026-10"]!.amount, 5000);
    assert.equal(row("so-00002").months["2026-11"]!.amount, 8000);
    // 4. Parcelas em meses diferentes; setembro fica fora do período.
    assert.equal(row("so-00003").months["2026-10"]!.amount, 3000);
    assert.equal(row("so-00003").months["2026-12"]!.amount, 3000);
    assert.equal(row("so-00003").periodScheduleTotal, 6000);
    assert.equal(row("so-00003").outsidePeriodTotal, 3000);
    // 5. CR cobre a previsão: 10.000 uma vez só, e é o CR.
    assert.equal(row("so-00004").months["2026-10"]!.amount, 10000);
    assert.equal(row("so-00004").months["2026-10"]!.titleCount, 1);
    assert.equal(row("so-00004").effectiveScheduleTotal, 10000);
    // 6. Documento e CR da mesma NF: 7.000 uma vez só.
    assert.equal(row("so-00005").months["2026-11"]!.amount, 7000);
    assert.equal(row("so-00005").effectiveScheduleTotal, 7000);
    // 7. Recebimento parcial: valor do título, recebido e em aberto separados.
    assert.equal(row("so-00006").months["2026-12"]!.amount, 6000);
    assert.equal(row("so-00006").months["2026-12"]!.receivedAmount, 2500);
    assert.equal(row("so-00006").months["2026-12"]!.openAmount, 3500);
    // 8. Cancelado não entra; 3. pedido novo sem recebível no período não entra.
    assert.equal(payload.rows.some((r) => r.salesOrderId === "so-00007" || r.salesOrderId === "so-09999"), false);

    assert.equal(payload.totals.periodScheduleTotal, 5000 + 8000 + 6000 + 10000 + 7000 + 6000);
  });

  it("comparação com o cálculo canônico sem pré-seleção: mesmas linhas e mesmos totais", async () => {
    const db = fakeDb(scenario());
    const selected = await load(db);
    const reference = await load(db, DEFAULT_QUERY, withoutPreselection(db.deps));
    assert.equal(reference.selection.candidateOrders, 607, "referência calcula todos os pedidos");
    assert.deepEqual(selected.rows, reference.rows);
    assert.deepEqual(selected.totals, reference.totals);
  });

  it("9. filtro manual de emissão continua restringindo a população", async () => {
    const db = fakeDb(scenario());
    const payload = await load(db, { ...DEFAULT_QUERY, startDate: "2025-01-01", endDate: "2025-12-31" });
    assert.deepEqual(payload.rows.map((r) => r.salesOrderId).sort(), ["so-00001", "so-00002"]);
    assert.equal(payload.selection.populationOrders, 2);
    assert.ok(payload.filterLabels.some((l) => l.label === "Emissão" && l.value.includes("2025-01-01")));
    const open = await load(db);
    assert.ok(open.filterLabels.some((l) => l.label === "Emissão" && l.value === "Todas"));
  });

  it("10. paginação completa: população em páginas por id e lotes de candidatos, sem perda nem repetição", async () => {
    const many: Fixture[] = Array.from({ length: 2350 }, (_, i) => ({
      id: `so-${pad(i)}`,
      code: `PD ${pad(i)}`,
      issue: i % 2 ? "2025-03-01" : "2026-03-01",
      total: 100,
      plan: [{ n: 1, due: i % 7 === 0 ? "2026-11-20" : "2026-06-20", amount: 100 }],
    }));
    const db = fakeDb(many);
    const payload = await load(db);
    // População: 3 páginas (1000 + 1000 + 350), encadeadas pelo último id.
    assert.deepEqual(db.calls.findMany.map((c) => c.take), [1000, 1000, 1000]);
    assert.deepEqual(db.calls.findMany.map((c) => c.cursor), [null, "so-00999", "so-01999"]);
    assert.equal(MONTHLY_RECEIVABLES_POPULATION_PAGE_SIZE, 1000);
    // Candidatos: lotes de 200, cada pedido exatamente uma vez.
    const loaded = db.calls.loader.flat();
    assert.equal(loaded.length, 2350);
    assert.equal(new Set(loaded).size, 2350);
    assert.ok(db.calls.loader.every((batch) => batch.length <= MONTHLY_RECEIVABLES_CANDIDATE_BATCH_SIZE));
    const expected = many.filter((_, i) => i % 7 === 0).map((f) => f.id);
    assert.deepEqual(payload.rows.map((r) => r.salesOrderId).sort(), expected);

    // Paginação da matriz: páginas de 50 juntas = todas as linhas, sem repetição.
    const seen: string[] = [];
    for (let page = 1; page <= Math.ceil(expected.length / 50); page += 1) {
      const p = await loadSalesOrderMonthlyReceivablesReportPayload(
        db.prisma,
        { query: { ...DEFAULT_QUERY, page: String(page), pageSize: "50" }, referenceDate: NOW },
        db.deps
      );
      seen.push(...p.rows.map((r) => r.salesOrderId));
      assert.equal(p.pagination.totalRows, expected.length);
    }
    assert.equal(seen.length, expected.length);
    assert.deepEqual([...seen].sort(), expected);
  });

  it("11. Excel e PDF conciliam com os totais da matriz", async () => {
    const db = fakeDb(scenario());
    const payload = await load(db);
    const months = payload.period.months.map((m) => m.key);
    const matrixByMonth = months.map((key) => payload.rows.reduce((s, r) => s + (r.months[key]?.amount ?? 0), 0));
    assert.deepEqual(matrixByMonth, months.map((key) => payload.totals.monthly[key]!.amount));

    const wb = XLSX.read(buildSalesOrderMonthlyReceivablesXlsxBuffer(payload), { type: "buffer" });
    const sheet = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1 });
    const orderRows = sheet.filter((r) => typeof r[0] === "string" && /^PD \d{5}$/.test(r[0] as string));
    assert.equal(orderRows.length, payload.rows.length);
    const header = sheet.find((r) => r[0] === "Pedido")!;
    for (const [i, key] of months.entries()) {
      const label = payload.period.months[i]!.label;
      const col = header.indexOf(`${label} valor`);
      assert.ok(col > 0, `coluna ${label}`);
      const sum = orderRows.reduce((s, r) => s + Number(r[col] ?? 0), 0);
      assert.equal(Math.round(sum * 100) / 100, payload.totals.monthly[key]!.amount, `Excel ${key}`);
    }

    const html = renderToStaticMarkup(
      React.createElement(SalesOrderMonthlyReceivablesReportPrintDocument, { payload, branding: DEFAULT_BRANDING })
    );
    assert.equal((html.match(/PD \d{5}/g) ?? []).filter((code, i, all) => all.indexOf(code) === i).length, payload.rows.length);
    const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const key of months) assert.ok(html.includes(brl(payload.totals.monthly[key]!.amount)), `PDF ${key}`);
    // Linha TOTAL do Excel = totais da matriz.
    const totalRow = sheet.find((r) => r[0] === "TOTAL")!;
    assert.equal(totalRow[header.indexOf("Dentro do período")], payload.totals.periodScheduleTotal);
  });

  it("12a. falha no cálculo de um pedido: linha marcada, aviso e relatório declarado incompleto", async () => {
    const db = fakeDb(scenario(), { failAudit: new Set(["so-00002"]) });
    const payload = await load(db);
    assert.equal(payload.selection.complete, false);
    assert.equal(payload.selection.failedOrders, 1);
    const failed = payload.rows.find((r) => r.salesOrderId === "so-00002");
    assert.ok(failed, "o pedido com falha continua visível");
    assert.equal(failed!.periodScheduleTotal, 0);
    assert.ok(payload.warnings.some((w) => /Relatório incompleto: 1 pedido/.test(w)));
    // Excel e PDF carregam o mesmo aviso.
    const wb = XLSX.read(buildSalesOrderMonthlyReceivablesXlsxBuffer(payload), { type: "buffer" });
    const text = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, { header: 1 }));
    assert.match(text, /Aviso: Relatório incompleto/);
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderMonthlyReceivablesReportPrintDocument, { payload, branding: DEFAULT_BRANDING })
    );
    assert.match(html, /Relatório incompleto/);
  });

  it("12b. falha na seleção de candidatos: nenhum relatório parcial é devolvido", async () => {
    const many: Fixture[] = Array.from({ length: 450 }, (_, i) => ({
      id: `so-${pad(i)}`,
      code: `PD ${pad(i)}`,
      issue: "2026-01-01",
      total: 100,
      plan: [{ n: 1, due: "2026-10-20", amount: 100 }],
    }));
    const db = fakeDb(many, { failLoaderAt: 2 });
    await assert.rejects(() => load(db), /timeout na carga em lote/);
  });
});

describe("Recebíveis Mensais — presença no Nomus", () => {
  const FLAG = "NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED";

  it("com a exclusão de ausentes ligada (como em homologação), pedido ausente no Nomus fica fora; o resto não muda", async () => {
    const previous = process.env[FLAG];
    const fixtures: Fixture[] = [
      ...scenario(),
      { id: "so-00008", code: "PD 00008", issue: "2025-06-01", presence: "MISSING_CONFIRMED", total: 2000, plan: [{ n: 1, due: "2026-10-05", amount: 2000 }] },
    ];
    try {
      process.env[FLAG] = "1";
      const on = await load(fakeDb(fixtures));
      assert.deepEqual(on.rows.map((r) => r.salesOrderId).sort(), ELIGIBLE);
      delete process.env[FLAG];
      const off = await load(fakeDb(fixtures));
      assert.deepEqual(off.rows.map((r) => r.salesOrderId).sort(), [...ELIGIBLE, "so-00008"].sort());
    } finally {
      if (previous === undefined) delete process.env[FLAG];
      else process.env[FLAG] = previous;
    }
  });
});

describe("Recebíveis Mensais — regra de candidato", () => {
  it("janela = meses do período, mais um antes e um depois (virada de ano incluída)", () => {
    assert.deepEqual([...buildCandidateDueWindow(["2026-11", "2026-12"])].sort(), ["2026-10", "2026-11", "2026-12", "2027-01"]);
    assert.deepEqual([...buildCandidateDueWindow(["2027-01"])].sort(), ["2026-12", "2027-01", "2027-02"]);
  });

  it("CR real ou parcela prevista na janela torna o pedido candidato; sem data, não", () => {
    const window = buildCandidateDueWindow(["2026-10"]);
    assert.equal(projectionHasDueInWindow({ receivables: [{ dueDate: "2026-10-31T00:00:00.000Z" }], plannedReceivables: [] }, window), true);
    assert.equal(projectionHasDueInWindow({ receivables: [], plannedReceivables: [{ dueDate: "2026-11-01" }] }, window), true);
    assert.equal(projectionHasDueInWindow({ receivables: [{ dueDate: null }], plannedReceivables: [{ dueDate: "2027-03-01" }] }, window), false);
  });
});
