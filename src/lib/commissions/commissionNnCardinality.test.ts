/**
 * Cardinalidade N:N entre pedidos, NF-e, títulos, recebimentos e comissões.
 *
 * Só usa caminhos oficiais: scheduler real (rateio do snapshot pelos títulos da
 * NF-e), motor real da prévia, ledger, validação de aplicação, geração de
 * cobertura e aplicação do fechamento com banco falso em memória. Nenhum dado é
 * gravado fora da memória do teste.
 *
 * Regressão do incidente: NF-e 7862 (Nomus 8204) com PD 02933 e PD 02997 da
 * vendedora VENDEDORA SINTÉTICA 464; título 19809 recebido em 20/10/2026 (evento 12130).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionReceiptPreview,
  type CommissionReceiptPreviewResult,
} from "./commissionReceiptEngine.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import { buildCarryoverRows, type ReceiptEventForCoverage } from "./commissionReceiptCoverage.js";
import {
  aggregateMonthlyPayableFromLedgerLines,
  aggregateMonthlyPayableFromReceiptPreview,
  assessReceiptClosingApplyReadiness,
  mapLedgerRowToSnapshot,
  mapPreviewLineToLedgerCreateData,
  ReceiptClosingDuplicateError,
  ReceiptClosingValidationError,
  validateReceiptClosingPreviewForApply,
} from "./commissionReceiptClosing.js";
import { detectDuplicateReceived } from "./commissionNomusReceiptReconciliation.js";
import {
  projectCommissionPortfolioOutlookLines,
  type OutlookScheduleInput,
} from "./commissionPortfolioOutlook.js";
import { applyCommissionReceiptClosing } from "./commissionReceiptClosing.server.js";
import {
  ensureCommissionMaterializationForReceivableRefs,
  type MaterializationOrchestratorDeps,
} from "./commissionMaterializationOrchestrator.server.js";
import { classifyCommission360Receivable } from "./commission360View.js";
import { summarizeLinesByOrderAndNfe } from "./commissionReceiptFinancialAnchor.shared.js";
import {
  attributedReceived,
  buildWorld,
  closingDeps,
  coverageFor,
  createClosingDb,
  CUSTOMER_EXTERNAL_ID,
  CUSTOMER_NAME,
  eventsFrom,
  SELLER_464,
  INCIDENT,
  INCIDENT_RECEIPT,
  incidentPreview,
  linesOf,
  multiOrderScenario,
  type OrderSpec,
  previewContext,
  receivedTitle,
  type ReceiptSpec,
  SELLER_470,
  round2,
  type ScenarioSpec,
  seededRandom,
  shuffled,
  splitOrderScenario,
  sum,
  TWO_SELLERS,
} from "./commissionNnCardinality.fixtures.js";

describe("N:N — incidente NF-e 7862 (PD 02933 + PD 02997)", () => {
  it("os schedules oficiais da 1ª parcela somam R$ 136,89 (R$ 30,11 + R$ 106,78)", () => {
    const world = buildWorld(INCIDENT);
    const schedules = world.schedulesByReceivable.get(19809)!;
    const byOrder = new Map(schedules.map((row) => [row.orderCode, row.scheduledCommissionAmount]));
    assert.equal(byOrder.get("02933"), 30.11);
    assert.equal(byOrder.get("02997"), 106.78);
  });

  it("prévia: duas linhas comissionáveis da vendedora 464, uma por pedido, R$ 136,89 liberados", () => {
    const { preview } = incidentPreview();
    const lines = linesOf(preview, 19809);
    assert.equal(lines.length, 2);
    assert.deepEqual(
      lines.map((line) => [line.orderCode, line.status, line.canonicalSellerName, line.releasedCommissionAmount]),
      [
        ["02933", "COMMISSIONABLE", "VENDEDORA SINTÉTICA 464", 30.11],
        ["02997", "COMMISSIONABLE", "VENDEDORA SINTÉTICA 464", 106.78],
      ]
    );
    assert.equal(preview.totalReleasedCommission, 136.89);
    assert.ok(lines.every((line) => line.commissionReceivableScheduleId != null));
    assert.ok(lines.every((line) => !/Sem vendedor/i.test(line.canonicalSellerName ?? line.rawSellerName ?? "")));
  });

  it("o recebimento de R$ 4.435,50 conta uma vez no total, por vendedor e na base", () => {
    const { preview } = incidentPreview();
    const lines = linesOf(preview, 19809);
    assert.equal(preview.totalReceivedAmount, 4435.5);
    assert.equal(sum(lines.map(attributedReceived)), 4435.5);
    assert.equal(sum(lines.map((line) => line.commissionableBaseAmount)), 4435.5);
    assert.equal(preview.totalCommissionableBase, 4435.5);
    const gislene = preview.bySeller.filter((row) => row.sellerId === SELLER_464.personId);
    assert.equal(gislene.length, 1);
    assert.equal(gislene[0]!.receivedAmount, 4435.5);
    assert.equal(gislene[0]!.releasedCommission, 136.89);
  });

  it("aplicação liberada, ledger com uma chave por pedido e cobertura única de R$ 136,89", () => {
    const { preview, receivable } = incidentPreview();
    assert.doesNotThrow(() => validateReceiptClosingPreviewForApply(preview));
    assert.equal(assessReceiptClosingApplyReadiness(preview).canApply, true);
    const rows = preview.lines.map((line) => mapPreviewLineToLedgerCreateData(line, "closing-test"));
    assert.equal(new Set(rows.map((row) => row.ledgerLineKey)).size, 2);
    assert.deepEqual(rows.map((row) => row.orderCode).sort(), ["02933", "02997"]);
    assert.deepEqual(rows.map((row) => row.nomusOrderId).sort(), [2934, 2998]);
    assert.equal(sum(rows.map((row) => Number(row.allocatedReceivedAmount))), 4435.5);
    for (const row of rows) {
      const json = row.ruleSnapshotJson as Record<string, unknown>;
      assert.ok(json.commissionReceivableScheduleId, "schedule no ledger");
      assert.ok(json.orderSnapshotId, "snapshot no ledger");
      assert.ok(json.salesOrderId, "pedido no ledger");
    }
    const coverage = coverageFor(preview, eventsFrom([receivable], new Map([[19809, [INCIDENT_RECEIPT]]])));
    // Cobertura por direito (B4): um registro por pedido; Σ recebido = evento, Σ comissão = R$ 136,89.
    assert.deepEqual(
      coverage.map((row) => [row.receiptExternalId, row.salesOrderId, row.coveredReceivedAmount, row.coveredCommissionAmount]),
      [
        [12130, "so-2934", 1005.15, 30.11],
        [12130, "so-2998", 3430.35, 106.78],
      ]
    );
    assert.equal(sum(coverage.map((row) => row.coveredReceivedAmount)), 4435.5);
  });

  it("reexecutar ou permutar a ordem dos schedules/pedidos não muda a prévia", () => {
    const first = incidentPreview().preview;
    const second = incidentPreview().preview;
    assert.deepEqual(second, first);
    const world = buildWorld(INCIDENT);
    world.schedulesByReceivable.set(19809, [...world.schedulesByReceivable.get(19809)!].reverse());
    world.bundlesByNfe.set(8204, [...world.bundlesByNfe.get(8204)!].reverse());
    const receivable = receivedTitle(world, 19809, [INCIDENT_RECEIPT]);
    const permuted = buildCommissionReceiptPreview(previewContext(world, [receivable], { year: 2026, month: 10 }));
    assert.deepEqual(permuted, first);
  });

  it("conciliação Nomus não acusa recebido duplicado para dois pedidos legítimos", () => {
    const { preview } = incidentPreview();
    assert.deepEqual(detectDuplicateReceived(preview.lines), []);
  });

  it("valor a pagar (prévia e ledger) conta o recebido do título uma vez", () => {
    const { preview } = incidentPreview();
    const fromPreview = aggregateMonthlyPayableFromReceiptPreview(preview, { year: 2026, month: 10 });
    assert.equal(fromPreview.receivedAmountTotal, 4435.5);
    assert.equal(fromPreview.payableCommissionTotal, 136.89);
    const ledgerRows = preview.lines.map((line, index) => ({
      ...mapPreviewLineToLedgerCreateData(line, "closing-test"),
      id: `ledger-${index}`,
    }));
    const snapshots = ledgerRows.map((row) => mapLedgerRowToSnapshot(row as never));
    const fromLedger = aggregateMonthlyPayableFromLedgerLines(snapshots, { year: 2026, month: 10 });
    assert.equal(fromLedger.receivedAmountTotal, 4435.5);
    assert.equal(fromLedger.payableCommissionTotal, 136.89);
    assert.equal(sum(fromLedger.sellers.map((row) => row.receivedAmount)), 4435.5);
  });

  it("recebimento parcial em competências distintas libera frações sem exceder o programado", () => {
    const world = buildWorld(INCIDENT);
    const november = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 19810, [{ id: 13001, date: "2026-11-05", amount: 1774.2 }])], {
        year: 2026,
        month: 11,
      })
    );
    const december = buildCommissionReceiptPreview(
      previewContext(
        world,
        [receivedTitle(world, 19810, [{ id: 13002, date: "2026-12-04", amount: 2661.3 }], 1774.2)],
        { year: 2026, month: 12 }
      )
    );
    const scheduled = new Map(
      world.schedulesByReceivable.get(19810)!.map((row) => [row.orderCode, row.scheduledCommissionAmount])
    );
    for (const code of ["02933", "02997"]) {
      const nov = linesOf(november, 19810).find((line) => line.orderCode === code)!;
      const dec = linesOf(december, 19810).find((line) => line.orderCode === code)!;
      assert.equal(nov.status, "COMMISSIONABLE");
      assert.equal(dec.status, "COMMISSIONABLE");
      assert.ok(nov.releasedCommissionAmount <= scheduled.get(code)!);
      assert.ok(Math.abs(round2(nov.releasedCommissionAmount + dec.releasedCommissionAmount) - scheduled.get(code)!) <= 0.01);
    }
    assert.equal(november.totalReceivedAmount, 1774.2);
    assert.equal(december.totalReceivedAmount, 2661.3);
  });
});

/* ------------------------------------------------------------------ */
/*  Cardinalidade: N pedidos na mesma NF-e                             */
/* ------------------------------------------------------------------ */

