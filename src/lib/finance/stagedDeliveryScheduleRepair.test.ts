import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseStagedDeliveryRepairCli,
} from "./stagedDeliveryScheduleRepair.js";

describe("FIN-13 staged delivery repair CLI", () => {
  it("parse preview + order", () => {
    const cli = parseStagedDeliveryRepairCli([
      "preview",
      "--order=PD 02596",
      "--batch-size=10",
    ]);
    assert.equal(cli.mode, "preview");
    assert.equal(cli.orderCode, "PD 02596");
    assert.equal(cli.batchSize, 10);
    assert.equal(cli.help, false);
  });

  it("parse apply + from/to", () => {
    const cli = parseStagedDeliveryRepairCli([
      "apply",
      "--from",
      "2025-01-01",
      "--to",
      "2026-12-31",
    ]);
    assert.equal(cli.mode, "apply");
    assert.equal(cli.from, "2025-01-01");
    assert.equal(cli.to, "2026-12-31");
  });
});
