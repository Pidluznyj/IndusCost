import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendHistoryPages,
  formatHistoryReasonLabel,
  materialStockHistoryApiPath,
} from "./materialStockHistoryClient.js";
import type { MaterialStockHistoryListItem } from "./materialStockTabletTypes.js";

function row(id: string): MaterialStockHistoryListItem {
  return {
    id,
    recordedAt: "2026-07-28T12:00:00.000Z",
    userId: "u1",
    userName: "Op",
    previousQuantity: 500,
    reportedQuantity: 450,
    difference: -50,
    unit: "kg",
    reason: "CONFERENCIA_FISICA",
    notes: null,
    source: "TABLET_CONFERENCE",
  };
}

describe("materialStockHistoryClient", () => {
  it("monta path paginado e formata motivo", () => {
    const url = materialStockHistoryApiPath("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      page: 2,
      pageSize: 20,
    });
    assert.match(url, /\/api\/materials\/stock-tablet\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/history/);
    assert.match(url, /page=2/);
    assert.equal(formatHistoryReasonLabel("CONFERENCIA_FISICA"), "Conferência física");
  });

  it("append de páginas não duplica", () => {
    const merged = appendHistoryPages([row("1")], [row("1"), row("2")]);
    assert.deepEqual(
      merged.map((r) => r.id),
      ["1", "2"]
    );
  });
});