describe("N:N — N pedidos na mesma NF-e (propriedades com semente)", () => {
  for (const count of [1, 2, 8, 10, 50, 100]) {
    it(`${count} pedido(s): uma linha por pedido, recebido uma vez, Σ comissão = Σ schedules`, () => {
      const seed = 100 + count;
      const spec = multiOrderScenario(count, seed);
      const world = buildWorld(spec);
      const titleId = spec.nfes[0]!.titles[0]!.id;
      const nominal = spec.nfes[0]!.titles[0]!.nominal;
      const receipt: ReceiptSpec = { id: 900000 + seed, date: "2026-10-15", amount: nominal };
      const receivable = receivedTitle(world, titleId, [receipt]);
      const preview = buildCommissionReceiptPreview(previewContext(world, [receivable], { year: 2026, month: 10 }));
      const lines = linesOf(preview, titleId);
      const scheduled = sum(world.schedulesByReceivable.get(titleId)!.map((row) => row.scheduledCommissionAmount));

      assert.equal(lines.length, count);
      assert.ok(lines.every((line) => line.status === "COMMISSIONABLE"));
      assert.equal(new Set(lines.map((line) => line.localOrderId)).size, count);
      assert.equal(new Set(lines.map((line) => line.ledgerLineKey)).size, count);
      assert.equal(preview.totalReleasedCommission, scheduled);
      assert.equal(preview.totalReceivedAmount, nominal);
      assert.equal(sum(lines.map(attributedReceived)), nominal);
      assert.equal(sum(lines.map((line) => line.commissionableBaseAmount)), nominal);
      assert.equal(sum(preview.bySeller.map((row) => row.receivedAmount)), nominal);
      // Totais por pedido e por NF-e (B3): recebido uma vez, comissão = schedule de cada pedido.
      const totals = summarizeLinesByOrderAndNfe(lines);
      assert.equal(totals.byOrder.length, count);
      assert.equal(sum(totals.byOrder.map((row) => row.receivedAmount)), nominal);
      for (const row of totals.byOrder) {
        const own = world.schedulesByReceivable.get(titleId)!.filter((schedule) => schedule.salesOrderId === row.key);
        assert.equal(row.releasedCommission, sum(own.map((schedule) => schedule.scheduledCommissionAmount)));
      }
      assert.deepEqual(
        totals.byNfe.map((row) => [row.receivableCount, row.receivedAmount, row.releasedCommission]),
        [[1, nominal, scheduled]]
      );
      assert.doesNotThrow(() => validateReceiptClosingPreviewForApply(preview));

      const coverage = coverageFor(preview, eventsFrom([receivable], new Map([[titleId, [receipt]]])));
      // Um registro por (evento, pedido); o evento é consumido uma vez no total.
      assert.equal(coverage.length, count);
      assert.equal(new Set(coverage.map((row) => row.salesOrderId)).size, count);
      assert.equal(sum(coverage.map((row) => row.coveredCommissionAmount)), scheduled);
      assert.equal(sum(coverage.map((row) => row.coveredReceivedAmount)), nominal);

      // Idempotência e permutação.
      const random = seededRandom(seed * 7);
      const shuffledWorld = buildWorld({ ...spec, orders: shuffled(spec.orders, random), links: shuffled(spec.links, random) });
      shuffledWorld.schedulesByReceivable.set(titleId, shuffled(shuffledWorld.schedulesByReceivable.get(titleId)!, random));
      const again = buildCommissionReceiptPreview(
        previewContext(shuffledWorld, [receivedTitle(shuffledWorld, titleId, [receipt])], { year: 2026, month: 10 })
      );
      assert.deepEqual(again, preview);
    });
  }
});

