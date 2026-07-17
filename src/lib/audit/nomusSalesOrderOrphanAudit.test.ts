import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyDirectedConfirmation,
  compareLocalAndNomusSalesOrders,
  ORPHAN_AUDIT_READ_ONLY,
  summarizeOrphanAudit,
  type LocalSalesOrderIdentity,
} from "./nomusSalesOrderOrphanAudit.js";
import type {
  NomusPedidoIdentity,
  NomusPedidosFetchCompleteness,
} from "@/src/lib/nomusSalesOrdersClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function completeFetch(
  overrides: Partial<NomusPedidosFetchCompleteness> = {}
): NomusPedidosFetchCompleteness {
  return {
    complete: true,
    status: "COMPLETE",
    strategy: "period-full-reconciliation",
    periodFrom: "01/07/2026",
    periodTo: "31/07/2026",
    startPage: 1,
    lastPageFetched: 1,
    pageSize: 500,
    totalRead: 1,
    stoppedBecauseEmpty: true,
    stoppedBecauseNoNext: false,
    stoppedBecauseMaxPages: false,
    stoppedBecauseDate: false,
    http429Count: 0,
    retries: 0,
    errors: [],
    stopReason: "empty_page",
    ...overrides,
  };
}

function incompleteFetch(
  overrides: Partial<NomusPedidosFetchCompleteness> = {}
): NomusPedidosFetchCompleteness {
  return completeFetch({
    complete: false,
    status: "INCONCLUSIVE_FETCH",
    stoppedBecauseEmpty: false,
    stoppedBecauseMaxPages: true,
    stopReason: "max_pages",
    ...overrides,
  });
}

function local(
  partial: Partial<LocalSalesOrderIdentity> &
    Pick<LocalSalesOrderIdentity, "id" | "orderCode" | "externalSalesOrderId">
): LocalSalesOrderIdentity {
  return {
    externalSalesOrderCode: partial.orderCode,
    issueDateIso: "2026-07-10",
    status: "CONFIRMED",
    totalNetValue: 117000,
    customerName: "Cliente X",
    sellerName: "Vendedor Y",
    itemCount: 2,
    ...partial,
  };
}

function nomus(
  partial: Partial<NomusPedidoIdentity> &
    Pick<NomusPedidoIdentity, "externalSalesOrderId" | "orderCode" | "orderCodeKey">
): NomusPedidoIdentity {
  return {
    issueDateIso: "2026-07-10",
    raw: {},
    ...partial,
  };
}

