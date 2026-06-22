import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT } from "./financeApAllocationShared.js";
import {
  FINANCE_CLI_SCRIPT_PATHS,
  scriptTouchesNomusAccountsPayable,
} from "./financeCostCenterScriptsCli.js";
import { FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT } from "./financeSupplierRebuildShared.js";
import { runFinanceCostCenterIntegrityCheck } from "./financeCostCenterIntegrityCheck.js";
import type {
  FinanceIntegrityAllocationRow,
  FinanceIntegrityDeps,
  FinanceIntegrityRuleRow,
} from "./financeCostCenterIntegrityCheck.js";

const ROOT = process.cwd();

function readScript(rel: string): string {
  const path = join(ROOT, rel);
  assert.ok(existsSync(path), `script ausente: ${rel}`);
  return readFileSync(path, "utf8");
}

function readAllFinanceCliScripts(): string {
  return Object.values(FINANCE_CLI_SCRIPT_PATHS)
    .map((rel) => readScript(rel))
    .join("\n");
}

describe("financeCostCenterScripts", () => {
  it("scripts CLI existem no repositório", () => {
    for (const rel of Object.values(FINANCE_CLI_SCRIPT_PATHS)) {
      assert.ok(existsSync(join(ROOT, rel)), rel);
    }
  });

  it("confirmações textuais obrigatórias estão documentadas nos scripts apply", () => {
    const suppliersApply = readScript(FINANCE_CLI_SCRIPT_PATHS.suppliersApply);
    const classificationApply = readScript(FINANCE_CLI_SCRIPT_PATHS.classificationApply);

    assert.match(suppliersApply, new RegExp(FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT));
    assert.match(classificationApply, new RegExp(FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT));
    assert.match(suppliersApply, /--confirm=/);
    assert.match(classificationApply, /--confirm=/);
    assert.match(suppliersApply, /logDryRunApplyRequired/);
    assert.match(classificationApply, /logDryRunApplyRequired/);
  });

  it("scripts apply não executam apply sem --confirm", () => {
    const suppliersApply = readScript(FINANCE_CLI_SCRIPT_PATHS.suppliersApply);
    const classificationApply = readScript(FINANCE_CLI_SCRIPT_PATHS.classificationApply);

    assert.match(suppliersApply, /if \(!confirm\)/);
    assert.match(classificationApply, /if \(!confirm\)/);
    assert.doesNotMatch(suppliersApply, /applyFinancialSuppliersFromAccountsPayableDefault\([\s\S]*?\)[\s\S]*?parseConfirmArg/);
    assert.doesNotMatch(classificationApply, /applyBatchAccountsPayableAllocationDefault\([\s\S]*?\)[\s\S]*?parseConfirmArg/);
  });

  it("scripts não alteram NomusAccountsPayable (sem update/delete/create)", () => {
    const combined = readAllFinanceCliScripts();
    assert.equal(scriptTouchesNomusAccountsPayable(combined), false);
    assert.doesNotMatch(combined, /nomusAccountsPayableSync/);
    assert.doesNotMatch(combined, /sync:nomus:accounts-payable/);
  });

  it("scripts de classificação não alteram títulos AP oficiais", () => {
    const allocationSrc = readFileSync(
      join(ROOT, "src/lib/financeAccountsPayableCostCenterAllocation.ts"),
      "utf8"
    );
    assert.doesNotMatch(allocationSrc, /nomusAccountsPayable\.update/);
    assert.doesNotMatch(allocationSrc, /nomusAccountsPayable\.delete/);
  });

  it("logs esperados nos scripts preview e integrity", () => {
    const suppliersPreview = readScript(FINANCE_CLI_SCRIPT_PATHS.suppliersPreview);
    const classificationPreview = readScript(FINANCE_CLI_SCRIPT_PATHS.classificationPreview);
    const integrity = readScript(FINANCE_CLI_SCRIPT_PATHS.integrityCheck);

    assert.match(suppliersPreview, /FINANCE_CLI_LOG_PREFIX\.suppliersPreview/);
    assert.match(classificationPreview, /FINANCE_CLI_LOG_PREFIX\.classificationPreview/);
    assert.match(integrity, /FINANCE_CLI_LOG_PREFIX\.integrityCheck/);
    assert.match(suppliersPreview, /Fornecedores detectados/);
    assert.match(classificationPreview, /Manuais preservados/);
    assert.match(classificationPreview, /Sem regra aplicável/);
  });

  it("integrity check cobre principais regras de consistência", async () => {
    const allocations: FinanceIntegrityAllocationRow[] = [
      {
        id: "a1",
        accountsPayableId: 100,
        supplierId: null,
        costCenterId: "cc-1",
        amount: null,
        percentage: { toNumber: () => 100 } as FinanceIntegrityAllocationRow["percentage"],
      },
      {
        id: "orphan",
        accountsPayableId: 999,
        supplierId: "sup-1",
        costCenterId: "cc-2",
        amount: null,
        percentage: { toNumber: () => 100 } as FinanceIntegrityAllocationRow["percentage"],
      },
    ];
    const rules: FinanceIntegrityRuleRow[] = [
      {
        id: "rule-1",
        supplierId: "sup-inactive",
        costCenterId: "cc-inactive",
        isActive: true,
        supplierStatus: "INACTIVE",
        costCenterStatus: "INACTIVE",
      },
    ];
    const deps: FinanceIntegrityDeps = {
      loadAllocations: async () => allocations,
      loadApByExternalId: async (externalId) =>
        externalId === 100
          ? {
              externalId: 100,
              balancePayable: 1000,
              amountPayable: 1000,
            }
          : null,
      loadActiveRulesWithMeta: async () => rules,
    };

    const report = await runFinanceCostCenterIntegrityCheck(deps);
    const codes = new Set(report.issues.map((issue) => issue.code));

    assert.ok(codes.has("ORPHAN_ALLOCATION"));
    assert.ok(codes.has("CLASSIFIED_WITHOUT_SUPPLIER"));
    assert.ok(codes.has("ACTIVE_RULE_INACTIVE_COST_CENTER"));
    assert.ok(codes.has("ACTIVE_RULE_INACTIVE_SUPPLIER"));
  });

  it("integrity check detecta percentual diferente de 100%", async () => {
    const deps: FinanceIntegrityDeps = {
      loadAllocations: async () => [
        {
          id: "pct",
          accountsPayableId: 200,
          supplierId: "sup-1",
          costCenterId: "cc-1",
          amount: null,
          percentage: { toNumber: () => 60 } as FinanceIntegrityAllocationRow["percentage"],
        },
      ],
      loadApByExternalId: async () => ({
        externalId: 200,
        balancePayable: 500,
        amountPayable: 500,
      }),
      loadActiveRulesWithMeta: async () => [],
    };

    const report = await runFinanceCostCenterIntegrityCheck(deps);
    assert.ok(
      report.issues.some((issue) => issue.code === "ALLOCATION_PERCENTAGE_MISMATCH")
    );
  });

  it("integrity check detecta valor alocado diferente do título", async () => {
    const deps: FinanceIntegrityDeps = {
      loadAllocations: async () => [
        {
          id: "amt",
          accountsPayableId: 300,
          supplierId: "sup-1",
          costCenterId: "cc-1",
          amount: { toNumber: () => 50 } as FinanceIntegrityAllocationRow["amount"],
          percentage: { toNumber: () => 100 } as FinanceIntegrityAllocationRow["percentage"],
        },
      ],
      loadApByExternalId: async () => ({
        externalId: 300,
        balancePayable: 1000,
        amountPayable: 1000,
      }),
      loadActiveRulesWithMeta: async () => [],
    };

    const report = await runFinanceCostCenterIntegrityCheck(deps);
    assert.ok(report.issues.some((issue) => issue.code === "ALLOCATION_AMOUNT_MISMATCH"));
  });

  it("preview scripts são read-only (não importam apply)", () => {
    const suppliersPreview = readScript(FINANCE_CLI_SCRIPT_PATHS.suppliersPreview);
    const classificationPreview = readScript(FINANCE_CLI_SCRIPT_PATHS.classificationPreview);

    assert.doesNotMatch(suppliersPreview, /applyFinancialSuppliersFromAccountsPayable/);
    assert.doesNotMatch(classificationPreview, /applyBatchAccountsPayableAllocation/);
  });
});