/* ------------------------------------------------------------------ */
/*  Vários vendedores, exclusões, zero legítimo                        */
/* ------------------------------------------------------------------ */

describe("N:N — vendedores, exclusões e comissão zero", () => {
  it("dois vendedores na mesma NF-e: cada um recebe só a parcela atribuível", () => {
    const world = buildWorld(TWO_SELLERS);
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 93001, [{ id: 1, date: "2026-10-10", amount: 4000 }])], {
        year: 2026,
        month: 10,
      })
    );
    const bySeller = new Map(preview.bySeller.map((row) => [row.sellerId, row]));
    assert.equal(bySeller.get(SELLER_464.personId)?.receivedAmount, 3000);
    assert.equal(bySeller.get(SELLER_464.personId)?.releasedCommission, 90);
    assert.equal(bySeller.get(SELLER_470.personId)?.receivedAmount, 1000);
    assert.equal(bySeller.get(SELLER_470.personId)?.releasedCommission, 50);
    assert.equal(preview.totalReceivedAmount, 4000);
    const lines = linesOf(preview, 93001);
    assert.deepEqual(
      lines.map((line) => [line.orderCode, line.canonicalSellerId]),
      [
        ["03001", SELLER_464.personId],
        ["03002", SELLER_470.personId],
      ]
    );
  });

  it("cliente em Exceções: todos os pedidos excluídos, cobertura final com comissão zero", () => {
    const world = buildWorld(TWO_SELLERS);
    const rule: CustomerExclusionRuleSnapshot = {
      id: "excl-1",
      customerId: null,
      customerExternalId: CUSTOMER_EXTERNAL_ID,
      customerNameSnapshot: CUSTOMER_NAME,
      normalizedCustomerName: CUSTOMER_NAME.toLowerCase(),
      reason: "Política comercial",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      status: "ACTIVE",
      notes: null,
    } as CustomerExclusionRuleSnapshot;
    const receivable = receivedTitle(world, 93001, [{ id: 2, date: "2026-10-10", amount: 4000 }]);
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivable], { year: 2026, month: 10 }, { exclusionRules: [rule] })
    );
    const lines = linesOf(preview, 93001);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => line.status === "CUSTOMER_EXCLUDED"));
    assert.equal(preview.totalReleasedCommission, 0);
    assert.doesNotThrow(() => validateReceiptClosingPreviewForApply(preview));
    const coverage = coverageFor(
      preview,
      eventsFrom([receivable], new Map([[93001, [{ id: 2, date: "2026-10-10", amount: 4000 }]]]))
    );
    // Um registro por direito (pedido), ambos finais com comissão zero; evento consumido uma vez.
    assert.deepEqual(
      coverage.map((row) => [row.receiptExternalId, row.salesOrderId, row.coveredCommissionAmount]),
      [
        [2, "so-g", 0],
        [2, "so-r", 0],
      ]
    );
    assert.equal(sum(coverage.map((row) => row.coveredReceivedAmount)), 4000);
  });

  it("comissão zero legítima ao lado de comissão positiva: ambas finais, cobertura com a soma", () => {
    const world = buildWorld({
      ...TWO_SELLERS,
      orders: [TWO_SELLERS.orders[0]!, { ...TWO_SELLERS.orders[1]!, commission: 0 }],
    });
    const receivable = receivedTitle(world, 93001, [{ id: 3, date: "2026-10-10", amount: 4000 }]);
    const preview = buildCommissionReceiptPreview(previewContext(world, [receivable], { year: 2026, month: 10 }));
    assert.deepEqual(
      linesOf(preview, 93001).map((line) => [line.orderCode, line.status]),
      [
        ["03001", "COMMISSIONABLE"],
        ["03002", "ZERO_AMOUNT"],
      ]
    );
    assert.doesNotThrow(() => validateReceiptClosingPreviewForApply(preview));
    const coverage = coverageFor(
      preview,
      eventsFrom([receivable], new Map([[93001, [{ id: 3, date: "2026-10-10", amount: 4000 }]]]))
    );
    assert.deepEqual(coverage.map((row) => [row.salesOrderId, row.coveredCommissionAmount]), [
      ["so-g", 90],
      ["so-r", 0],
    ]);
  });

  it("snapshot substituído nunca compete com o vigente (regressão PD 02697)", () => {
    const world = buildWorld({
      orders: [TWO_SELLERS.orders[0]!],
      nfes: TWO_SELLERS.nfes,
      links: [{ orderId: "so-g", nfeId: 9300 }],
    });
    const vigent = world.schedulesByReceivable.get(93001)![0]!;
    world.schedulesByReceivable.set(93001, [
      { ...vigent, id: "sch-old", orderSnapshotId: "snap-old", orderSnapshotStatus: "SUPERSEDED", scheduledCommissionAmount: 0 },
      vigent,
    ]);
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 93001, [{ id: 4, date: "2026-10-10", amount: 4000 }])], {
        year: 2026,
        month: 10,
      })
    );
    const lines = linesOf(preview, 93001);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.commissionReceivableScheduleId, vigent.id);
    assert.equal(lines[0]!.releasedCommissionAmount, 90);
  });
});

