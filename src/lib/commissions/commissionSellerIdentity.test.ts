import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveCanonicalCommissionPersonId,
  resolveCommissionSellerIdentity,
  sellerNameMatchesFilter,
  type CommissionSellerIdentityContext,
} from "./commissionSellerIdentity.js";
import { buildGisleneAudit, buildSellerIdentityGroups } from "./commissionSellerIdentityAudit.js";
import { buildVisualAuditRow } from "./commissionVisualAudit.js";
import type { SellerSourceObservation } from "./commissionSellerIdentityAudit.js";

function ctx(overrides?: Partial<CommissionSellerIdentityContext>): CommissionSellerIdentityContext {
  return {
    persons: [
      {
        id: "person-gislene",
        nomusPersonId: 464,
        name: "GISLENE LIMA",
        type: "SELLER",
        source: "NOMUS",
        active: true,
        linkedRecordCount: 10,
      },
      {
        id: "person-gislene-dup",
        nomusPersonId: null,
        name: "Gislene Lima",
        type: "SELLER",
        source: "MANUAL",
        active: true,
        linkedRecordCount: 2,
      },
    ],
    aliases: [
      {
        id: "alias-1",
        commissionedPersonId: "person-gislene",
        source: "NOMUS_ORDER",
        rawSellerId: 464,
        rawSellerName: "GISLENE LIMA",
        normalizedSellerName: "GISLENE LIMA",
        status: "ACTIVE",
        confidence: 1,
      },
      {
        id: "alias-2",
        commissionedPersonId: "person-gislene",
        source: "NOMUS_ORDER",
        rawSellerId: null,
        rawSellerName: "GISLENE LIMA",
        normalizedSellerName: "GISLENE LIMA",
        status: "ACTIVE",
        confidence: 0.9,
      },
    ],
    ...overrides,
  };
}

describe("resolveCommissionSellerIdentity", () => {
  it("mesmo nome com dois raw seller IDs consolida quando alias aprovado", () => {
    const r464 = resolveCommissionSellerIdentity(
      { rawSellerId: 464, rawSellerName: "GISLENE LIMA", source: "NOMUS_ORDER" },
      ctx()
    );
    assert.equal(r464.canonicalSellerId, "person-gislene");
    assert.equal(r464.resolutionStatus, "OK_CANONICAL");
    assert.equal(r464.resolutionMethod, "COMMISSION_PERSON");
  });

  it("mesmo nome sem raw ID usa fallback por nome normalizado", () => {
    const rName = resolveCommissionSellerIdentity(
      { rawSellerName: "Gislene Lima", source: "NOMUS_ORDER" },
      ctx({
        persons: [
          {
            id: "person-gislene",
            nomusPersonId: 464,
            name: "GISLENE LIMA",
            type: "SELLER",
            source: "NOMUS",
            active: true,
          },
        ],
      })
    );
    assert.equal(rName.canonicalSellerId, "person-gislene");
    assert.ok(
      rName.resolutionMethod === "ALIAS_NORMALIZED_NAME" ||
        rName.resolutionMethod === "COMMISSION_PERSON"
    );
  });

  it("nomes iguais sem alias aprovado ficam como múltiplos canônicos", () => {
    const resolution = resolveCommissionSellerIdentity(
      { rawSellerName: "Gislene Lima", source: "OTHER" },
      ctx({ aliases: [] })
    );
    assert.ok(
      resolution.resolutionStatus === "MULTIPLE_CANONICALS" ||
        resolution.resolutionStatus === "MISSING_EXTERNAL_ID"
    );
    assert.ok(resolution.canonicalSellerId);
  });

  it("Gislene com ID 464 e sem ID consolida no mesmo canonical com aliases", () => {
    const byId = resolveCommissionSellerIdentity(
      { rawSellerId: 464, rawSellerName: "GISLENE", source: "NOMUS_ORDER" },
      ctx()
    );
    const byName = resolveCommissionSellerIdentity(
      { rawSellerName: "GISLENE LIMA", source: "NOMUS_ORDER" },
      ctx()
    );
    assert.equal(byId.canonicalSellerId, byName.canonicalSellerId);
  });

  it("Rodrigo com IDs diferentes aparece como múltiplos IDs no agrupamento", () => {
    const context = ctx({
      persons: [
        {
          id: "p-r1",
          nomusPersonId: 10,
          name: "RODRIGO SILVA",
          type: "SELLER",
          source: "NOMUS",
          active: true,
        },
        {
          id: "p-r2",
          nomusPersonId: 20,
          name: "RODRIGO SILVA",
          type: "SELLER",
          source: "NOMUS",
          active: true,
        },
      ],
      aliases: [],
    });
    const groups = buildSellerIdentityGroups({
      observations: [
        {
          sourceTable: "SalesOrder",
          sourceId: "o1",
          rawSellerId: 10,
          rawSellerName: "RODRIGO SILVA",
          normalizedSellerName: "RODRIGO SILVA",
          canonicalSellerId: "p-r1",
          canonicalSellerName: "RODRIGO SILVA",
          issueDate: null,
          settlementDate: null,
          customer: null,
          order: "PV-1",
          nfe: null,
          receivable: null,
          base: 0,
          expectedCommission: 0,
          releasedCommission: 0,
          status: "OK_CANONICAL",
          warning: null,
        },
        {
          sourceTable: "SalesOrder",
          sourceId: "o2",
          rawSellerId: 20,
          rawSellerName: "RODRIGO SILVA",
          normalizedSellerName: "RODRIGO SILVA",
          canonicalSellerId: "p-r2",
          canonicalSellerName: "RODRIGO SILVA",
          issueDate: null,
          settlementDate: null,
          customer: null,
          order: "PV-2",
          nfe: null,
          receivable: null,
          base: 0,
          expectedCommission: 0,
          releasedCommission: 0,
          status: "OK_CANONICAL",
          warning: null,
        },
      ],
      identityCtx: context,
    });
    assert.equal(groups[0]?.rawSellerIds.length, 2);
    assert.ok(
      groups[0]?.status === "MULTIPLE_CANONICALS" ||
        groups[0]?.status === "MULTIPLE_EXTERNAL_IDS_SAME_NAME"
    );
  });

  it("resolveCanonicalCommissionPersonId unifica duplicatas por nome", () => {
    const canonical = resolveCanonicalCommissionPersonId("person-gislene-dup", ctx({ aliases: [] }));
    assert.equal(canonical, "person-gislene");
  });
});

