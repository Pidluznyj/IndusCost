import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTreasuryCivilDateOverdue,
  resolveAsOfCivilDateFromInstant,
  resolvePayableConfirmedDate,
  resolvePayableContractualDate,
  resolvePayableProbableDate,
  resolveReceivableConfirmedDate,
  resolveReceivableContractualDate,
  resolveReceivableProbableDate,
  resolveTreasuryMovementDate,
  toTreasuryCivilDateInSaoPaulo,
  TREASURY_MOVEMENT_DATE_TIMEZONE,
} from "./treasuryMovementDateRules.js";

describe("treasuryMovementDateRules — fuso America/Sao_Paulo", () => {
  it("expõe timezone canônico", () => {
    assert.equal(TREASURY_MOVEMENT_DATE_TIMEZONE, "America/Sao_Paulo");
  });

  it("virada de data: UTC já no dia seguinte, SP ainda no dia anterior", () => {
    // 2026-07-28 02:30 UTC = 2026-07-27 23:30 em America/Sao_Paulo (UTC−3)
    const instant = new Date("2026-07-28T02:30:00.000Z");
    assert.equal(toTreasuryCivilDateInSaoPaulo(instant), "2026-07-27");
    assert.equal(resolveAsOfCivilDateFromInstant(instant), "2026-07-27");
  });

  it("virada de data: UTC ainda no dia anterior, SP já no dia seguinte", () => {
    // 2026-07-28 01:00 UTC = 2026-07-27 22:00 SP — still 27
    assert.equal(
      toTreasuryCivilDateInSaoPaulo(new Date("2026-07-28T01:00:00.000Z")),
      "2026-07-27"
    );
    // 2026-07-28 03:00 UTC = 2026-07-28 00:00 SP — already 28
    assert.equal(
      toTreasuryCivilDateInSaoPaulo(new Date("2026-07-28T03:00:00.000Z")),
      "2026-07-28"
    );
  });

  it("asOf na virada altera overdue de recebível (não empurra para hoje)", () => {
    const due = "2026-07-27";
    const beforeMidnightSp = new Date("2026-07-28T02:59:59.000Z"); // 27/07 23:59 SP
    const afterMidnightSp = new Date("2026-07-28T03:00:00.000Z"); // 28/07 00:00 SP

    const asOfBefore = resolveAsOfCivilDateFromInstant(beforeMidnightSp);
    const asOfAfter = resolveAsOfCivilDateFromInstant(afterMidnightSp);
    assert.equal(asOfBefore, "2026-07-27");
    assert.equal(asOfAfter, "2026-07-28");

    assert.equal(isTreasuryCivilDateOverdue(due, asOfBefore), false);
    assert.equal(isTreasuryCivilDateOverdue(due, asOfAfter), true);

    const probableBefore = resolveReceivableProbableDate(
      { dueDate: due },
      asOfBefore
    );
    assert.equal(probableBefore.resolvedDate, "2026-07-27");
    assert.equal(probableBefore.includeInProjection, true);

    const probableAfter = resolveReceivableProbableDate(
      { dueDate: due },
      asOfAfter
    );
    assert.equal(probableAfter.resolvedDate, null);
    assert.equal(probableAfter.includeInProjection, false);
    assert.match(probableAfter.detail, /não entra automaticamente em hoje/);
    assert.notEqual(probableAfter.resolvedDate, asOfAfter);
  });
});

describe("treasuryMovementDateRules — recebível", () => {
  it("CONTRACTUAL usa vencimento original", () => {
    const r = resolveReceivableContractualDate({ dueDate: "2026-08-10" });
    assert.equal(r.resolvedDate, "2026-08-10");
    assert.equal(r.source, "DUE_DATE");
    assert.equal(r.reliable, true);
  });

  it("PROBABLE prioriza promessa ativa > esperada > vencimento não vencido", () => {
    const asOf = "2026-07-27";
    const withPromise = resolveReceivableProbableDate(
      {
        dueDate: "2026-08-01",
        expectedDate: "2026-07-30",
        activePromiseDate: "2026-07-29",
        activePromiseStatus: "ACTIVE",
      },
      asOf
    );
    assert.equal(withPromise.source, "ACTIVE_PROMISE");
    assert.equal(withPromise.resolvedDate, "2026-07-29");

    const withExpected = resolveReceivableProbableDate(
      {
        dueDate: "2026-08-01",
        expectedDate: "2026-07-30",
        activePromiseStatus: "CANCELLED",
        activePromiseDate: "2026-07-29",
      },
      asOf
    );
    assert.equal(withExpected.source, "EXPECTED_DATE");
    assert.equal(withExpected.resolvedDate, "2026-07-30");

    const withDue = resolveReceivableProbableDate(
      { dueDate: "2026-08-01" },
      asOf
    );
    assert.equal(withDue.source, "DUE_DATE");
    assert.equal(withDue.resolvedDate, "2026-08-01");
  });

  it("PROBABLE: vencido sem previsão não resolve para hoje", () => {
    const asOf = "2026-07-27";
    const r = resolveReceivableProbableDate(
      { dueDate: "2026-07-20" },
      asOf
    );
    assert.equal(r.resolvedDate, null);
    assert.equal(r.includeInProjection, false);
    assert.equal(r.reliable, false);
    assert.notEqual(r.resolvedDate, asOf);
  });

  it("PROBABLE: promessa parcial ainda é ativa", () => {
    const r = resolveReceivableProbableDate(
      {
        dueDate: "2026-07-01",
        activePromiseDate: "2026-07-28",
        activePromiseStatus: "PARTIALLY_FULFILLED",
      },
      "2026-07-27"
    );
    assert.equal(r.source, "ACTIVE_PROMISE");
    assert.equal(r.resolvedDate, "2026-07-28");
  });

  it("CONFIRMED exige confirmação ou realização", () => {
    const missing = resolveReceivableConfirmedDate({
      dueDate: "2026-08-01",
      expectedDate: "2026-07-30",
    });
    assert.equal(missing.includeInProjection, false);

    const confirmed = resolveReceivableConfirmedDate({
      dueDate: "2026-08-01",
      confirmedDate: "2026-07-29",
    });
    assert.equal(confirmed.source, "CONFIRMED_DATE");
    assert.equal(confirmed.resolvedDate, "2026-07-29");

    const realized = resolveReceivableConfirmedDate({
      dueDate: "2026-08-01",
      confirmedDate: "2026-07-29",
      realizedDate: "2026-07-28",
    });
    assert.equal(realized.source, "REALIZED_DATE");
    assert.equal(realized.resolvedDate, "2026-07-28");
  });
});

