/**
 * Seleção de schedule quando existe versão antiga e versão vigente.
 *
 * Caso de referência: PD 02697 em produção.
 *   - snapshot antigo SUPERSEDED, comissão total 0;
 *   - cinco schedules antigos ainda ACTIVE, todos zerados;
 *   - snapshot atual ACTIVE, comissão total R$ 688,96;
 *   - cinco schedules atuais de R$ 137,79 cada;
 *   - duas linhas do ledger fecharam como ZERO_AMOUNT/NO_MARGIN.
 *
 * O motor escolhia o primeiro schedule ACTIVE que encontrasse, sem olhar o
 * status do snapshot pai — e a ordem vinha do heap do Postgres, que entrega os
 * mais antigos primeiro. Resultado: comissão legítima fechada como zero.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionReceiptPreview,
  mapMaterializedScheduleToLedgerStatus,
  pickMaterializedScheduleForReceivable,
  type CommissionReceiptReceivableInput,
  type MaterializedReceivableScheduleInput,
} from "./commissionReceiptEngine.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";

const OK_IDENTITY: CommissionSellerIdentityContext = {
  persons: [
    {
      id: "person-seller",
      nomusPersonId: 10,
      name: "VENDEDOR",
      type: "SELLER",
      source: "NOMUS",
      active: true,
      linkedRecordCount: 1,
    },
  ],
  aliases: [],
};

function schedule(
  partial: Partial<MaterializedReceivableScheduleInput> &
    Pick<MaterializedReceivableScheduleInput, "receivableId" | "scheduledCommissionAmount">
): MaterializedReceivableScheduleInput {
  return {
    id: `sched-${partial.receivableId}-${partial.orderSnapshotId ?? "cur"}`,
    orderSnapshotId: "snap-atual",
    receivableCode: null,
    installmentNumber: 1,
    nfeId: 700,
    salesOrderId: "order-02697",
    customerId: "cust-1",
    canonicalSellerId: "person-seller",
    canonicalSellerName: "VENDEDOR",
    rawSellerId: 10,
    rawSellerName: "VENDEDOR",
    orderCode: "PD 02697",
    receivableNominalAmount: 3000,
    receivableSharePercent: 100,
    scheduleStatus: "ACTIVE",
    orderSnapshotStatus: "ACTIVE",
    sellerResolutionStatus: "OK_CANONICAL",
    exclusionRuleId: null,
    exclusionReason: null,
    ...partial,
  };
}

function receivable(
  partial: Partial<CommissionReceiptReceivableInput> &
    Pick<CommissionReceiptReceivableInput, "nomusReceivableId">
): CommissionReceiptReceivableInput {
  return {
    settlementDate: new Date("2026-06-15"),
    dueDate: new Date("2026-06-30"),
    amountReceivable: 3000,
    amountReceived: 3000,
    nomusNfeId: 700,
    nfeNumber: "02697",
    customerExternalId: 200,
    customerName: "Cliente Teste",
    ...partial,
  };
}

/** Órfão: ACTIVE, zerado, mas pai substituído — a linha antiga do PD 02697. */
const staleZero = (receivableId: number) =>
  schedule({
    receivableId,
    scheduledCommissionAmount: 0,
    orderSnapshotId: "snap-antigo",
    orderSnapshotStatus: "SUPERSEDED",
    orderSnapshotFinalCommissionAmount: 0,
  });

/** Vigente: a parcela correta de R$ 137,79. */
const current = (receivableId: number) =>
  schedule({
    receivableId,
    scheduledCommissionAmount: 137.79,
    orderSnapshotId: "snap-atual",
    orderSnapshotStatus: "ACTIVE",
    orderSnapshotFinalCommissionAmount: 688.96,
  });

describe("PD 02697 — schedule antigo zerado x schedule vigente positivo", () => {
  it("o motor seleciona o schedule da versão VIGENTE, não o antigo zerado", () => {
    // Antigo primeiro na lista: reproduz a ordem física do heap.
    const picked = pickMaterializedScheduleForReceivable([
      staleZero(9001),
      current(9001),
    ]);
    assert.equal(picked?.orderSnapshotId, "snap-atual");
    assert.equal(picked?.scheduledCommissionAmount, 137.79);
  });

  it("comissão fica positiva e o resultado NÃO é NO_MARGIN", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 9001 })],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([
        [9001, [staleZero(9001), current(9001)]],
      ]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });

    assert.equal(result.lines.length, 1);
    const line = result.lines[0]!;
    assert.notEqual(line.status, "NO_MARGIN");
    assert.notEqual(line.status, "ZERO_AMOUNT");
    assert.equal(line.status, "COMMISSIONABLE");
    assert.ok(
      line.expectedCommissionAmount > 0,
      "comissão esperada precisa ser positiva"
    );
    assert.equal(line.expectedCommissionAmount, 137.79);
  });

  it("não soma os dois conjuntos — uma linha, uma parcela", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 9001 })],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([
        [9001, [staleZero(9001), current(9001)]],
      ]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0]!.expectedCommissionAmount, 137.79);
  });

  it("as cinco parcelas do pedido somam a comissão oficial do snapshot atual", () => {
    const receivableIds = [9001, 9002, 9003, 9004, 9005];
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: receivableIds.map((id) =>
        receivable({ nomusReceivableId: id })
      ),
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map(
        receivableIds.map((id) => [id, [staleZero(id), current(id)]])
      ),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });

    assert.equal(result.lines.length, 5);
    const total = result.lines.reduce(
      (sum, l) => sum + l.expectedCommissionAmount,
      0
    );
    // 5 × 137,79 = 688,95 — um centavo do arredondamento da distribuição.
    assert.ok(
      Math.abs(total - 688.96) <= 0.05,
      `total esperado ~688,96, veio ${total}`
    );
    assert.equal(
      result.lines.every((l) => l.status === "COMMISSIONABLE"),
      true
    );
  });
});

