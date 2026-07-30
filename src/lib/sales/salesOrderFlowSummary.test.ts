import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderFlowSummaryColumns,
  buildSalesOrderFlowSummaryPayload,
  buildSalesOrderFlowSummarySnapshotWhere,
  parseSalesOrderFlowSummaryQuery,
  SalesOrderFlowSummaryQueryError,
} from "./salesOrderFlowSummary.js";
import { SALES_ORDER_FLOW_STAGES } from "./salesOrderFlowCatalog.js";

describe("salesOrderFlowSummary (OP-59)", () => {
  it("parseia filtros de busca, cliente, vendedor, empresa, produto e setor", () => {
    const filters = parseSalesOrderFlowSummaryQuery({
      q: "PD 123",
      customerId: "cust-1",
      sellerKey: "nomus:10",
      seller: "Maria",
      empresa: "Lazarios",
      produto: "SKU-1",
      setor: "FATURAMENTO",
      priority: "high",
    });
    assert.equal(filters.q, "PD 123");
    assert.equal(filters.customerId, "cust-1");
    assert.equal(filters.sellerKey, "nomus:10");
    assert.equal(filters.seller, "Maria");
    assert.equal(filters.company, "Lazarios");
    assert.equal(filters.product, "SKU-1");
    assert.equal(filters.sector, "FATURAMENTO");
    assert.equal(filters.priority, "HIGH");
  });

  it("parseia emissão, entrega e flags booleanas", () => {
    const filters = parseSalesOrderFlowSummaryQuery({
      issueFrom: "2026-01-01",
      issueTo: "2026-01-31",
      promisedFrom: "2026-02-01",
      promisedTo: "2026-02-28",
      atrasado: "true",
      bloqueado: "1",
      inconsistente: "false",
      parcialmenteEnviado: "true",
      comCorte: "true",
      comSaldoAtivo: "0",
      unrecognizedDs: "true",
      nfeUnlinked: "true",
      opUnlinked: "true",
      partialCoverage: "true",
      ambiguousLink: "true",
      snapshotDivergent: "true",
    });
    assert.ok(filters.issueFrom);
    assert.ok(filters.issueTo);
    assert.ok(filters.promisedFrom);
    assert.ok(filters.promisedTo);
    assert.equal(filters.overdue, true);
    assert.equal(filters.blocked, true);
    assert.equal(filters.inconsistent, false);
    assert.equal(filters.partiallyShipped, true);
    assert.equal(filters.withCut, true);
    assert.equal(filters.withActiveResidual, false);
    assert.equal(filters.unrecognizedDs, true);
    assert.equal(filters.nfeUnlinked, true);
    assert.equal(filters.opUnlinked, true);
    assert.equal(filters.partialCoverage, true);
    assert.equal(filters.ambiguousLink, true);
    assert.equal(filters.snapshotDivergent, true);
  });

  it("rejeita prioridade inválida", () => {
    assert.throws(
      () => parseSalesOrderFlowSummaryQuery({ priority: "MEGA" }),
      SalesOrderFlowSummaryQueryError
    );
  });

  it("where aplica filtros no snapshot sem expandir joins", () => {
    const where = buildSalesOrderFlowSummarySnapshotWhere({
      filters: parseSalesOrderFlowSummaryQuery({
        customerId: "c1",
        produto: "ABC",
        atrasado: "true",
        bloqueado: "true",
        prioridade: "URGENT",
        parcialmenteEnviado: "true",
        comCorte: "true",
        comSaldoAtivo: "true",
        inconsistente: "true",
        unrecognizedDs: "true",
        nfeUnlinked: "true",
        opUnlinked: "true",
        partialCoverage: "true",
        ambiguousLink: "true",
        snapshotDivergent: "true",
        setor: "PCP",
        empresa: "Laz",
      }),
      scopeCustomerIds: ["c1", "c2"],
    });

    const json = JSON.stringify(where);
    assert.match(json, /"customerId"/);
    assert.match(json, /"items"/);
    assert.match(json, /"some"/);
    assert.match(json, /"isOverdue":true/);
    assert.match(json, /"isBlocked":true/);
    assert.match(json, /"PARTIAL"/);
    assert.match(json, /"cutValue"/);
    assert.match(json, /"activeResidualValue"/);
    assert.match(json, /"inconsistentItems"/);
    assert.match(json, /"responsible"/);
    assert.match(json, /"companyIssuer"/);
    assert.match(json, /DS_UNRECOGNIZED/);
    assert.match(json, /NFE_UNLINKED/);
    assert.match(json, /OP_UNLINKED/);
    assert.match(json, /PARTIAL_COVERAGE/);
    assert.match(json, /AMBIGUOUS_LINK/);
    assert.match(json, /SNAPSHOT_DIVERGENT/);
    assert.doesNotMatch(json, /"include"/);
  });

  it("monta colunas com cancelados separados e totais", () => {
    const payload = buildSalesOrderFlowSummaryPayload({
      filters: parseSalesOrderFlowSummaryQuery({}),
      aggregates: [
        {
          stage: "IN_PRODUCTION",
          orderCount: 2,
          orderValue: 100,
          activeResidualValue: 40,
        },
        {
          stage: "CANCELED",
          orderCount: 1,
          orderValue: 50,
          activeResidualValue: 0,
        },
      ],
      totals: {
        overdueCount: 3,
        blockedCount: 1,
        inconsistentCount: 2,
        partiallyShippedCount: 4,
        completedWithCutCount: 5,
        canceledCount: 1,
        avgCycleDaysTrimmed: 8.5,
        avgCycleDaysSampleSize: 12,
      },
      lastUpdatedAt: new Date("2026-07-17T12:00:00Z"),
      canViewValues: true,
      generatedAt: new Date("2026-07-17T13:00:00Z"),
    });

    assert.equal(payload.columns.length, SALES_ORDER_FLOW_STAGES.length);
    const canceled = payload.columns.find((c) => c.stage === "CANCELED");
    assert.equal(canceled?.isCanceledColumn, true);
    assert.equal(canceled?.orderCount, 1);
    const production = payload.columns.find((c) => c.stage === "IN_PRODUCTION");
    assert.equal(production?.orderValue, 100);
    assert.equal(production?.activeResidualValue, 40);
    assert.equal(payload.totals.overdueCount, 3);
    assert.equal(payload.totals.completedWithCutCount, 5);
    assert.equal(payload.lastUpdatedAt, "2026-07-17T12:00:00.000Z");
    assert.equal(payload.valuesVisible, true);
  });

  it("oculta valores monetários quando canViewValues=false", () => {
    const columns = buildSalesOrderFlowSummaryColumns(
      [
        {
          stage: "WAITING_RELEASE",
          orderCount: 3,
          orderValue: 999,
          activeResidualValue: 111,
        },
      ],
      false
    );
    const waiting = columns.find((c) => c.stage === "WAITING_RELEASE");
    assert.equal(waiting?.orderCount, 3);
    assert.equal(waiting?.orderValue, null);
    assert.equal(waiting?.activeResidualValue, null);
  });

  it("oculta total de inconsistências sem ocultar colunas operacionais", () => {
    const payload = buildSalesOrderFlowSummaryPayload({
      filters: parseSalesOrderFlowSummaryQuery({}),
      aggregates: [
        {
          stage: "IN_PRODUCTION",
          orderCount: 2,
          orderValue: 0,
          activeResidualValue: 0,
        },
      ],
      totals: {
        overdueCount: 0,
        blockedCount: 0,
        inconsistentCount: 2,
        partiallyShippedCount: 0,
        completedWithCutCount: 0,
        canceledCount: 0,
        avgCycleDaysTrimmed: null,
        avgCycleDaysSampleSize: 0,
      },
      lastUpdatedAt: null,
      canViewValues: false,
      canViewInconsistencies: false,
    });
    assert.equal(
      payload.columns.find((column) => column.stage === "IN_PRODUCTION")
        ?.orderCount,
      2
    );
    assert.equal(payload.totals.inconsistentCount, null);
    assert.equal(payload.inconsistenciesVisible, false);
  });
});