describe("treasuryMovementDateRules — pagável", () => {
  it("CONTRACTUAL usa vencimento original", () => {
    const r = resolvePayableContractualDate({ dueDate: "2026-09-01" });
    assert.equal(r.source, "DUE_DATE");
    assert.equal(r.resolvedDate, "2026-09-01");
  });

  it("PROBABLE: programada > esperada > vencimento", () => {
    assert.equal(
      resolvePayableProbableDate({
        dueDate: "2026-09-01",
        expectedDate: "2026-08-20",
        scheduledDate: "2026-08-15",
      }).resolvedDate,
      "2026-08-15"
    );
    assert.equal(
      resolvePayableProbableDate({
        dueDate: "2026-09-01",
        expectedDate: "2026-08-20",
      }).source,
      "EXPECTED_DATE"
    );
    assert.equal(
      resolvePayableProbableDate({ dueDate: "2026-09-01" }).source,
      "DUE_DATE"
    );
  });

  it("CONFIRMED: realizado; AUTHORIZED; PROGRAMMED; confirmação", () => {
    assert.equal(
      resolvePayableConfirmedDate({
        dueDate: "2026-09-01",
        scheduledDate: "2026-08-10",
        programmingStatus: "AUTHORIZED",
        realizedDate: "2026-08-05",
      }).source,
      "REALIZED_DATE"
    );

    assert.equal(
      resolvePayableConfirmedDate({
        dueDate: "2026-09-01",
        scheduledDate: "2026-08-10",
        programmingStatus: "AUTHORIZED",
      }).source,
      "AUTHORIZED_SCHEDULE"
    );

    assert.equal(
      resolvePayableConfirmedDate({
        dueDate: "2026-09-01",
        scheduledDate: "2026-08-12",
        programmingStatus: "PROGRAMMED",
      }).source,
      "PROGRAMMED_SCHEDULE"
    );

    assert.equal(
      resolvePayableConfirmedDate({
        dueDate: "2026-09-01",
        confirmedDate: "2026-08-11",
      }).source,
      "CONFIRMED_DATE"
    );

    const none = resolvePayableConfirmedDate({ dueDate: "2026-09-01" });
    assert.equal(none.includeInProjection, false);
    assert.equal(none.resolvedDate, null);
  });
});

describe("treasuryMovementDateRules — dispatcher e MANUAL", () => {
  it("resolveTreasuryMovementDate despacha AR/AP", () => {
    const ar = resolveTreasuryMovementDate({
      side: "AR",
      scenario: "CONTRACTUAL",
      asOfCivilDate: "2026-07-27",
      receivable: { dueDate: "2026-08-01" },
    });
    assert.equal(ar.resolvedDate, "2026-08-01");

    const ap = resolveTreasuryMovementDate({
      side: "AP",
      scenario: "PROBABLE",
      asOfCivilDate: "2026-07-27",
      payable: {
        dueDate: "2026-09-01",
        scheduledDate: "2026-08-01",
      },
    });
    assert.equal(ap.resolvedDate, "2026-08-01");
  });

  it("MANUAL exige data explícita", () => {
    const missing = resolveTreasuryMovementDate({
      side: "AR",
      scenario: "MANUAL",
      asOfCivilDate: "2026-07-27",
      receivable: { dueDate: "2026-08-01" },
    });
    assert.equal(missing.includeInProjection, false);

    const ok = resolveTreasuryMovementDate({
      side: "AP",
      scenario: "MANUAL",
      asOfCivilDate: "2026-07-27",
      payable: { dueDate: "2026-09-01", manualDate: "2026-07-30" },
    });
    assert.equal(ok.source, "MANUAL_DATE");
    assert.equal(ok.resolvedDate, "2026-07-30");
  });
});
