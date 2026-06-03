import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HISTORICAL_NOMUS_STAGE_NOTE,
  splitParentStageRowsByEffectiveSnapshot,
} from "./nomusRegistryStageSnapshotView";
import type { StageSnapshotRow } from "./nomusBomComponentStageSnapshot";

type Row = StageSnapshotRow & {
  externalLineId: number;
  componentCode: string;
  componentDescription: string | null;
  qtdeNecessaria: number | null;
};

function row(
  id: number,
  componentCode: string,
  runId: string,
  syncedAt: string,
  qty: number
): Row {
  return {
    externalLineId: id,
    componentCode,
    componentDescription: "Mola para torneira",
    qtdeNecessaria: qty,
    runId,
    syncedAt: new Date(syncedAt),
  };
}

describe("splitParentStageRowsByEffectiveSnapshot — 610.04AA / 420.01", () => {
  const meta = {
    latestRunId: "run-2026-05-22",
    maxSyncedAt: new Date("2026-05-22T05:06:17.573Z"),
  };

  it("420.01A- só em snapshot antigo → effective vazio, historical inclui", () => {
    const allRows: Row[] = [
      row(1, "309.62AA", "run-2026-05-22", "2026-05-22T05:06:17.573Z", 1),
      row(2, "309.64AA", "run-2026-05-22", "2026-05-22T05:06:17.573Z", 1),
      row(99, "420.01A-", "run-2026-05-18", "2026-05-18T23:45:19.095Z", 1),
    ];

    const { effective, historical } = splitParentStageRowsByEffectiveSnapshot(
      allRows,
      meta,
      "420.01"
    );

    assert.equal(effective.length, 0);
    assert.equal(historical.length, 1);
    assert.equal(historical[0]?.componentCode, "420.01A-");
    assert.equal(historical[0]?.syncedAt.toISOString(), "2026-05-18T23:45:19.095Z");
  });

  it("420.01A- no snapshot mais recente → effective inclui", () => {
    const allRows: Row[] = [
      row(1, "309.62AA", "run-2026-05-22", "2026-05-22T05:06:17.573Z", 1),
      row(2, "420.01A-", "run-2026-05-22", "2026-05-22T05:06:17.573Z", 1),
    ];

    const { effective, historical } = splitParentStageRowsByEffectiveSnapshot(
      allRows,
      meta,
      "420.01"
    );

    assert.equal(effective.length, 1);
    assert.equal(effective[0]?.componentCode, "420.01A-");
    assert.equal(historical.length, 0);
  });

  it("wouldNomusRecreate lógica: effective.length > 0", () => {
    const { effective } = splitParentStageRowsByEffectiveSnapshot(
      [row(2, "420.01A-", "run-2026-05-22", "2026-05-22T05:06:17.573Z", 1)],
      meta,
      "420.01"
    );
    assert.equal(effective.length > 0, true);
  });

  it("wouldNomusRecreate lógica: só histórico → false", () => {
    const { effective } = splitParentStageRowsByEffectiveSnapshot(
      [
        row(1, "309.62AA", "run-2026-05-22", "2026-05-22T05:06:17.573Z", 1),
        row(2, "309.64AA", "run-2026-05-22", "2026-05-22T05:06:17.573Z", 1),
        row(99, "420.01A-", "run-2026-05-18", "2026-05-18T23:45:19.095Z", 1),
      ],
      meta,
      "420.01"
    );
    assert.equal(effective.length > 0, false);
  });

  it("nota histórica padronizada", () => {
    assert.ok(HISTORICAL_NOMUS_STAGE_NOTE.includes("snapshot Nomus antigo"));
  });
});
