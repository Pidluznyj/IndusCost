import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryReceivableListItemDto } from "./contracts/treasuryReceivableContracts.js";
import {
  buildTreasuryReceivableOperationalHistory,
  buildTreasuryReceivablesListQuery,
  createEmptyTreasuryReceivablesFilters,
  resolveTreasuryReceivablesStaleState,
  resolveTreasuryReceivablesViewKind,
  treasuryReceivablesFiltersActive,
} from "./treasuryReceivablesUi.js";

const sampleRow = (): TreasuryReceivableListItemDto => ({
  titleId: "t1",
  externalId: 1,
  official: {
    id: "t1",
    externalId: 1,
    installmentNumber: null,
    installmentLabel: null,
    counterparty: {
      personId: 1,
      name: "Cliente",
      taxId: "123",
      role: "CUSTOMER",
    },
    description: "NF",
    documentNumber: null,
    salesOrderExternalId: 9,
    salesOrderCode: "PV-9",
    invoice: { externalId: 1, number: "100" },
    issuedOn: "2026-06-01",
    dueDate: "2026-07-20",
    originalAmount: "100.00",
    openBalance: "40.00",
    settlements: {
      settledAmount: "60.00",
      settledAt: "2026-07-15",
      paidAt: null,
    },
    cancellation: {
      isCancelledOrRemovedFromSource: false,
      sourcePresenceStatus: "PRESENT",
      sourceRemovedAt: null,
    },
    officialStatus: {
      nomusStatus: false,
      isOpen: true,
      isSettled: false,
      sourcePresenceStatus: "PRESENT",
    },
    lastSyncedAt: new Date().toISOString().replace("Z", "+00:00"),
  },
  complement: {
    id: "c1",
    expectedDate: "2026-07-28",
    confirmedDate: null,
    scheduledDate: null,
    expectedAmount: "40.00",
    confirmedAmount: null,
    scheduledAmount: null,
    status: "ACTIVE",
    priority: "HIGH",
    plannedAccountId: null,
    responsibleUserId: "u-collector",
    nextAction: "Ligar",
    reason: "Acordo",
    notes: null,
    version: 1,
    updatedAt: "2026-07-21T10:00:00.000+00:00",
    cancelledAt: null,
  },
  sellerName: "Maria",
  commercialOwnerName: null,
  openAmount: "40.00",
  receivedAmount: "60.00",
  daysOverdue: 7,
  operationalStatus: "OVERDUE",
  lastAction: {
    at: "2026-07-21T10:00:00.000+00:00",
    summary: "Acordo",
  },
  nextAction: "Ligar",
});

describe("treasuryReceivablesUi — viewKind e query", () => {
  it("resolve estados denied/loading/empty/ready", () => {
    assert.equal(
      resolveTreasuryReceivablesViewKind({
        canView: false,
        loading: false,
        error: null,
        rowCount: 0,
        hasFilters: false,
      }),
      "denied"
    );
    assert.equal(
      resolveTreasuryReceivablesViewKind({
        canView: true,
        loading: true,
        error: null,
        rowCount: 0,
        hasFilters: false,
      }),
      "loading"
    );
    assert.equal(
      resolveTreasuryReceivablesViewKind({
        canView: true,
        loading: false,
        error: null,
        rowCount: 0,
        hasFilters: true,
      }),
      "empty-filtered"
    );
    assert.equal(
      resolveTreasuryReceivablesViewKind({
        canView: true,
        loading: false,
        error: null,
        rowCount: 2,
        hasFilters: false,
      }),
      "ready"
    );
  });

  it("monta query de lista e detecta filtros ativos", () => {
    const filters = createEmptyTreasuryReceivablesFilters();
    filters.customerName = "Alpha";
    filters.hasPromise = "true";
    const q = buildTreasuryReceivablesListQuery({
      filters,
      page: 2,
      pageSize: 25,
    });
    assert.equal(q.customerName, "Alpha");
    assert.equal(q.hasPromise, true);
    assert.equal(q.page, 2);
    assert.equal(q.hasFilters, true);
    assert.equal(
      treasuryReceivablesFiltersActive(createEmptyTreasuryReceivablesFilters()),
      false
    );
  });

  it("monta histórico operacional e detecta sync stale", () => {
    const history = buildTreasuryReceivableOperationalHistory(sampleRow());
    assert.ok(history.some((h) => h.label === "Última ação"));
    assert.ok(history.some((h) => h.label.includes("sincronização")));

    const fresh = resolveTreasuryReceivablesStaleState([sampleRow()]);
    assert.equal(fresh.kind, "ok");

    const staleRow = sampleRow();
    staleRow.official.lastSyncedAt = "2020-01-01T00:00:00.000+00:00";
    const stale = resolveTreasuryReceivablesStaleState([staleRow], 24);
    assert.equal(stale.kind, "stale");
    assert.ok(stale.message);
  });
});