/* ------------------------------------------------------------------ */
/*  Testes negativos: vínculo contraditório, duplicidade, pendência    */
/* ------------------------------------------------------------------ */

function assertApplyBlocked(preview: CommissionReceiptPreviewResult) {
  assert.equal(assessReceiptClosingApplyReadiness(preview).canApply, false);
  assert.throws(
    () => validateReceiptClosingPreviewForApply(preview),
    (error: unknown) => error instanceof ReceiptClosingValidationError
  );
}

describe("N:N — recusas (vínculo contraditório, schedule duplicado, direito pendente)", () => {
  it("pedido vinculado sem schedule ao lado de pedido com schedule: exceção do pedido e aplicação bloqueada", () => {
    const world = buildWorld({
      ...TWO_SELLERS,
      links: [
        { orderId: "so-g", nfeId: 9300 },
        { orderId: "so-r", nfeId: 9300, withSchedule: false },
      ],
    });
    const receivable = receivedTitle(world, 93001, [{ id: 5, date: "2026-10-10", amount: 4000 }]);
    const preview = buildCommissionReceiptPreview(previewContext(world, [receivable], { year: 2026, month: 10 }));
    const lines = linesOf(preview, 93001);
    assert.deepEqual(
      lines.map((line) => [line.orderCode, line.status, line.canonicalSellerId]),
      [
        ["03001", "COMMISSIONABLE", SELLER_464.personId],
        ["03002", "NO_SCHEDULE", SELLER_470.personId],
      ]
    );
    assertApplyBlocked(preview);
    // Mesmo que o fechamento fosse aplicado, só o direito final seria coberto:
    // o pedido sem schedule nunca é consumido junto (B4).
    const coverage = coverageFor(
      preview,
      eventsFrom([receivable], new Map([[93001, [{ id: 5, date: "2026-10-10", amount: 4000 }]]]))
    );
    assert.deepEqual(coverage.map((row) => row.salesOrderId), ["so-g"]);
  });

  it("NF-e com N pedidos e nenhum schedule: uma exceção por pedido, com vendedor, e nunca NO_SALES_LINK", () => {
    const world = buildWorld({
      ...TWO_SELLERS,
      links: TWO_SELLERS.links.map((link) => ({ ...link, withSchedule: false })),
    });
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 93001, [{ id: 6, date: "2026-10-10", amount: 4000 }])], {
        year: 2026,
        month: 10,
      })
    );
    const lines = linesOf(preview, 93001);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => line.status === "NO_SCHEDULE"));
    assert.deepEqual(lines.map((line) => line.canonicalSellerId), [SELLER_464.personId, SELLER_470.personId]);
    assert.equal(new Set(lines.map((line) => line.ledgerLineKey)).size, 2);
    assertApplyBlocked(preview);
  });

  it("schedule de pedido não vinculado à NF-e do título não comissiona (origem fiscal não comprovada)", () => {
    const world = buildWorld({
      orders: [TWO_SELLERS.orders[0]!],
      nfes: TWO_SELLERS.nfes,
      links: [{ orderId: "so-g", nfeId: 9300 }],
    });
    const foreign = { ...world.schedulesByReceivable.get(93001)![0]!, id: "sch-foreign", salesOrderId: "so-foreign", orderCode: "09999", orderSnapshotId: "snap-foreign" };
    world.schedulesByReceivable.set(93001, [foreign, ...world.schedulesByReceivable.get(93001)!]);
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 93001, [{ id: 7, date: "2026-10-10", amount: 4000 }])], {
        year: 2026,
        month: 10,
      })
    );
    const foreignLine = linesOf(preview, 93001).find((line) => line.orderCode === "09999");
    assert.ok(foreignLine, "o schedule contraditório aparece como exceção auditável");
    assert.notEqual(foreignLine!.status, "COMMISSIONABLE");
    assert.equal(foreignLine!.releasedCommissionAmount, 0);
    assertApplyBlocked(preview);
  });

  it("schedule com NF-e diferente da NF-e do título não comissiona", () => {
    const world = buildWorld({
      orders: [TWO_SELLERS.orders[0]!],
      nfes: TWO_SELLERS.nfes,
      links: [{ orderId: "so-g", nfeId: 9300 }],
    });
    const [schedule] = world.schedulesByReceivable.get(93001)!;
    world.schedulesByReceivable.set(93001, [{ ...schedule!, nfeId: 9999 }]);
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 93001, [{ id: 8, date: "2026-10-10", amount: 4000 }])], {
        year: 2026,
        month: 10,
      })
    );
    assert.notEqual(linesOf(preview, 93001)[0]!.status, "COMMISSIONABLE");
    assertApplyBlocked(preview);
  });

  it("dois schedules vigentes do mesmo pedido no mesmo título: duplicidade recusada", () => {
    const world = buildWorld({
      orders: [TWO_SELLERS.orders[0]!],
      nfes: TWO_SELLERS.nfes,
      links: [{ orderId: "so-g", nfeId: 9300 }],
    });
    const [schedule] = world.schedulesByReceivable.get(93001)!;
    world.schedulesByReceivable.set(93001, [
      schedule!,
      { ...schedule!, id: "sch-dup", orderSnapshotId: "snap-dup" },
    ]);
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 93001, [{ id: 9, date: "2026-10-10", amount: 4000 }])], {
        year: 2026,
        month: 10,
      })
    );
    const lines = linesOf(preview, 93001);
    assert.ok(lines.every((line) => line.status !== "COMMISSIONABLE"));
    assert.equal(preview.totalReleasedCommission, 0);
    assertApplyBlocked(preview);
  });

  it("status misto entre pedidos do mesmo recebimento: cobre o direito final e mantém o pendente (B4)", () => {
    const world = buildWorld({
      ...TWO_SELLERS,
      orders: [TWO_SELLERS.orders[0]!, { ...TWO_SELLERS.orders[1]!, commission: 0, itemStatuses: ["NO_RULE"] }],
    });
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 93001, [{ id: 10, date: "2026-10-10", amount: 4000 }])], {
        year: 2026,
        month: 10,
      })
    );
    assert.deepEqual(
      linesOf(preview, 93001).map((line) => line.status),
      ["COMMISSIONABLE", "NO_RULE"]
    );
    assert.equal(assessReceiptClosingApplyReadiness(preview).canApply, true);
    const coverage = coverageFor(
      preview,
      eventsFrom(preview.lines.length ? [receivedTitle(world, 93001, [{ id: 10, date: "2026-10-10", amount: 4000 }])] : [], new Map([[93001, [{ id: 10, date: "2026-10-10", amount: 4000 }]]]))
    );
    assert.deepEqual(coverage.map((row) => [row.salesOrderId, row.coveredCommissionAmount]), [["so-g", 90]]);
  });

  it("pendência de período anterior com pedido pendente não é incluível", () => {
    const world = buildWorld({
      ...TWO_SELLERS,
      links: [
        { orderId: "so-g", nfeId: 9300 },
        { orderId: "so-r", nfeId: 9300, withSchedule: false },
      ],
    });
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivedTitle(world, 93001, [{ id: 11, date: "2026-10-10", amount: 4000 }])], {
        year: 2026,
        month: 10,
      })
    );
    const rows = buildCarryoverRows({
      candidates: [
        {
          receiptExternalId: 11,
          receivableExternalId: 93001,
          receiptDate: "2026-10-10",
          receivedAmount: 4000,
          syncedAt: null,
          state: "POST_CUTOVER_PENDING",
        },
      ],
      linesByNaturalMonth: new Map([["2026-10", preview.lines]]),
      naturalMonthClosings: new Map(),
      missingLegacyImports: () => [],
      selectedReceiptIds: new Set([11]),
      statusLabel: (status) => status,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.includable, false);
    assert.match(rows[0]!.blockedReason ?? "", /03002/);
  });

  it("detecta recebido realmente duplicado (mesmo pedido em duas linhas do mesmo título)", () => {
    const { preview } = incidentPreview();
    const [line] = linesOf(preview, 19809);
    const duplicated = [line!, { ...line!, ledgerLineKey: `${line!.ledgerLineKey}-copy` }];
    assert.equal(detectDuplicateReceived(duplicated).length, 1);
  });
});

