import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFinanceCostCenterAuditListQuery } from "@/src/lib/financeCostCenterAudit";

describe("financeCostCenterAudit", () => {
  it("parseia ordenação e filtros de data", () => {
    const query = parseFinanceCostCenterAuditListQuery({
      entityType: "FinancialCostCenter",
      userName: "Paulo",
      action: "UPDATE",
      search: "reallocate",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      page: "2",
      limit: "25",
      sortBy: "userName",
      sortDirection: "asc",
    });
    assert.equal(query.entityType, "FinancialCostCenter");
    assert.equal(query.sortBy, "userName");
    assert.equal(query.sortDirection, "asc");
    assert.equal(query.page, 2);
    assert.equal(query.limit, 25);
    assert.equal(query.dateFrom, "2026-01-01");
    assert.equal(query.search, "reallocate");
  });

  it("usa defaults quando sort inválido", () => {
    const query = parseFinanceCostCenterAuditListQuery({ sortBy: "invalid" });
    assert.equal(query.sortBy, "createdAt");
    assert.equal(query.sortDirection, "desc");
    assert.equal(query.limit, 50);
  });
});
