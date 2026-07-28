/**
 * Gate de banco de teste seguro — nunca aceita URL de produção.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTreasurySafeTestDatabaseUrl,
  cloneTreasuryTestState,
  isTreasurySafeTestDatabaseEnabled,
  resolveTreasurySafeTestDatabaseMode,
  TREASURY_TEST_DATABASE_ENV,
} from "./treasurySafeTestDatabase.js";

describe("treasurySafeTestDatabase — gate", () => {
  it("aceita localhost / 127.0.0.1 / marcador _test", () => {
    assert.equal(
      assertTreasurySafeTestDatabaseUrl(
        "postgresql://u:p@localhost:5432/induscost_treasury_test"
      ),
      "postgresql://u:p@localhost:5432/induscost_treasury_test"
    );
    assert.ok(
      assertTreasurySafeTestDatabaseUrl(
        "postgresql://u:p@127.0.0.1:5432/treasury_test"
      )
    );
  });

  it("recusa hosts de produção e URLs sem marcador seguro", () => {
    assert.throws(
      () =>
        assertTreasurySafeTestDatabaseUrl(
          "postgresql://u:p@db.prod.induscost.local/app"
        ),
      /produção/
    );
    assert.throws(
      () =>
        assertTreasurySafeTestDatabaseUrl(
          "postgresql://u:p@rds.amazonaws.com/app"
        ),
      /produção/
    );
    assert.throws(
      () =>
        assertTreasurySafeTestDatabaseUrl(
          "postgresql://u:p@some-host.example/app"
        ),
      /localhost|marcador/
    );
    assert.throws(
      () => assertTreasurySafeTestDatabaseUrl("mysql://localhost/test"),
      /postgresql/
    );
  });

  it("sem env usa in-process; com env segura marca external", () => {
    const inProcess = resolveTreasurySafeTestDatabaseMode({});
    assert.equal(inProcess.mode, "in_process");
    assert.equal(isTreasurySafeTestDatabaseEnabled({}), false);

    const external = resolveTreasurySafeTestDatabaseMode({
      [TREASURY_TEST_DATABASE_ENV]:
        "postgresql://u:p@localhost:5432/treasury_test",
    });
    assert.equal(external.mode, "external");
    if (external.mode === "external") {
      assert.match(external.url, /treasury_test/);
    }
  });

  it("clone profundo permite snapshot/rollback de estado", () => {
    const state = { rows: [{ id: "1", nested: { n: 1 } }], audits: [] as string[] };
    const snap = cloneTreasuryTestState(state);
    state.rows[0]!.nested.n = 99;
    state.audits.push("x");
    assert.equal(snap.rows[0]!.nested.n, 1);
    assert.equal(snap.audits.length, 0);
  });
});
