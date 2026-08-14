/**
 * CARACTERIZAÇÃO — `projectOrderAuditReceivables` × laço inline antigo.
 *
 * `referencia()` é transcrição literal do `for (const r of arRows)` que vivia
 * em `loadOrderFullAuditUncached` antes da extração. Divergência aqui é
 * mudança de regra financeira, não teste desatualizado.
 *
 * Dinheiro comparado por igualdade exata.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decimalToNumber,
  readNomusRawString,
  toIso,
} from "@/src/lib/finance/orderAuditItemProjection.js";
import {
  dedupOrderAuditReceivables,
  projectOrderAuditReceivables,
  type OrderAuditReceivableSource,
  type ReceivableLinkedNfe,
} from "@/src/lib/finance/orderAuditReceivableProjection.js";

const MONEY_TOLERANCE = 0.01;
const REFERENCE_DATE = new Date("2026-08-14T12:00:00.000Z");

function referencia(
  arRows: ReadonlyArray<OrderAuditReceivableSource>,
  nfeMap: ReadonlyMap<number, ReceivableLinkedNfe>,
  referenceDate: Date
) {
  const referenceMs = referenceDate.getTime();
  const parseInstallment = (desc: string | null | undefined) => {
    if (!desc) return { current: null, total: null };
    const match = /(\d{1,3})\s*(?:\/|\s+de\s+)\s*(\d{1,3})/i.exec(desc) ?? null;
    if (!match) return { current: null, total: null };
    const cur = Number(match[1]);
    const tot = Number(match[2]);
    if (!Number.isFinite(cur) || !Number.isFinite(tot) || tot < cur) {
      return { current: null, total: null };
    }
    return { current: cur, total: tot };
  };

  const receivables: unknown[] = [];
  for (const r of arRows) {
    const amountReceivable = decimalToNumber(r.amountReceivable) ?? 0;
    const amountScheduled = decimalToNumber(r.amountScheduled);
    const amountReceived = decimalToNumber(r.amountReceived) ?? 0;
    const balance =
      decimalToNumber(r.balanceReceivable) ??
      Math.max(0, amountReceivable - amountReceived);
    const isReceived =
      balance <= MONEY_TOLERANCE && amountReceived > MONEY_TOLERANCE;
    const isPartial =
      amountReceived > MONEY_TOLERANCE && balance > MONEY_TOLERANCE;
    const isOverdue =
      !isReceived &&
      balance > MONEY_TOLERANCE &&
      r.dueDate != null &&
      r.dueDate.getTime() < referenceMs;
    const daysOverdue =
      r.dueDate != null && !isReceived
        ? Math.floor((referenceMs - r.dueDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;
    const installment = parseInstallment(r.description ?? r.comments ?? null);
    const searchRef =
      r.sourceInvoiceNumber?.trim() ||
      (r.sourceInvoiceId != null ? String(r.sourceInvoiceId) : "") ||
      String(r.externalId);

    const linkedNfe =
      r.sourceInvoiceId != null ? nfeMap.get(r.sourceInvoiceId) : undefined;
    const linkedNfeIsCanceled = linkedNfe?.isCanceled === true;
    const status = isReceived
      ? "RECEIVED"
      : isPartial
        ? "PARTIALLY_RECEIVED"
        : isOverdue
          ? "OVERDUE"
          : balance > MONEY_TOLERANCE
            ? "OPEN"
            : "UNKNOWN";

    const alertsForLine: string[] = [];
    if (!isReceived && balance > MONEY_TOLERANCE) {
      alertsForLine.push("RECEIVABLE_OPEN");
    }
    if (isOverdue) alertsForLine.push("RECEIVABLE_OVERDUE");
    if (r.sourceInvoiceId == null) alertsForLine.push("RECEIVABLE_WITHOUT_NFE");
    if (r.dueDate == null) alertsForLine.push("RECEIVABLE_WITHOUT_DUE_DATE");
    if (amountReceived - amountReceivable > MONEY_TOLERANCE) {
      alertsForLine.push("RECEIPT_GREATER_THAN_RECEIVABLE");
    }
    if (
      isPartial &&
      Math.abs(amountReceivable - amountReceived - balance) > MONEY_TOLERANCE
    ) {
      alertsForLine.push("PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE");
    }
    if (linkedNfeIsCanceled) {
      alertsForLine.push("CANCELED_NFE_WITH_RECEIVABLE");
      if (status === "RECEIVED" || status === "PARTIALLY_RECEIVED") {
        alertsForLine.push("RECEIVED_CR_LINKED_TO_CANCELED_NFE");
      }
    }

    receivables.push({
      receivableExternalId: r.externalId,
      receivableId: r.id ?? null,
      companyName: r.companyName ?? null,
      personName: r.personName ?? null,
      personCnpj: r.personCnpj ?? null,
      description: r.description ?? null,
      sourceInvoiceId: r.sourceInvoiceId ?? null,
      sourceInvoiceNumber: r.sourceInvoiceNumber ?? null,
      issueDate: toIso(r.createdAtNomus),
      dueDate: toIso(r.dueDate),
      competenceDate: toIso(r.competenceDate),
      scheduleDate: toIso(r.scheduleDate),
      settlementDate: toIso(r.settlementDate),
      amountReceivable,
      amountScheduled,
      amountReceived,
      balanceReceivable: balance,
      installmentNumber: installment.current,
      totalInstallments: installment.total,
      paymentTermsText: readNomusRawString(r.rawPayload, [
        "condicaoPagamento",
        "descricaoCondicaoPagamento",
        "paymentTerms",
        "textoCondicaoPagamento",
      ]),
      paymentMethodName: r.paymentMethodName ?? null,
      bankAccountName: r.bankAccountName ?? null,
      comments: r.comments ?? null,
      status,
      receivableIsReceived: status === "RECEIVED",
      daysOverdue,
      linkedNfeExternalIds: r.sourceInvoiceId != null ? [r.sourceInvoiceId] : [],
      linkedNfeNumber: linkedNfe?.numero ?? r.sourceInvoiceNumber ?? null,
      linkedNfeStatusLabel: linkedNfe?.statusLabel ?? null,
      linkedNfeIsCanceled,
      hasCanceledNfeLink: linkedNfeIsCanceled,
      origin: r.sourceInvoiceId != null ? "SOURCE_INVOICE" : "UNKNOWN",
      linkOrigin: r.sourceInvoiceId != null ? "SOURCE_INVOICE" : "UNKNOWN",
      alerts: alertsForLine,
      searchReference: searchRef,
    });
  }
  return receivables;
}

function cr(
  over: Partial<OrderAuditReceivableSource> & { externalId: number }
): OrderAuditReceivableSource {
  return {
    id: `cr-${over.externalId}`,
    companyName: "Koppetel",
    personName: "Cliente Alfa",
    personCnpj: "12345678000199",
    description: null,
    comments: null,
    sourceInvoiceId: 900,
    sourceInvoiceNumber: "900",
    createdAtNomus: new Date("2026-06-01T00:00:00.000Z"),
    dueDate: new Date("2026-09-01T00:00:00.000Z"),
    competenceDate: new Date("2026-06-01T00:00:00.000Z"),
    scheduleDate: null,
    settlementDate: null,
    amountReceivable: "1000",
    amountScheduled: null,
    amountReceived: "0",
    balanceReceivable: "1000",
    paymentMethodName: "Boleto",
    bankAccountName: "Itau",
    rawPayload: null,
    ...over,
  };
}

const NFE_MAP = new Map<number, ReceivableLinkedNfe>([
  [900, { numero: "900", statusLabel: "Autorizada", isCanceled: false }],
  [901, { numero: "901", statusLabel: "Cancelada", isCanceled: true }],
]);

const CENARIOS: Array<{ nome: string; rows: OrderAuditReceivableSource[] }> = [
  { nome: "um CR em aberto", rows: [cr({ externalId: 5001 })] },
  {
    nome: "múltiplos CR do mesmo pedido",
    rows: [cr({ externalId: 5001 }), cr({ externalId: 5002 })],
  },
  {
    nome: "duas parcelas com número na descrição",
    rows: [
      cr({ externalId: 5010, description: "Parcela 1/2" }),
      cr({ externalId: 5011, description: "Parcela 2 de 2" }),
    ],
  },
  {
    nome: "parcela lida do comentário quando a descrição é nula",
    rows: [cr({ externalId: 5012, description: null, comments: "3/4" })],
  },
  {
    nome: "parcela inválida (total menor que a atual) é descartada",
    rows: [cr({ externalId: 5013, description: "5/2" })],
  },
  {
    nome: "CR vencido",
    rows: [
      cr({ externalId: 5020, dueDate: new Date("2026-07-01T00:00:00.000Z") }),
    ],
  },
  {
    nome: "CR totalmente recebido",
    rows: [
      cr({ externalId: 5030, amountReceived: "1000", balanceReceivable: "0" }),
    ],
  },
  {
    nome: "CR parcialmente recebido",
    rows: [
      cr({ externalId: 5040, amountReceived: "400", balanceReceivable: "600" }),
    ],
  },
  {
    nome: "recebido acima do previsto",
    rows: [
      cr({ externalId: 5050, amountReceived: "1200", balanceReceivable: "0" }),
    ],
  },
  {
    nome: "baixa parcial com saldo inconsistente",
    rows: [
      cr({ externalId: 5060, amountReceived: "400", balanceReceivable: "300" }),
    ],
  },
  {
    nome: "saldo ausente é derivado de previsto − recebido",
    rows: [
      cr({ externalId: 5070, amountReceived: "250", balanceReceivable: null }),
    ],
  },
  {
    nome: "CR sem NF e sem vencimento",
    rows: [
      cr({
        externalId: 5080,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        dueDate: null,
      }),
    ],
  },
  {
    nome: "CR ligado a NF cancelada",
    rows: [cr({ externalId: 5090, sourceInvoiceId: 901 })],
  },
  {
    nome: "CR recebido ligado a NF cancelada (dois alertas)",
    rows: [
      cr({
        externalId: 5091,
        sourceInvoiceId: 901,
        amountReceived: "1000",
        balanceReceivable: "0",
      }),
    ],
  },
  {
    nome: "campos de pessoa e datas nulos",
    rows: [
      cr({
        externalId: 5100,
        companyName: null,
        personName: null,
        personCnpj: null,
        createdAtNomus: null,
        competenceDate: null,
        settlementDate: null,
        paymentMethodName: null,
        bankAccountName: null,
      }),
    ],
  },
  {
    nome: "condição de pagamento vem do rawPayload",
    rows: [
      cr({
        externalId: 5110,
        rawPayload: { descricaoCondicaoPagamento: "  30/60/90  " },
      }),
    ],
  },
  {
    nome: "valores decimais e agendamento",
    rows: [
      cr({
        externalId: 5120,
        amountReceivable: "1234.56",
        amountScheduled: "1000.01",
        amountReceived: "234.55",
        balanceReceivable: "1000.01",
        scheduleDate: new Date("2026-10-05T00:00:00.000Z"),
      }),
    ],
  },
];

describe("CARACTERIZAÇÃO — mapper de recebíveis do audit (extraído × inline)", () => {
  for (const cenario of CENARIOS) {
    it(cenario.nome, () => {
      const esperado = referencia(cenario.rows, NFE_MAP, REFERENCE_DATE);
      const obtido = projectOrderAuditReceivables({
        rows: cenario.rows,
        nfeByExternalId: NFE_MAP,
        referenceDate: REFERENCE_DATE,
      });
      assert.deepEqual(
        JSON.parse(JSON.stringify(obtido)),
        JSON.parse(JSON.stringify(esperado))
      );
    });
  }

  it("dedup por receivableExternalId: último vence, ordem da 1ª aparição", () => {
    const rows = [
      cr({ externalId: 5001, personName: "Primeiro" }),
      cr({ externalId: 5002, personName: "Outro" }),
      cr({ externalId: 5001, personName: "Ultimo" }),
    ];
    const projetados = projectOrderAuditReceivables({
      rows,
      nfeByExternalId: NFE_MAP,
      referenceDate: REFERENCE_DATE,
    });
    assert.equal(projetados.length, 3, "o mapper não deduplica");

    const dedup = dedupOrderAuditReceivables(projetados);
    assert.equal(dedup.length, 2);
    assert.deepEqual(
      dedup.map((r) => r.receivableExternalId),
      [5001, 5002],
      "ordem é a da primeira aparição de cada chave"
    );
    assert.equal(
      dedup[0]?.personName,
      "Ultimo",
      "último registro com o mesmo externalId prevalece"
    );
  });

  it("dedup preserva CRs distintos e não colapsa parcelas", () => {
    const rows = [
      cr({ externalId: 5010, description: "1/2", amountReceivable: "500" }),
      cr({ externalId: 5011, description: "2/2", amountReceivable: "500" }),
    ];
    const dedup = dedupOrderAuditReceivables(
      projectOrderAuditReceivables({
        rows,
        nfeByExternalId: NFE_MAP,
        referenceDate: REFERENCE_DATE,
      })
    );
    assert.equal(dedup.length, 2);
    assert.deepEqual(
      dedup.map((r) => r.amountReceivable),
      [500, 500],
      "dinheiro exato, sem soma nem arredondamento"
    );
  });

  it("mapa de NF ausente não quebra a projeção", () => {
    const semMapa = projectOrderAuditReceivables({
      rows: [cr({ externalId: 5001 })],
      referenceDate: REFERENCE_DATE,
    });
    assert.equal(semMapa[0]?.linkedNfeIsCanceled, false);
    assert.equal(
      semMapa[0]?.linkedNfeNumber,
      "900",
      "cai no sourceInvoiceNumber quando não há NF no mapa"
    );
  });
});
