import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  evaluateClassificationRuleCandidate,
  normalizeClassificationSearchText,
  resolveBestClassificationMatch,
  type ClassificationApRow,
  type ClassificationRuleCandidate,
} from "./financeCostCenterClassificationRuleMatcher.js";
import { FINANCE_ESTORNOS_KEYWORDS } from "./financeCostCenterClassificationRulesShared.js";
import { parseClassificationRuleBody } from "./financeCostCenterClassificationRules.js";

function ap(overrides: Partial<ClassificationApRow> = {}): ClassificationApRow {
  return {
    externalId: 1001,
    personName: null,
    personCnpj: null,
    companyName: "Empresa",
    classification: null,
    description: null,
    comments: null,
    documentNumber: null,
    balancePayable: 1000,
    amountPayable: 1000,
    ...overrides,
  };
}

function keywordRule(overrides: Partial<ClassificationRuleCandidate> = {}): ClassificationRuleCandidate {
  return {
    id: "rule-kw",
    name: "Estornos e ressarcimentos",
    ruleType: "KEYWORDS",
    costCenterId: "cc-estornos",
    percentage: 100,
    priority: 200,
    autoApply: false,
    isActive: true,
    supplierId: null,
    nomusClassification: null,
    descriptionContains: null,
    documentContains: null,
    keywords: [...FINANCE_ESTORNOS_KEYWORDS],
    financialNature: null,
    company: null,
    minAmount: null,
    maxAmount: null,
    titleStatus: null,
    accountsPayableId: null,
    ...overrides,
  };
}

describe("financeCostCenterClassificationRuleMatcher", () => {
  it("1. permite criar regra sem fornecedor (parser)", () => {
    const input = parseClassificationRuleBody({
      name: "Estornos",
      ruleType: "KEYWORDS",
      costCenterId: "cc-1",
      keywords: ["estorno"],
    });
    assert.equal(input.supplierId, null);
  });

  it("2. regra por palavras-chave casa descrição", () => {
    const result = evaluateClassificationRuleCandidate(
      ap({ description: "Pagamento de estorno ao cliente" }),
      keywordRule(),
      null,
      { requireAutoApply: false }
    );
    assert.equal(result.matches, true);
  });

  it("3. regra por descrição", () => {
    const rule: ClassificationRuleCandidate = {
      ...keywordRule({ id: "desc" }),
      ruleType: "DESCRIPTION_CONTAINS",
      keywords: [],
      descriptionContains: "tarifa bancária",
    };
    const result = evaluateClassificationRuleCandidate(
      ap({ description: "Tarifa bancária mensal" }),
      rule,
      null,
      { requireAutoApply: false }
    );
    assert.equal(result.matches, true);
  });

  it("4. regra por classificação Nomus", () => {
    const rule: ClassificationRuleCandidate = {
      ...keywordRule({ id: "nomus" }),
      ruleType: "NOMUS_CLASSIFICATION",
      keywords: [],
      nomusClassification: "50.05",
    };
    const result = evaluateClassificationRuleCandidate(
      ap({ classification: "50.05 Investimento" }),
      rule,
      null,
      { requireAutoApply: false }
    );
    assert.equal(result.matches, true);
  });

  it("5. regra por fornecedor continua funcionando via matcher unificado", () => {
    const supplier = {
      id: "sup-1",
      displayName: "Fornecedor Genérico",
      status: "ACTIVE",
      normalizedDocument: "12345678000190",
      normalizedName: "fornecedor generico",
      aliases: [{ externalSupplierId: null, normalizedDocument: "12345678000190", normalizedName: null }],
    };
    const match = resolveBestClassificationMatch({
      ap: ap({ personCnpj: "12.345.678/0001-90" }),
      supplier,
      supplierRules: [
        {
          id: "sr-1",
          supplierId: "sup-1",
          costCenterId: "cc-mp",
          percentage: 100,
          priority: 100,
          autoApply: true,
          isActive: true,
          company: null,
        },
      ],
      classificationRules: [],
      requireAutoApply: true,
    });
    assert.equal(match?.kind, "SUPPLIER");
  });

  it("7. regra por estorno classifica título sem fornecedor", () => {
    const match = resolveBestClassificationMatch({
      ap: ap({ description: "Ressarcimento cliente por pagamento indevido" }),
      supplier: null,
      supplierRules: [],
      classificationRules: [keywordRule()],
      requireAutoApply: false,
    });
    assert.equal(match?.kind, "CLASSIFICATION");
    assert.equal(match?.ruleName, "Estornos e ressarcimentos");
  });

  it("8. regra por estorno vence fornecedor genérico quando descrição é clara", () => {
    const supplier = {
      id: "sup-generic",
      displayName: "Conta Administrativa",
      status: "ACTIVE",
      normalizedDocument: "99999999000199",
      normalizedName: "conta administrativa",
      aliases: [{ externalSupplierId: null, normalizedDocument: "99999999000199", normalizedName: null }],
    };
    const match = resolveBestClassificationMatch({
      ap: ap({
        personCnpj: "99.999.999/0001-99",
        description: "Estorno de pagamento indevido",
      }),
      supplier,
      supplierRules: [
        {
          id: "sr-admin",
          supplierId: "sup-generic",
          costCenterId: "cc-admin",
          percentage: 100,
          priority: 100,
          autoApply: true,
          isActive: true,
          company: null,
        },
      ],
      classificationRules: [keywordRule({ priority: 200 })],
      requireAutoApply: false,
    });
    assert.equal(match?.kind, "CLASSIFICATION");
  });

  it("normaliza acentos em palavras-chave", () => {
    assert.ok(normalizeClassificationSearchText("devolução").includes("devolucao"));
  });
});

describe("financeCostCenterClassificationRules wiring", () => {
  it("9-11. expõe preview/apply/auditoria e grid", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeCostCenterClassificationRulesRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /classification-rules\/preview/);
    assert.match(routes, /classification-rules\/:id\/apply/);

    const lib = readFileSync(
      join(process.cwd(), "src/lib/financeCostCenterClassificationRules.ts"),
      "utf8"
    );
    assert.match(lib, /matchedTitlesCount/);
    assert.match(lib, /FINANCE_CLASSIFICATION_RULE_AUDIT_ACTION.APPLY/);

    const detail = readFileSync(join(process.cwd(), "src/lib/financeCostCenterDetailShared.ts"), "utf8");
    assert.match(detail, /allocationRuleName/);

    const ui = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceGeneralClassificationRulesPanel.tsx"),
      "utf8"
    );
    assert.match(ui, /Preview/);
    assert.match(ui, /Confirmar aplicação/);
  });

  it("12-14. não altera AP oficial e não reintroduz Prisma no frontend", () => {
    const allocation = readFileSync(
      join(process.cwd(), "src/lib/financeAccountsPayableCostCenterAllocation.ts"),
      "utf8"
    );
    assert.doesNotMatch(allocation, /nomusAccountsPayable\.update/);
    assert.doesNotMatch(allocation, /personName:\s*"/);

    const panel = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceGeneralClassificationRulesPanel.tsx"),
      "utf8"
    );
    assert.doesNotMatch(panel, /@prisma\/client/);
    assert.doesNotMatch(panel, /lib\/prisma/);
  });
});