describe("vigência de schedule — demais cenários obrigatórios", () => {
  it("dois schedules para o mesmo título, só um com snapshot ACTIVE", () => {
    const picked = pickMaterializedScheduleForReceivable([
      schedule({
        receivableId: 1,
        scheduledCommissionAmount: 999,
        orderSnapshotId: "snap-antigo",
        orderSnapshotStatus: "SUPERSEDED",
      }),
      schedule({
        receivableId: 1,
        scheduledCommissionAmount: 50,
        orderSnapshotId: "snap-atual",
        orderSnapshotStatus: "ACTIVE",
      }),
    ]);
    assert.equal(picked?.scheduledCommissionAmount, 50);
  });

  it("CUSTOMER_EXCLUDED de snapshot SUPERSEDED é ignorado", () => {
    const picked = pickMaterializedScheduleForReceivable([
      schedule({
        receivableId: 2,
        scheduledCommissionAmount: 0,
        scheduleStatus: "CUSTOMER_EXCLUDED",
        orderSnapshotId: "snap-antigo",
        orderSnapshotStatus: "SUPERSEDED",
      }),
      schedule({
        receivableId: 2,
        scheduledCommissionAmount: 80,
        orderSnapshotId: "snap-atual",
        orderSnapshotStatus: "ACTIVE",
      }),
    ]);
    assert.equal(picked?.scheduledCommissionAmount, 80);
    assert.equal(picked?.scheduleStatus, "ACTIVE");
  });

  it("CUSTOMER_EXCLUDED do snapshot VIGENTE é preservado", () => {
    const picked = pickMaterializedScheduleForReceivable([
      schedule({
        receivableId: 3,
        scheduledCommissionAmount: 0,
        scheduleStatus: "CUSTOMER_EXCLUDED",
        orderSnapshotStatus: "ACTIVE",
      }),
    ]);
    assert.equal(picked?.scheduleStatus, "CUSTOMER_EXCLUDED");
  });

  it("nenhum schedule vigente → ausência explícita (null), sem cair no antigo", () => {
    const picked = pickMaterializedScheduleForReceivable([
      staleZero(4),
      schedule({
        receivableId: 4,
        scheduledCommissionAmount: 123,
        orderSnapshotId: "snap-antigo-2",
        orderSnapshotStatus: "SUPERSEDED",
      }),
    ]);
    assert.equal(picked, null);
  });

  it("ausência de snapshot vigente gera diagnóstico explícito, não comissão", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 4 })],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([[4, [staleZero(4)]]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines.length, 1);
    const line = result.lines[0]!;
    assert.notEqual(line.status, "COMMISSIONABLE");
    assert.equal(line.releasedCommissionAmount, 0);
    assert.ok(
      line.statusReason && line.statusReason.length > 0,
      "diagnóstico precisa dizer o motivo"
    );
  });

  it("o mapeador de status rejeita pai substituído na última milha", () => {
    // Defesa em profundidade: mapMaterializedScheduleToLedgerStatus é exportado
    // e usado também pela auditoria de rastreio. Se um órfão chegasse até ele,
    // antes caía em NO_MARGIN lendo os itens da versão ANTIGA.
    const mapped = mapMaterializedScheduleToLedgerStatus({
      ...staleZero(7),
      itemSnapshotStatuses: ["NO_COMMERCIAL_PRICE_TABLE"],
    });
    assert.equal(mapped.status, "STALE_SCHEDULE");
    assert.notEqual(mapped.status, "NO_MARGIN");
  });

  it("o mapeador preserva o diagnóstico de mérito quando o pai é vigente", () => {
    // NO_MARGIN real continua válido — a guarda não pode engolir o caso legítimo.
    const mapped = mapMaterializedScheduleToLedgerStatus(
      schedule({
        receivableId: 8,
        scheduledCommissionAmount: 0,
        orderSnapshotStatus: "ACTIVE",
        orderSnapshotFinalCommissionAmount: 0,
        itemSnapshotStatuses: ["NO_COMMERCIAL_PRICE_TABLE"],
      })
    );
    assert.equal(mapped.status, "NO_MARGIN");
  });

  it("status desconhecido do pai não é tratado como vigente (fail-closed)", () => {
    const picked = pickMaterializedScheduleForReceivable([
      schedule({
        receivableId: 5,
        scheduledCommissionAmount: 10,
        orderSnapshotStatus: null,
      }),
    ]);
    assert.equal(picked, null);
  });
});
