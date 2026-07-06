import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterStageRowsToCurrentParentSnapshot,
  type StageSnapshotRow,
} from "./nomusBomComponentStageSnapshot";

type Row = StageSnapshotRow & { componentCode: string; externalLineId: number };

function row(
  externalLineId: number,
  componentCode: string,
  runId: string | null,
  syncedAt: string
): Row {
  return {
    externalLineId,
    componentCode,
    runId,
    syncedAt: new Date(syncedAt),
  };
}

describe("filterStageRowsToCurrentParentSnapshot", () => {
  it("309.71AA: 114.02 stale (run antigo) é excluído; linhas atuais permanecem", () => {
    const rows: Row[] = [
      row(1, "115.01--", "run-2026-05-28", "2026-05-28T10:00:00.000Z"),
      row(2, "121.04--", "run-2026-05-28", "2026-05-28T10:00:00.000Z"),
      row(99, "114.02", "run-2026-01-01", "2026-01-01T08:00:00.000Z"),
    ];

    const filtered = filterStageRowsToCurrentParentSnapshot(rows, {
      latestRunId: "run-2026-05-28",
      maxSyncedAt: new Date("2026-05-28T10:00:00.000Z"),
    });

    assert.equal(filtered.length, 2);
    assert.ok(!filtered.some((r) => r.componentCode === "114.02"));
  });

  it("sem meta de snapshot mantém todas as linhas (legado)", () => {
    const rows: Row[] = [row(1, "114.02", null, "2026-01-01T08:00:00.000Z")];
    const filtered = filterStageRowsToCurrentParentSnapshot(rows, {
      latestRunId: null,
      maxSyncedAt: null,
    });
    assert.equal(filtered.length, 1);
  });

  it("fallback por maxSyncedAt quando runId diverge", () => {
    const rows: Row[] = [
      row(1, "A", "old-run", "2026-05-27T10:00:00.000Z"),
      row(2, "B", "new-run", "2026-05-28T10:00:00.000Z"),
    ];
    const filtered = filterStageRowsToCurrentParentSnapshot(rows, {
      latestRunId: "new-run",
      maxSyncedAt: new Date("2026-05-28T10:00:00.000Z"),
    });
    assert.deepEqual(
      filtered.map((r) => r.componentCode),
      ["B"]
    );
  });
});
