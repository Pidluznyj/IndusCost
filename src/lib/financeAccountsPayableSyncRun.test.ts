import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFinanceApSyncDurationMs,
  interpretFinanceApSyncRunResponse,
} from "./financeAccountsPayableSyncRun.js";

describe("financeAccountsPayableSyncRun", () => {
  it("trata 409 como conflito em andamento", () => {
    const result = interpretFinanceApSyncRunResponse(409, {
      message: "Já existe uma execução em andamento.",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.conflict, true);
      assert.match(result.message, /andamento/i);
    }
  });

  it("trata 202 como sucesso", () => {
    const result = interpretFinanceApSyncRunResponse(202, {
      message: "Iniciado.",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.message, "Iniciado.");
  });

  it("formata duração sem NaN", () => {
    assert.equal(formatFinanceApSyncDurationMs(null), "—");
    assert.equal(formatFinanceApSyncDurationMs(125000), "2m 5s");
    assert.equal(formatFinanceApSyncDurationMs(Number.NaN), "—");
  });
});
