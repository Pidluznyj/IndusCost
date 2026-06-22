import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateReclassificationRuleForAllocation,
  normalizeFinancialText,
} from "./financeCostCenterReclassificationRules";
import type { ReclassificationRuleRecord } from "./financeCostCenterReclassificationShared";

const TARGET_ID = "target-investimento-socios";

function baseRule(overrides: Partial<ReclassificationRuleRecord> = {}): ReclassificationRuleRecord {
  return {
    id: "rule-1",
    name: "Investimento Sócios por descrição AP",
    description: null,
    priority: 50,
    isActive: true,
    sourceCostCenterName: null,
    sourceParentName: "ADMINISTRATIVO",
    targetCostCenterId: TARGET_ID,
    matchFields: {
      apFields: ["description", "comments"],
      sourceParentNames: ["ADMINISTRATIVO", "CONTA ADMINISTRATIVA"],
      excludeParentNames: ["FABRICACAO", "FABRICAÇÃO"],
    },
    keywords: [
      "INVESTIMENTO CONSELHO KOPPETEL",
      "FINANCIAMENTO MARCIA",
      "FINANCIAMENTO MÁRCIA",
    ],
    matchMode: "CONTAINS_ANY",
    applyToSources: ["AUTO_RULE", "BATCH"],
    skipManual: true,
    notes: null,
    ...overrides,
  };
}

function evaluate(input: {
  parentName: string;
  description?: string | null;
  comments?: string | null;
  source?: "AUTO_RULE" | "MANUAL" | "BATCH";
  lockedManual?: boolean;
  costCenterId?: string;
  costCenterName?: string;
}) {
  return evaluateReclassificationRuleForAllocation({
    allocation: {
      id: "alloc-1",
      accountsPayableId: 100,
      costCenterId: input.costCenterId ?? "cc-admin-child",
      source: input.source ?? "AUTO_RULE",
      lockedManual: input.lockedManual ?? false,
    },
    costCenter: {
      id: input.costCenterId ?? "cc-admin-child",
      name: input.costCenterName ?? "DESPESAS GERAIS",
      parentName: input.parentName,
    },
    payable: {
      externalId: 100,
      personName: "Fornecedor X",
      description: input.description ?? null,
      comments: input.comments ?? null,
    },
    rule: baseRule(),
    targetCostCenterLabel: "ADMINISTRATIVO / INVESTIMENTO SOCIOS",
  });
}

describe("normalizeFinancialText", () => {
  it("remove acentos e colapsa espaços", () => {
    assert.equal(normalizeFinancialText("  Financiamento   Márcia  "), "FINANCIAMENTO MARCIA");
    assert.equal(normalizeFinancialText("MARCIA"), "MARCIA");
  });
});

describe("evaluateReclassificationRuleForAllocation", () => {
  it("1. ADMINISTRATIVO + INVESTIMENTO CONSELHO KOPPETEL → aplica", () => {
    const result = evaluate({
      parentName: "ADMINISTRATIVO",
      description: "Pagamento INVESTIMENTO CONSELHO KOPPETEL",
    });
    assert.equal(result.applies, true);
    if (result.applies) {
      assert.equal(result.targetCostCenterId, TARGET_ID);
      assert.match(result.matchedKeyword, /INVESTIMENTO CONSELHO KOPPETEL/);
    }
  });

  it("2. CONTA ADMINISTRATIVA + FINANCIAMENTO MARCIA → aplica", () => {
    const result = evaluate({
      parentName: "CONTA ADMINISTRATIVA",
      description: "FINANCIAMENTO MARCIA parcela 3",
    });
    assert.equal(result.applies, true);
  });

  it("3. ADMINISTRATIVO + comments FINANCIAMENTO MÁRCIA → aplica", () => {
    const result = evaluate({
      parentName: "ADMINISTRATIVO",
      comments: "Obs: FINANCIAMENTO MÁRCIA",
    });
    assert.equal(result.applies, true);
  });

  it("4. FABRICAÇÃO + FINANCIAMENTO MARCIA → não aplica", () => {
    const result = evaluate({
      parentName: "FABRICAÇÃO",
      description: "FINANCIAMENTO MARCIA",
    });
    assert.equal(result.applies, false);
  });

  it("5. ADMINISTRATIVO sem palavra-chave → não aplica", () => {
    const result = evaluate({
      parentName: "ADMINISTRATIVO",
      description: "Aluguel escritório",
    });
    assert.equal(result.applies, false);
  });

  it("6. lockedManual=true → não aplica", () => {
    const result = evaluate({
      parentName: "ADMINISTRATIVO",
      description: "FINANCIAMENTO MARCIA",
      lockedManual: true,
    });
    assert.equal(result.applies, false);
    if (!result.applies) assert.match(result.reason, /manual/i);
  });

  it("7. source=MANUAL → não aplica", () => {
    const result = evaluate({
      parentName: "ADMINISTRATIVO",
      description: "FINANCIAMENTO MARCIA",
      source: "MANUAL",
    });
    assert.equal(result.applies, false);
  });

  it("8. MARCIA e MÁRCIA funcionam igual", () => {
    const a = evaluate({ parentName: "ADMINISTRATIVO", description: "financiamento marcia" });
    const b = evaluate({ parentName: "ADMINISTRATIVO", description: "financiamento márcia" });
    assert.equal(a.applies, true);
    assert.equal(b.applies, true);
  });

  it("9. regra inativa não aplica", () => {
    const result = evaluateReclassificationRuleForAllocation({
      allocation: {
        id: "a",
        accountsPayableId: 1,
        costCenterId: "cc-1",
        source: "AUTO_RULE",
        lockedManual: false,
      },
      costCenter: { id: "cc-1", name: "X", parentName: "ADMINISTRATIVO" },
      payable: {
        externalId: 1,
        personName: null,
        description: "FINANCIAMENTO MARCIA",
        comments: null,
      },
      rule: baseRule({ isActive: false }),
      targetCostCenterLabel: "ADMINISTRATIVO / INVESTIMENTO SOCIOS",
    });
    assert.equal(result.applies, false);
  });

  it("10. prioridade — regra mais específica vence quando avaliada primeiro", () => {
    const generic = baseRule({ id: "generic", priority: 100, keywords: ["FINANCIAMENTO"] });
    const specific = baseRule({
      id: "specific",
      priority: 10,
      keywords: ["FINANCIAMENTO MARCIA"],
    });

    const ctx = {
      allocation: {
        id: "a",
        accountsPayableId: 1,
        costCenterId: "cc-1",
        source: "AUTO_RULE" as const,
        lockedManual: false,
      },
      costCenter: { id: "cc-1", name: "X", parentName: "ADMINISTRATIVO" },
      payable: {
        externalId: 1,
        personName: null,
        description: "FINANCIAMENTO MARCIA",
        comments: null,
      },
      targetCostCenterLabel: "ADMINISTRATIVO / INVESTIMENTO SOCIOS",
    };

    const ordered = [
      evaluateReclassificationRuleForAllocation({ ...ctx, rule: specific }),
      evaluateReclassificationRuleForAllocation({ ...ctx, rule: generic }),
    ];
    assert.equal(ordered[0]?.applies, true);
    if (ordered[0]?.applies) assert.equal(ordered[0].ruleId, "specific");
  });

  it("já no centro destino → não aplica", () => {
    const result = evaluate({
      parentName: "ADMINISTRATIVO",
      description: "FINANCIAMENTO MARCIA",
      costCenterId: TARGET_ID,
    });
    assert.equal(result.applies, false);
  });
});