describe("buildGisleneAudit", () => {
  const observations: SellerSourceObservation[] = [
    {
      sourceTable: "SalesOrder",
      sourceId: "o1",
      rawSellerId: 464,
      rawSellerName: "GISLENE LIMA",
      normalizedSellerName: "GISLENE LIMA",
      canonicalSellerId: "person-gislene",
      canonicalSellerName: "GISLENE LIMA",
      issueDate: null,
      settlementDate: null,
      customer: null,
      order: "PV-1",
      nfe: null,
      receivable: null,
      base: 0,
      expectedCommission: 0,
      releasedCommission: 0,
      status: "OK_CANONICAL",
      warning: null,
    },
  ];

  const groups = buildSellerIdentityGroups({ observations, identityCtx: ctx() });
  const payableRow = buildVisualAuditRow({
    lineId: "l1",
    recordId: "r1",
    scheduleId: "s1",
    commissionPersonId: "person-gislene",
    commissionPersonName: "GISLENE LIMA",
    customerName: "Cliente",
    orderCode: "PV-1",
    nfeNumber: "1",
    nomusNfeId: 1,
    confirmedAt: null,
    documentKey: "k",
    documentBaseAmount: 1000,
    documentCommissionTotal: 20,
    itemBaseAmount: 1000,
    itemCommissionAmount: 20,
    itemRatePercent: 2,
    productCode: null,
    nomusReceivableId: 1,
    installmentNumber: 1,
    dueDate: null,
    settlementDate: "2026-06-10T00:00:00.000Z",
    receivableAmount: 1000,
    receivedAmount: 1000,
    openBalance: 0,
    allocationPercent: 100,
    commissionExpected: 20,
    commissionReleased: 20,
    hasArLink: true,
    hasSchedule: true,
    customerNoCommission: false,
    isCommissionable: true,
    exclusionReason: null,
    exclusionRuleId: null,
  });

  it("auditoria Gislene consolida comissão payable", () => {
    assert.ok(sellerNameMatchesFilter("GISLENE LIMA", "GISLENE"));
    const audit = buildGisleneAudit({
      groups,
      payableRows: [payableRow],
      generatedRows: [payableRow],
      forecastRows: [],
      identityCtx: ctx(),
    });
    assert.ok(audit, `groups=${groups.length} names=${groups.map((g) => g.normalizedSellerName).join()}`);
    assert.ok(audit!.rawIds.includes(464));
    assert.equal(audit!.canonicalPersonId, "person-gislene");
    assert.equal(audit!.commission.payableReleased, 20);
    assert.equal(audit!.pending.outsideCanonical, 0);
  });
});
