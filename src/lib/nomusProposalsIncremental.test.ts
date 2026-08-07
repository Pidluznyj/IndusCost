import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateProposalsIncrementalWindow,
  isProposalPlanEqual,
  type ExistingProposalDbData,
  type ProposalPlanComparisonData,
} from "./nomusProposalsIncremental.js";

describe("nomusProposalsIncremental — janela incremental", () => {
  it("sem checkpoint prévio → usa data de início padrão ou fallback (7 dias)", () => {
    const now = new Date("2026-08-07T10:00:00.000Z");
    const result = calculateProposalsIncrementalWindow({
      lastCheckpoint: null,
      now,
    });

    assert.equal(result.isIncremental, false);
    assert.equal(result.lastSuccessfulCheckpoint, null);
    assert.equal(result.overlapFrom, null);
    assert.equal(
      result.startDate.toISOString(),
      new Date("2026-07-31T10:00:00.000Z").toISOString()
    );
  });

  it("com checkpoint prévio → calcula janela incremental com sobreposição de 30min", () => {
    const now = new Date("2026-08-07T10:37:00.000Z");
    const lastCheckpoint = new Date("2026-08-07T09:37:00.000Z");

    const result = calculateProposalsIncrementalWindow({
      lastCheckpoint,
      now,
      overlapMinutes: 30,
    });

    assert.equal(result.isIncremental, true);
    assert.equal(result.lastSuccessfulCheckpoint, lastCheckpoint);
    assert.ok(result.overlapFrom);
    // 09:37:00 minus 30 minutes = 09:07:00
    assert.equal(result.overlapFrom.toISOString(), "2026-08-07T09:07:00.000Z");
    assert.equal(result.startDate.toISOString(), "2026-08-07T09:07:00.000Z");
  });

  it("forceFull = true → ignora checkpoint e executa janela completa", () => {
    const now = new Date("2026-08-07T10:37:00.000Z");
    const lastCheckpoint = new Date("2026-08-07T09:37:00.000Z");

    const result = calculateProposalsIncrementalWindow({
      lastCheckpoint,
      now,
      forceFull: true,
    });

    assert.equal(result.isIncremental, false);
    assert.equal(result.overlapFrom, null);
  });
});

describe("nomusProposalsIncremental — diffing e igualdade de propostas", () => {
  const samplePlan: ProposalPlanComparisonData = {
    externalProposalId: 101,
    externalProposalCode: "NOMUS-000101",
    customerId: "cust-1",
    status: "SENT",
    totalItems: 2,
    totalGrossValue: 1000,
    totalNetValue: 1000,
    totalCost: 600,
    totalMarginValue: 400,
    totalTaxes: 0,
    items: [
      {
        productId: "prod-1",
        quantity: 10,
        unitCost: 30,
        negotiatedPrice: 50,
        marginValue: 200,
      },
      {
        productId: "prod-2",
        quantity: 5,
        unitCost: 60,
        negotiatedPrice: 100,
        marginValue: 200,
      },
    ],
  };

  const sampleDb: ExistingProposalDbData = {
    id: "prop-uuid-1",
    externalProposalId: 101,
    externalProposalCode: "NOMUS-000101",
    customerId: "cust-1",
    status: "SENT",
    totalItems: 2,
    totalGrossValue: 1000,
    totalNetValue: 1000,
    totalCost: 600,
    totalMarginValue: 400,
    totalTaxes: 0,
    items: [
      {
        id: "item-uuid-1",
        productId: "prod-1",
        quantity: 10,
        unitCost: 30,
        negotiatedPrice: 50,
        marginValue: 200,
        externalItemId: 1,
      },
      {
        id: "item-uuid-2",
        productId: "prod-2",
        quantity: 5,
        unitCost: 60,
        negotiatedPrice: 100,
        marginValue: 200,
        externalItemId: 2,
      },
    ],
  };

  it("proposta 100% idêntica → retorna true (UNCHANGED)", () => {
    assert.equal(isProposalPlanEqual(samplePlan, sampleDb), true);
  });

  it("alteração em cliente → retorna false", () => {
    const plan = { ...samplePlan, customerId: "cust-2" };
    assert.equal(isProposalPlanEqual(plan, sampleDb), false);
  });

  it("alteração em valor total → retorna false", () => {
    const plan = { ...samplePlan, totalNetValue: 1200 };
    assert.equal(isProposalPlanEqual(plan, sampleDb), false);
  });

  it("alteração na quantidade de um item → retorna false", () => {
    const plan = {
      ...samplePlan,
      items: [
        { ...samplePlan.items[0], quantity: 12 },
        samplePlan.items[1],
      ],
    };
    assert.equal(isProposalPlanEqual(plan, sampleDb), false);
  });

  it("alteração de preço negociado em item → retorna false", () => {
    const plan = {
      ...samplePlan,
      items: [
        samplePlan.items[0],
        { ...samplePlan.items[1], negotiatedPrice: 110 },
      ],
    };
    assert.equal(isProposalPlanEqual(plan, sampleDb), false);
  });
});
