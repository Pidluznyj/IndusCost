/**
 * Vigência de schedule — regra oficial: só vale o schedule cujo
 * CommissionOrderSnapshot pai está ACTIVE.
 *
 * O caso de referência é o PD 02697 em produção: snapshot antigo SUPERSEDED
 * com comissão 0 e cinco schedules antigos ainda ACTIVE zerados, contra o
 * snapshot atual ACTIVE de R$ 688,96 com cinco schedules de R$ 137,79. O motor
 * escolhia o primeiro ACTIVE que encontrasse — sem olhar o pai — e fechava o
 * título como ZERO_AMOUNT/NO_MARGIN.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commissionActiveSnapshotWhere,
  isCommissionScheduleCurrent,
  isCommissionScheduleFromActiveSnapshot,
  isCommissionSnapshotActive,
  keepSchedulesFromActiveSnapshot,
} from "./commissionScheduleVigency.js";

describe("commissionScheduleVigency — isCommissionSnapshotActive", () => {
  it("só ACTIVE é vigente", () => {
    assert.equal(isCommissionSnapshotActive("ACTIVE"), true);
    assert.equal(isCommissionSnapshotActive("SUPERSEDED"), false);
    assert.equal(isCommissionSnapshotActive("STALE"), false);
    assert.equal(isCommissionSnapshotActive("ERROR"), false);
  });

  it("desconhecido não é vigente (fail-closed)", () => {
    assert.equal(isCommissionSnapshotActive(null), false);
    assert.equal(isCommissionSnapshotActive(undefined), false);
    assert.equal(isCommissionSnapshotActive(""), false);
  });
});

describe("commissionScheduleVigency — isCommissionScheduleCurrent", () => {
  it("exige as duas pontas: pai ACTIVE e schedule ACTIVE", () => {
    assert.equal(
      isCommissionScheduleCurrent({
        scheduleStatus: "ACTIVE",
        orderSnapshotStatus: "ACTIVE",
      }),
      true
    );
  });

  it("schedule ACTIVE sob snapshot SUPERSEDED NÃO é vigente — o defeito", () => {
    assert.equal(
      isCommissionScheduleCurrent({
        scheduleStatus: "ACTIVE",
        orderSnapshotStatus: "SUPERSEDED",
      }),
      false
    );
  });

  it("schedule SUPERSEDED sob snapshot ACTIVE não é fonte de cálculo", () => {
    assert.equal(
      isCommissionScheduleCurrent({
        scheduleStatus: "SUPERSEDED",
        orderSnapshotStatus: "ACTIVE",
      }),
      false
    );
  });
});

describe("commissionScheduleVigency — recorte por pai vigente", () => {
  it("preserva CUSTOMER_EXCLUDED quando o pai é o vigente", () => {
    assert.equal(
      isCommissionScheduleFromActiveSnapshot({
        scheduleStatus: "CUSTOMER_EXCLUDED",
        orderSnapshotStatus: "ACTIVE",
      }),
      true
    );
  });

  it("descarta CUSTOMER_EXCLUDED de snapshot substituído", () => {
    assert.equal(
      isCommissionScheduleFromActiveSnapshot({
        scheduleStatus: "CUSTOMER_EXCLUDED",
        orderSnapshotStatus: "SUPERSEDED",
      }),
      false
    );
  });

  it("keepSchedulesFromActiveSnapshot mantém ordem e só os vigentes", () => {
    const kept = keepSchedulesFromActiveSnapshot([
      { scheduleStatus: "ACTIVE", orderSnapshotStatus: "SUPERSEDED", tag: "velho" },
      { scheduleStatus: "ACTIVE", orderSnapshotStatus: "ACTIVE", tag: "novo" },
      { scheduleStatus: "CUSTOMER_EXCLUDED", orderSnapshotStatus: "ACTIVE", tag: "excl" },
    ]);
    assert.deepEqual(
      kept.map((r) => r.tag),
      ["novo", "excl"]
    );
  });

  it("todos de snapshot substituído → lista vazia (vira ausência, não fallback)", () => {
    const kept = keepSchedulesFromActiveSnapshot([
      { scheduleStatus: "ACTIVE", orderSnapshotStatus: "SUPERSEDED" },
      { scheduleStatus: "ACTIVE", orderSnapshotStatus: "SUPERSEDED" },
    ]);
    assert.deepEqual(kept, []);
  });
});

describe("commissionScheduleVigency — fragmento de where do Prisma", () => {
  it("exige orderSnapshot.status ACTIVE", () => {
    assert.deepEqual(commissionActiveSnapshotWhere(), {
      orderSnapshot: { status: "ACTIVE" },
    });
  });

  it("compõe com outros filtros sem sobrescrever", () => {
    const where = { receivableId: { in: [1, 2] }, ...commissionActiveSnapshotWhere() };
    assert.deepEqual(where, {
      receivableId: { in: [1, 2] },
      orderSnapshot: { status: "ACTIVE" },
    });
  });
});