describe("nomusSalesOrderOrphanAudit", () => {
  it("1. PD 02739 local e ausente no Nomus → CONFIRMED_MISSING_IN_NOMUS", () => {
    const rows = compareLocalAndNomusSalesOrders({
      local: [
        local({
          id: "so-2737",
          orderCode: "PD 02739",
          externalSalesOrderId: 2737,
          totalNetValue: 117000,
        }),
      ],
      nomus: [],
      completeness: completeFetch({ totalRead: 0 }),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.classification, "LOCAL_ONLY_CANDIDATE");
    const confirmed = applyDirectedConfirmation(rows[0]!, { status: "not_found" });
    assert.equal(confirmed.classification, "CONFIRMED_MISSING_IN_NOMUS");
    assert.equal(confirmed.absenceObserved, true);
    assert.ok(confirmed.notes.some((n) => /ausente na origem/i.test(n)));
    assert.ok(!confirmed.notes.some((n) => /excluíd/i.test(n)));
  });

  it("2. Pedido presente nos dois universos → MATCHED", () => {
    const rows = compareLocalAndNomusSalesOrders({
      local: [local({ id: "a", orderCode: "PD 02000", externalSalesOrderId: 2000 })],
      nomus: [
        nomus({
          externalSalesOrderId: 2000,
          orderCode: "PD 02000",
          orderCodeKey: "PD:2000",
        }),
      ],
      completeness: completeFetch(),
    });
    assert.equal(rows[0]!.classification, "MATCHED");
  });

  it("3. Pedido apenas no Nomus → NOMUS_ONLY", () => {
    const rows = compareLocalAndNomusSalesOrders({
      local: [],
      nomus: [
        nomus({
          externalSalesOrderId: 9999,
          orderCode: "PD 09999",
          orderCodeKey: "PD:9999",
        }),
      ],
      completeness: completeFetch(),
    });
    assert.equal(rows[0]!.classification, "NOMUS_ONLY");
  });

  it("4. Mesmo código com ID diferente → IDENTITY_MISMATCH", () => {
    const rows = compareLocalAndNomusSalesOrders({
      local: [local({ id: "a", orderCode: "PD 02739", externalSalesOrderId: 2737 })],
      nomus: [
        nomus({
          externalSalesOrderId: 9999,
          orderCode: "PD 02739",
          orderCodeKey: "PD:2739",
        }),
      ],
      completeness: completeFetch(),
    });
    assert.equal(rows[0]!.classification, "IDENTITY_MISMATCH");
  });

  it("5. Coleta interrompida → INCONCLUSIVE_FETCH sem órfão confirmado", () => {
    const rows = compareLocalAndNomusSalesOrders({
      local: [local({ id: "so-2737", orderCode: "PD 02739", externalSalesOrderId: 2737 })],
      nomus: [],
      completeness: incompleteFetch({
        stopReason: "interrupted",
        stoppedBecauseMaxPages: false,
        errors: ["interrupted"],
      }),
    });
    assert.equal(rows[0]!.classification, "INCONCLUSIVE_FETCH");
    const summary = summarizeOrphanAudit({
      rows,
      completeness: incompleteFetch(),
      durationMs: 10,
    });
    assert.equal(summary.confirmedMissingCount, 0);
    assert.equal(summary.localOnlyCandidateCount, 0);
  });

  it("6. Limite máximo de páginas → coleta inconclusiva", () => {
    const completeness = incompleteFetch({ stopReason: "max_pages" });
    const rows = compareLocalAndNomusSalesOrders({
      local: [local({ id: "a", orderCode: "PD 1", externalSalesOrderId: 1 })],
      nomus: [],
      completeness,
    });
    assert.equal(rows[0]!.classification, "INCONCLUSIVE_FETCH");
    assert.equal(completeness.status, "INCONCLUSIVE_FETCH");
  });

  it("consulta direcionada inconclusiva → CANDIDATE_MISSING_IN_NOMUS", () => {
    const candidate = compareLocalAndNomusSalesOrders({
      local: [local({ id: "so-2737", orderCode: "PD 02739", externalSalesOrderId: 2737 })],
      nomus: [],
      completeness: completeFetch({ totalRead: 0 }),
    })[0]!;
    const out = applyDirectedConfirmation(candidate, {
      status: "inconclusive",
      reason: "Limite de páginas",
    });
    assert.equal(out.classification, "CANDIDATE_MISSING_IN_NOMUS");
  });

  it("10. Auditoria read-only — proíbe create/update/upsert/delete no módulo puro", () => {
    assert.equal(ORPHAN_AUDIT_READ_ONLY, true);
    const src = readFileSync(join(__dirname, "nomusSalesOrderOrphanAudit.ts"), "utf8");
    assert.doesNotMatch(src, /\.(create|update|upsert|delete)\s*\(/);
    assert.doesNotMatch(src, /prisma\./i);
  });

  it("11. Reexecução — mesma entrada produz mesmo resultado", () => {
    const input = {
      local: [
        local({ id: "so-2737", orderCode: "PD 02739", externalSalesOrderId: 2737 }),
        local({ id: "so-2000", orderCode: "PD 02000", externalSalesOrderId: 2000 }),
      ],
      nomus: [
        nomus({
          externalSalesOrderId: 2000,
          orderCode: "PD 02000",
          orderCodeKey: "PD:2000",
        }),
      ],
      completeness: completeFetch({ totalRead: 1 }),
    };
    const a = JSON.stringify(compareLocalAndNomusSalesOrders(input));
    const b = JSON.stringify(compareLocalAndNomusSalesOrders(input));
    assert.equal(a, b);
  });

  it("summary conta confirmed missing value de PD 02739", () => {
    const rows = compareLocalAndNomusSalesOrders({
      local: [
        local({
          id: "so-2737",
          orderCode: "PD 02739",
          externalSalesOrderId: 2737,
          totalNetValue: 117000,
        }),
      ],
      nomus: [],
      completeness: completeFetch({ totalRead: 0 }),
    }).map((r) => applyDirectedConfirmation(r, { status: "not_found" }));
    const summary = summarizeOrphanAudit({
      rows,
      completeness: completeFetch({ totalRead: 0 }),
      durationMs: 42,
    });
    assert.equal(summary.confirmedMissingCount, 1);
    assert.equal(summary.totalValueConfirmedMissing, 117000);
    assert.equal(summary.durationMs, 42);
  });
});
