/**
 * Runner de shadow — comportamento das partes puras.
 *
 * O runner toca banco real, então o que se testa aqui é o que decide o
 * veredito: o diff, o recorte da fronteira e a proteção de dados pessoais.
 * Importar o módulo não pode disparar execução.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  comparableSchedule,
  diffDeep,
  projectComparableBoundary,
} from "../../../scripts/runCashFlowLightProjectionShadow.js";

function boundary(over: Record<string, unknown> = {}) {
  return projectComparableBoundary({
    salesOrderId: "SO-1",
    orderCode: "PV-1",
    items: [
      {
        salesOrderItemId: "I1",
        totalNetValue: 1000,
        activeValue: 1000,
        quantity: 1,
        unitPrice: 1000,
        nomusItemStatusRaw: "Faturado",
        nomusItemStatusNormalized: "INVOICED",
        nomusQuantityFulfilled: 1,
        nomusIsCut: false,
        nomusIsCanceled: false,
        nomusIsStale: false,
        // dados que NÃO podem sair no relatório:
        productName: "Produto Secreto",
      },
    ],
    stockDocuments: [
      {
        stockDocumentExternalId: 7001,
        idNfe: 900,
        status: "Confirmado",
        dataDocumento: "2026-06-15",
        dataMovimentacao: "2026-06-15",
        allocatedValue: 600,
      },
    ],
    receivables: [
      {
        receivableExternalId: 5001,
        sourceInvoiceId: 900,
        dueDate: "2026-07-01",
        amountReceivable: 1000,
        amountReceived: 400,
        balanceReceivable: 600,
        status: "PARTIALLY_RECEIVED",
        personName: "Cliente Secreto",
        personCnpj: "12345678000199",
        comments: "anotação interna",
      },
    ],
    plannedReceivables: [
      {
        key: "k1",
        installmentNumber: 1,
        dueDate: "2026-07-01",
        expectedAmount: 1000,
        openAmount: 600,
        statusLabel: "A vencer",
        entryKind: "RESIDUAL_ORDER_PLAN",
        replacedByRealCr: false,
      },
    ],
    ...over,
  } as never);
}

describe("SHADOW RUNNER — diff e proteção de dados", () => {
  it("importar o módulo não executa o runner", () => {
    // Se executasse, a suíte teria tentado abrir conexão com o banco e o
    // import acima falharia ou penduraria. Chegar aqui já é a prova.
    assert.ok(typeof diffDeep === "function");
  });

  it("aceita igualdade: zero diferenças", () => {
    assert.deepEqual(diffDeep(boundary(), boundary()), []);
  });

  it("detecta divergência monetária, com caminho", () => {
    const old = boundary();
    const neo = JSON.parse(JSON.stringify(old));
    neo.receivables[0].balanceReceivable = 599.99;

    const diffs = diffDeep(old, neo);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0]?.path, "receivables[0].balanceReceivable");
    assert.equal(diffs[0]?.old, 600);
    assert.equal(diffs[0]?.neo, 599.99);
  });

  it("detecta diferença de cardinalidade", () => {
    const old = boundary();
    const neo = JSON.parse(JSON.stringify(old));
    neo.plannedReceivables = [];
    const diffs = diffDeep(old, neo);
    assert.ok(diffs.some((d) => d.path === "plannedReceivables.length"));
  });

  it("PRIVACIDADE: o recorte não carrega nome, CNPJ nem comentários", () => {
    const serializado = JSON.stringify(boundary());
    for (const proibido of [
      "Cliente Secreto",
      "12345678000199",
      "anotação interna",
      "Produto Secreto",
    ]) {
      assert.ok(
        !serializado.includes(proibido),
        `vazou no recorte: ${proibido}`
      );
    }
  });

  it("PRIVACIDADE: o diff ignora ramos sensíveis mesmo se presentes", () => {
    const old = { receivables: [{ personCnpj: "111", amountReceivable: 10 }] };
    const neo = { receivables: [{ personCnpj: "222", amountReceivable: 10 }] };
    assert.deepEqual(diffDeep(old, neo), [], "CNPJ não pode gerar diff");

    const neo2 = { receivables: [{ personCnpj: "222", amountReceivable: 11 }] };
    const diffs = diffDeep(old, neo2);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0]?.path, "receivables[0].amountReceivable");
    assert.ok(!JSON.stringify(diffs).includes("111"));
  });

  it("comparableSchedule recorta só o que decide o número", () => {
    const recorte = comparableSchedule({
      activeOrderResidualSchedule: [1],
      supersededOrderSchedule: [2],
      coverageSummary: { a: 1 },
      realReceivables: [3],
      itemBreakdown: [{ segredo: true }],
      alerts: ["x"],
    } as never);
    assert.deepEqual(Object.keys(recorte).sort(), [
      "activeOrderResidualSchedule",
      "coverageSummary",
      "realReceivables",
      "supersededOrderSchedule",
    ]);
  });

  it("Decimal-like é comparado como escalar, não percorrido", () => {
    const dec = (v: string) => ({ toFixed: () => v, toString: () => v });
    assert.deepEqual(diffDeep({ v: dec("600") }, { v: "600" }), []);
    const diffs = diffDeep({ v: dec("600") }, { v: dec("599.99") });
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0]?.path, "v");
  });

  it("TRAVA: datas diferentes não podem passar por iguais", () => {
    const a = { d: new Date("2026-01-20T00:00:00.000Z") };
    const b = { d: new Date("2026-03-20T00:00:00.000Z") };
    assert.equal(diffDeep(a, b).length, 1, "Date precisa ser escalar no diff");
    assert.deepEqual(diffDeep(a, { d: new Date("2026-01-20T00:00:00.000Z") }), []);
  });
});