/* ------------------------------------------------------------------ */
/*  R1: um pedido em várias NF-e                                       */
/* ------------------------------------------------------------------ */

describe("R1 — pedido faturado em várias NF-e não libera comissão integral em cada uma", () => {
  for (const nfeCount of [1, 3, 10]) {
    it(`pedido em ${nfeCount} NF-e: liberado ≤ comissão do pedido`, () => {
      const spec = splitOrderScenario(nfeCount);
      const world = buildWorld(spec);
      const receivables = spec.nfes.map((nfe, index) =>
        receivedTitle(world, nfe.titles[0]!.id, [{ id: 50 + index, date: "2026-10-12", amount: nfe.titles[0]!.nominal }])
      );
      const preview = buildCommissionReceiptPreview(previewContext(world, receivables, { year: 2026, month: 10 }));
      assert.ok(preview.totalReleasedCommission <= 100, `liberado ${preview.totalReleasedCommission} > 100`);
      if (nfeCount === 1) {
        assert.equal(preview.totalReleasedCommission, 100);
        assert.equal(preview.lines[0]!.status, "COMMISSIONABLE");
      } else {
        // Sem alocação por item × NF-e (B5) não há lastro para dividir: retido como
        // exceção auditável, pendente (não coberto), nunca liberado em dobro.
        assert.ok(preview.lines.every((line) => line.status !== "COMMISSIONABLE"));
        assert.ok(preview.lines.every((line) => line.releasedCommissionAmount === 0));
        const events = new Map(
          receivables.map((receivable, index) => [
            50 + index,
            { receivableExternalId: receivable.nomusReceivableId, receiptDate: "2026-10-12", receivedAmount: receivable.amountReceivable },
          ])
        );
        assert.deepEqual(coverageFor(preview, events), []);
      }
    });
  }

  it("N:N cruzado (NF1: A,B,C; NF2: A,D,E; NF3: A,C): A e C retidos, B/D/E liberados, aplicação bloqueada", () => {
    const orders: OrderSpec[] = ["A", "B", "C", "D", "E"].map((code, index) => ({
      id: `so-${code}`,
      code: `05${code}`,
      nomusOrderId: 5000 + index,
      seller: index % 2 === 0 ? SELLER_464 : SELLER_470,
      commission: 10 * (index + 1),
      sold: 1000 * (index + 1),
    }));
    const spec: ScenarioSpec = {
      orders,
      nfes: [
        { id: 9501, number: "9501", titles: [{ id: 95011, nominal: 3000, due: "2026-10-05" }] },
        { id: 9502, number: "9502", titles: [{ id: 95021, nominal: 5000, due: "2026-10-05" }] },
        { id: 9503, number: "9503", titles: [{ id: 95031, nominal: 2000, due: "2026-10-05" }] },
      ],
      links: [
        { orderId: "so-A", nfeId: 9501 },
        { orderId: "so-B", nfeId: 9501 },
        { orderId: "so-C", nfeId: 9501 },
        { orderId: "so-A", nfeId: 9502 },
        { orderId: "so-D", nfeId: 9502 },
        { orderId: "so-E", nfeId: 9502 },
        { orderId: "so-A", nfeId: 9503 },
        { orderId: "so-C", nfeId: 9503 },
      ],
    };
    const world = buildWorld(spec);
    const receivables = [95011, 95021, 95031].map((id, index) =>
      receivedTitle(world, id, [{ id: 60 + index, date: "2026-10-12", amount: world.titles.get(id)!.title.nominal }])
    );
    const preview = buildCommissionReceiptPreview(previewContext(world, receivables, { year: 2026, month: 10 }));
    const byOrder = (code: string) => preview.lines.filter((line) => line.orderCode === code);
    for (const held of ["05A", "05C"]) {
      assert.ok(byOrder(held).length > 0);
      assert.ok(byOrder(held).every((line) => line.status !== "COMMISSIONABLE" && line.releasedCommissionAmount === 0));
    }
    for (const released of ["05B", "05D", "05E"]) {
      assert.ok(byOrder(released).every((line) => line.status === "COMMISSIONABLE"));
    }
    const expected = sum(
      ["05B", "05D", "05E"].flatMap((code) =>
        [...world.schedulesByReceivable.values()].flat().filter((row) => row.orderCode === code).map((row) => row.scheduledCommissionAmount)
      )
    );
    assert.equal(preview.totalReleasedCommission, expected);
    assert.equal(preview.totalReceivedAmount, 10000);
    // B4: os pedidos liberados são cobertos; os retidos (R1) seguem pendentes.
    assert.equal(assessReceiptClosingApplyReadiness(preview).canApply, true);
    const events = new Map(
      receivables.map((receivable, index) => [
        60 + index,
        { receivableExternalId: receivable.nomusReceivableId, receiptDate: "2026-10-12", receivedAmount: receivable.amountReceivable },
      ])
    );
    const covered = coverageFor(preview, events);
    assert.deepEqual([...new Set(covered.map((row) => row.salesOrderId))].sort(), ["so-B", "so-D", "so-E"]);
    assert.equal(sum(covered.map((row) => row.coveredCommissionAmount)), expected);
  });
  // B4 e B5 de ponta a ponta: commissionNnCoverageAllocation.test.ts e a integração com PostgreSQL.
});

