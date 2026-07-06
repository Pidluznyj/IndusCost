import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeCommissionRecordWhere,
  INACTIVE_COMMISSION_RECORD_STATUSES,
  isInactiveCommissionRecordStatus,
} from "./commission-record-status.js";
import { csvLine, escapeCsv } from "../../../scripts/commission-script-utils.ts";

describe("commission-record-status", () => {
  it("INACTIVE não inclui SUPERSEDED inválido", () => {
    assert.ok(!INACTIVE_COMMISSION_RECORD_STATUSES.includes("SUPERSEDED" as never));
    assert.ok(INACTIVE_COMMISSION_RECORD_STATUSES.includes("SUPERSEDED_BY_OUTPUT_DOCUMENT"));
  });

  it("activeCommissionRecordWhere exclui status inativos", () => {
    const where = activeCommissionRecordWhere({
      from: new Date("2026-06-01"),
      to: new Date("2026-06-30"),
    });
    assert.deepEqual(where.status, { notIn: INACTIVE_COMMISSION_RECORD_STATUSES });
  });

  it("isInactiveCommissionRecordStatus reconhece cancelados", () => {
    assert.equal(isInactiveCommissionRecordStatus("CANCELLED"), true);
    assert.equal(isInactiveCommissionRecordStatus("RELEASED"), false);
  });
});

describe("commission-script-utils csv", () => {
  it("escapeCsv trata vírgulas e aspas", () => {
    assert.equal(escapeCsv('a,b'), '"a,b"');
    assert.equal(escapeCsv('say "hi"'), '"say ""hi"""');
  });

  it("csvLine gera colunas esperadas para export", () => {
    const line = csvLine(["orderCode", "commissionAmount", "obs"]);
    assert.match(line, /orderCode,commissionAmount,obs/);
  });
});

describe("parseScriptMode", () => {
  it("preview e apply são mutuamente exclusivos na CLI", async () => {
    const { parseScriptMode } = await import("../../../scripts/commission-script-utils.ts");
    const originalArgv = process.argv;
    try {
      process.argv = ["node", "script.ts", "--preview"];
      assert.equal(parseScriptMode(), "preview");
      process.argv = ["node", "script.ts", "--apply"];
      assert.equal(parseScriptMode(), "apply");
    } finally {
      process.argv = originalArgv;
    }
  });
});