/* ------------------------------------------------------------------ */
/*  Previsão (B2) e materialização dirigida por título (B3)            */
/* ------------------------------------------------------------------ */

function outlookFact(partial: Partial<OutlookScheduleInput> & Pick<OutlookScheduleInput, "scheduleId" | "salesOrderId" | "orderCode" | "allocatedCommission">): OutlookScheduleInput {
  return {
    scheduleStatus: "ACTIVE",
    orderSnapshotStatus: "ACTIVE",
    scheduleCreatedAt: "2026-10-01T00:00:00.000Z",
    customerId: "cust-1",
    customerName: CUSTOMER_NAME,
    canonicalSellerId: SELLER_464.personId,
    canonicalSellerName: SELLER_464.name,
    rawSellerId: SELLER_464.nomusId,
    sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
    nfeNumber: "7862",
    receivableId: 19810,
    receivableCode: "7862",
    installmentNumber: 2,
    dueDate: "2026-11-02",
    nominalAmount: 4435.5,
    sharePercent: 33,
    balanceReceivable: 4435.5,
    amountReceivedOnTitle: 0,
    paidToSellerAmount: 0,
    receipts: [],
    ...partial,
  };
}

describe("N:N — Previsão e materialização", () => {
  it("Previsão: dois pedidos no mesmo título contam os dois (sem anular o segundo)", () => {
    const lines = projectCommissionPortfolioOutlookLines(
      [
        outlookFact({ scheduleId: "s-a", salesOrderId: "so-2934", orderCode: "02933", allocatedCommission: 30.11 }),
        outlookFact({ scheduleId: "s-b", salesOrderId: "so-2998", orderCode: "02997", allocatedCommission: 106.78 }),
      ],
      "2026-10-22"
    );
    assert.deepEqual(
      lines.map((line) => [line.orderCode, line.forecastCommission, line.inconsistency]),
      [
        ["02933", 30.11, null],
        ["02997", 106.78, null],
      ]
    );
  });

  it("Previsão: dois schedules vigentes do MESMO pedido no título continuam anulando o duplicado", () => {
    const lines = projectCommissionPortfolioOutlookLines(
      [
        outlookFact({ scheduleId: "s-a", salesOrderId: "so-2934", orderCode: "02933", allocatedCommission: 30.11 }),
        outlookFact({ scheduleId: "s-a2", salesOrderId: "so-2934", orderCode: "02933", allocatedCommission: 30.11, scheduleCreatedAt: "2026-09-01T00:00:00.000Z" }),
      ],
      "2026-10-22"
    );
    assert.equal(lines.filter((line) => line.inconsistency != null).length, 1);
    assert.equal(sum(lines.map((line) => line.forecastCommission)), 30.11);
  });

  it("Visão 360°: o título de dois pedidos soma os dois direitos e mantém o vendedor único", () => {
    const outlookLines = projectCommissionPortfolioOutlookLines(
      [
        outlookFact({ scheduleId: "s-a", salesOrderId: "so-2934", orderCode: "02933", allocatedCommission: 30.11 }),
        outlookFact({ scheduleId: "s-b", salesOrderId: "so-2998", orderCode: "02997", allocatedCommission: 106.78 }),
      ],
      "2026-10-22"
    );
    const row = classifyCommission360Receivable({
      receivableId: 19810,
      invoiceNumber: "7862",
      sourceInvoiceId: 8204,
      dueDate: "2026-11-02",
      customerName: CUSTOMER_NAME,
      nominalAmount: 4435.5,
      openBalance: 4435.5,
      suspended: false,
      groupCompany: false,
      orderLinks: [
        { salesOrderId: "so-2934", orderCode: "02933", status: "CONFIRMED", externalSellerId: 464 },
        { salesOrderId: "so-2998", orderCode: "02997", status: "CONFIRMED", externalSellerId: 464 },
      ],
      snapshots: [],
      nfeReceivables: [],
      outlookLines,
    });
    assert.equal(row.allocatedCommission, 136.89);
    assert.equal(row.forecastCommission, 136.89);
    assert.equal(row.orderCode, "02933, 02997");
    assert.equal(row.sellerName, SELLER_464.name);
    assert.equal(row.status, "COBERTO_FUTURA");
  });

  it("materialização dirigida por título materializa todos os pedidos vinculados à NF-e", async () => {
    const calls: Array<{ salesOrderId: string; nfeId: number | null | undefined }> = [];
    const scheduled = new Set<string>();
    const db = {
      commissionReceivableSchedule: {
        findMany: async () => [],
        findFirst: async () => (scheduled.size > 0 ? { id: "sch-any" } : null),
      },
      salesOrderNfeLink: {
        findMany: async () => [
          { salesOrderId: "so-2934", nfeExternalId: 8204, orderCode: "02933" },
          { salesOrderId: "so-2998", nfeExternalId: 8204, orderCode: "02997" },
        ],
      },
    };
    const deps = {
      materialize: async (_db: unknown, input: { salesOrderId: string; nfeId?: number | null }) => {
        calls.push({ salesOrderId: input.salesOrderId, nfeId: input.nfeId });
        return { action: "created", snapshotId: `snap-${input.salesOrderId}`, previousSnapshotId: null, sourceHash: "h", dryRun: false, preview: { nfeId: 8204 } };
      },
      rebuildSchedule: async (_db: unknown, input: { salesOrderId?: string }) => {
        scheduled.add(input.salesOrderId ?? "");
        return { action: "created", orderSnapshotId: "snap", schedulesCreated: 3, schedulesSuperseded: 0, schedulesStaled: 0, schedulesUnchanged: 0, dryRun: false, preview: [] };
      },
    } as unknown as MaterializationOrchestratorDeps;
    const result = await ensureCommissionMaterializationForReceivableRefs(
      db as never,
      [{ receivableId: 19809, sourceInvoiceId: 8204 }],
      { apply: true, deps }
    );
    assert.deepEqual(
      calls.map((call) => call.salesOrderId).sort(),
      ["so-2934", "so-2998"]
    );
    assert.ok(calls.every((call) => call.nfeId === 8204));
    assert.equal(result.unlinkedReceivables, 0);
    assert.equal(result.schedulesEnsured, 1);
  });

  it("materialização dirigida por título pula só o pedido que já tem schedule vigente", async () => {
    const calls: string[] = [];
    const db = {
      commissionReceivableSchedule: {
        findMany: async () => [
          {
            receivableId: 19809,
            salesOrderId: "so-2934",
            scheduledCommissionAmount: 30.11,
            orderSnapshot: { totalFinalCommissionAmount: 91.24, status: "ACTIVE" },
          },
        ],
        findFirst: async () => ({ id: "sch-any" }),
      },
      salesOrderNfeLink: {
        findMany: async () => [
          { salesOrderId: "so-2934", nfeExternalId: 8204, orderCode: "02933" },
          { salesOrderId: "so-2998", nfeExternalId: 8204, orderCode: "02997" },
        ],
      },
    };
    const deps = {
      materialize: async (_db: unknown, input: { salesOrderId: string }) => {
        calls.push(input.salesOrderId);
        return { action: "created", snapshotId: "s", previousSnapshotId: null, sourceHash: "h", dryRun: false, preview: { nfeId: 8204 } };
      },
      rebuildSchedule: async () => ({ action: "created", orderSnapshotId: "snap", schedulesCreated: 3, schedulesSuperseded: 0, schedulesStaled: 0, schedulesUnchanged: 0, dryRun: false, preview: [] }),
    } as unknown as MaterializationOrchestratorDeps;
    await ensureCommissionMaterializationForReceivableRefs(db as never, [{ receivableId: 19809, sourceInvoiceId: 8204 }], {
      apply: true,
      deps,
    });
    assert.deepEqual(calls, ["so-2998"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Aplicação do fechamento (banco falso, caminho real)                */
/* ------------------------------------------------------------------ */

describe("N:N — aplicação do fechamento (validação, ledger e cobertura)", () => {
  it("incidente: fecha com duas linhas de ledger e cobertura por direito somando R$ 136,89; segundo fechamento recusado", async () => {
    const world = buildWorld(INCIDENT);
    const receivable = receivedTitle(world, 19809, [INCIDENT_RECEIPT]);
    const context = previewContext(world, [receivable], { year: 2026, month: 10 });
    const store = createClosingDb();
    const deps = closingDeps(context, eventsFrom([receivable], new Map([[19809, [INCIDENT_RECEIPT]]])));
    const result = await applyCommissionReceiptClosing(store.db as never, { year: 2026, month: 10, userId: "tester" }, deps);
    assert.equal(result.lineCount, 2);
    assert.equal(store.ledger.length, 2);
    assert.deepEqual(store.ledger.map((row) => row.orderCode).sort(), ["02933", "02997"]);
    assert.equal(sum(store.ledger.map((row) => Number(row.releasedCommissionAmount))), 136.89);
    assert.deepEqual(store.ledger.map((row) => row.salesOrderId).sort(), ["so-2934", "so-2998"]);
    assert.deepEqual(
      store.coverage.map((row) => [row.receiptExternalId, row.salesOrderId, Number(row.coveredCommissionAmount)]),
      [
        [12130, "so-2934", 30.11],
        [12130, "so-2998", 106.78],
      ]
    );
    assert.equal(sum(store.coverage.map((row) => Number(row.coveredReceivedAmount))), 4435.5);
    assert.equal(Number(store.closings[0]!.totalReceivedAmount), 4435.5);

    const ledgerBefore = JSON.stringify(store.ledger);
    await assert.rejects(
      applyCommissionReceiptClosing(store.db as never, { year: 2026, month: 10, userId: "tester" }, deps),
      (error: unknown) => error instanceof ReceiptClosingDuplicateError
    );
    assert.equal(JSON.stringify(store.ledger), ledgerBefore, "fechamento encerrado não é alterado");
  });

  it("direito pendente no mesmo recebimento: aplicação recusada e nada é gravado", async () => {
    const world = buildWorld({
      ...TWO_SELLERS,
      links: [
        { orderId: "so-g", nfeId: 9300 },
        { orderId: "so-r", nfeId: 9300, withSchedule: false },
      ],
    });
    const receipt: ReceiptSpec = { id: 70, date: "2026-10-10", amount: 4000 };
    const receivable = receivedTitle(world, 93001, [receipt]);
    const store = createClosingDb();
    await assert.rejects(
      applyCommissionReceiptClosing(
        store.db as never,
        { year: 2026, month: 10, userId: "tester" },
        closingDeps(previewContext(world, [receivable], { year: 2026, month: 10 }), eventsFrom([receivable], new Map([[93001, [receipt]]])))
      ),
      (error: unknown) => error instanceof ReceiptClosingValidationError
    );
    assert.equal(store.closings.length, 0);
    assert.equal(store.ledger.length, 0);
    assert.equal(store.coverage.length, 0);
  });

  it("R1 retido: o fechamento aplica, mas o recebimento do pedido dividido fica pendente (sem cobertura)", async () => {
    const spec = splitOrderScenario(2);
    const world = buildWorld(spec);
    const receipts = spec.nfes.map((nfe, index) => ({ id: 80 + index, date: "2026-10-12", amount: nfe.titles[0]!.nominal }));
    const receivables = spec.nfes.map((nfe, index) => receivedTitle(world, nfe.titles[0]!.id, [receipts[index]!]));
    const store = createClosingDb();
    await applyCommissionReceiptClosing(
      store.db as never,
      { year: 2026, month: 10, userId: "tester" },
      closingDeps(
        previewContext(world, receivables, { year: 2026, month: 10 }),
        eventsFrom(receivables, new Map(receivables.map((row, index) => [row.nomusReceivableId, [receipts[index]!]])))
      )
    );
    assert.equal(sum(store.ledger.map((row) => Number(row.releasedCommissionAmount))), 0);
    assert.equal(store.coverage.length, 0);
  });
});
