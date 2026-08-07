/**
 * Caracterização do módulo avançado da Tesouraria antes do fluxo diário simples.
 * Congela handlers, rotas UI, flags, permissões e invariantes de domínio
 * para impedir remoção acidental durante a simplificação de UX.
 *
 * Não implementa a nova interface — apenas protege o que já funciona.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TREASURY_ACCOUNTS_PATH,
  TREASURY_AGENDA_PATH,
  TREASURY_API_PREFIX,
  TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
  TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH,
  TREASURY_DAILY_CLOSING_PATH,
  TREASURY_DAILY_CLOSING_PREVIEW_PATH,
  TREASURY_DASHBOARD_PATH,
  TREASURY_FORECAST_VS_ACTUAL_PATH,
  TREASURY_LEDGER_ENTRIES_PATH,
  TREASURY_PROJECTION_LAYERS,
  TREASURY_PROJECTIONS_PATH,
  TREASURY_RECONCILE_WORKSPACE_PATH,
  TREASURY_RECONCILIATIONS_PATH,
  TREASURY_TRANSFERS_PATH,
} from "./contracts/treasuryContracts.js";
import { TREASURY_PROJECTION_LAYERS as ENUM_LAYERS } from "./contracts/treasuryEnums.js";
import {
  TREASURY_FINANCIAL_PRECEDENCE,
  resolveTreasuryFinancialIdentities,
  treasuryTransferConsolidatedImpact,
  type TreasuryFinancialClaim,
} from "./domain/treasuryFinancialIdentityRules.js";
import { planTreasuryDailyClosingReopen } from "./domain/treasuryDailyClosingRules.js";
import { assertTreasuryManualLedgerReversible } from "./domain/treasuryManualLedgerRules.js";
import { TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL } from "./domain/treasuryReconciliationMatchRules.js";
import {
  TREASURY_FEATURE_FLAG_ENV,
  TREASURY_FEATURE_FLAG_IDS,
  TREASURY_MASTER_DEFAULT_WHEN_ABSENT,
  isTreasuryModuleEnabled,
} from "./treasuryFeatureFlags.js";
import {
  TREASURY_LEGACY_BAG_KEYS,
  TREASURY_RESOURCE_KEYS,
} from "./treasuryAccess.js";
import { TREASURY_UI_SECTIONS } from "../../components/finance/treasury/treasuryFeatureUi.js";
import {
  TREASURY_UI_ADVANCED_SECTIONS,
  TREASURY_UI_PRIMARY_SECTIONS,
} from "./treasurySimpleNavigation.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

/** +3 GET: cash-support, cash-support/summary, cash-support/suggestions (CS-006/008). */
const EXPECTED_HTTP_HANDLERS = 102;
/** home + 4 primárias + 16 avançadas (+1: cash-support) + hub advanced */
const EXPECTED_UI_SECTIONS = 23;
const EXPECTED_FEATURE_FLAGS = 15;
const EXPECTED_RESOURCE_KEYS = 18;
const EXPECTED_LEGACY_BAGS = 28;

const REQUIRED_ADVANCED_UI_PATHS = [
  "/finance/treasury",
  "/finance/treasury/today",
  "/finance/treasury/accounts",
  "/finance/treasury/bank",
  "/finance/treasury/projection",
  "/finance/treasury/advanced",
  "/finance/treasury/receivables",
  "/finance/treasury/payables",
  "/finance/treasury/agenda",
  "/finance/treasury/projections",
  "/finance/treasury/payment-schedule",
  "/finance/treasury/transfers",
  "/finance/treasury/manual-entries",
  "/finance/treasury/bank-movements",
  "/finance/treasury/ofx",
  "/finance/treasury/reconcile",
  "/finance/treasury/exceptions",
  "/finance/treasury/alert-settings",
  "/finance/treasury/closing",
  "/finance/treasury/reports",
  "/finance/treasury/audit",
] as const;

const REQUIRED_ROUTE_CONSTANT_NAMES = [
  "TREASURY_DASHBOARD_PATH",
  "TREASURY_FORECAST_VS_ACTUAL_PATH",
  "TREASURY_ACCOUNTS_PATH",
  "TREASURY_AGENDA_PATH",
  "TREASURY_PROJECTIONS_PATH",
  "TREASURY_TRANSFERS_PATH",
  "TREASURY_LEDGER_ENTRIES_PATH",
  "TREASURY_DAILY_CLOSING_PATH",
  "TREASURY_DAILY_CLOSING_PREVIEW_PATH",
  "TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH",
  "TREASURY_BANK_IMPORTS_OFX_APPLY_PATH",
  "TREASURY_RECONCILIATIONS_PATH",
  "TREASURY_RECONCILE_WORKSPACE_PATH",
] as const;

const REQUIRED_API_PATHS = [
  TREASURY_DASHBOARD_PATH,
  TREASURY_FORECAST_VS_ACTUAL_PATH,
  TREASURY_ACCOUNTS_PATH,
  TREASURY_AGENDA_PATH,
  TREASURY_PROJECTIONS_PATH,
  TREASURY_TRANSFERS_PATH,
  TREASURY_LEDGER_ENTRIES_PATH,
  TREASURY_DAILY_CLOSING_PATH,
  TREASURY_DAILY_CLOSING_PREVIEW_PATH,
  TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH,
  TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
  TREASURY_RECONCILIATIONS_PATH,
  TREASURY_RECONCILE_WORKSPACE_PATH,
] as const;

function claim(
  partial: Partial<TreasuryFinancialClaim> &
    Pick<TreasuryFinancialClaim, "id" | "source" | "amount">
): TreasuryFinancialClaim {
  return {
    side: "AR",
    installmentNumber: 1,
    officialTitleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    nomusExternalId: 9001,
    ...partial,
  };
}

describe("treasurySimpleDailyFlow — preservação do módulo avançado", () => {
  it("documentação canônica do fluxo simples existe", () => {
    const doc = join(repoRoot, "docs/treasury/SIMPLE-DAILY-FLOW.md");
    assert.equal(existsSync(doc), true);
    const body = readFileSync(doc, "utf8");
    assert.match(body, /Nomus como fonte oficial|Fonte oficial dos títulos/i);
    assert.match(body, /saldo final previsto/i);
    assert.match(body, /saldo final realizado calculado/i);
    assert.match(body, /divergência/i);
    assert.match(body, /OFX/);
    assert.match(body, /Preservação dos recursos avançados/i);
    assert.match(body, /não soma novamente/i);
  });

  it("congela ~97 handlers HTTP em treasuryRoutes", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    const handlers = [...routes.matchAll(/app\.(get|post|put|patch|delete)\(/g)];
    assert.equal(
      handlers.length,
      EXPECTED_HTTP_HANDLERS,
      `handlers mudaram: esperado ${EXPECTED_HTTP_HANDLERS}, atual ${handlers.length}`
    );
    for (const name of REQUIRED_ROUTE_CONSTANT_NAMES) {
      assert.match(routes, new RegExp(name));
    }
    assert.equal(TREASURY_API_PREFIX, "/api/finance/treasury");
    for (const path of REQUIRED_API_PATHS) {
      assert.ok(path.startsWith(TREASURY_API_PREFIX), path);
    }
  });

  it("congela rotas avançadas da UI (TreasuryModule + seções)", () => {
    assert.equal(TREASURY_UI_SECTIONS.length, EXPECTED_UI_SECTIONS);
    assert.equal(TREASURY_UI_PRIMARY_SECTIONS.length, 2);
    assert.ok(TREASURY_UI_ADVANCED_SECTIONS.length >= 15);
    const paths = new Set(TREASURY_UI_SECTIONS.map((s) => s.path));
    for (const path of REQUIRED_ADVANCED_UI_PATHS) {
      assert.ok(paths.has(path), `seção UI ausente: ${path}`);
    }

    const moduleSource = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(moduleSource, /TREASURY_UI_PRIMARY_SECTIONS/);
    for (const fragment of [
      "today",
      "accounts",
      "bank",
      "projection",
      "advanced",
      "receivables",
      "payables",
      "payment-schedule",
      "agenda",
      "projections",
      "transfers",
      "manual-entries",
      "bank-movements",
      "ofx",
      "reconcile",
      "exceptions",
      "alert-settings",
      "closing",
      "reports",
      "audit",
    ]) {
      assert.match(moduleSource, new RegExp(`path="${fragment}`));
    }
  });

  it("congela feature flags mestra + subflags (opt-in)", () => {
    assert.equal(TREASURY_FEATURE_FLAG_IDS.length, EXPECTED_FEATURE_FLAGS);
    assert.equal(TREASURY_MASTER_DEFAULT_WHEN_ABSENT, false);
    assert.equal(isTreasuryModuleEnabled({}), false);
    assert.equal(
      isTreasuryModuleEnabled({ TREASURY_MODULE_ENABLED: "1" }),
      true
    );
    for (const id of TREASURY_FEATURE_FLAG_IDS) {
      assert.ok(TREASURY_FEATURE_FLAG_ENV[id], id);
    }
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.ofxImport.enabled"));
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.dailyClosing.enabled"));
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.reconciliation.enabled"));
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.projection.enabled"));
  });

  it("congela permissões finance.treasury*", () => {
    assert.equal(Object.keys(TREASURY_RESOURCE_KEYS).length, EXPECTED_RESOURCE_KEYS);
    assert.equal(TREASURY_LEGACY_BAG_KEYS.length, EXPECTED_LEGACY_BAGS);
    assert.equal(TREASURY_RESOURCE_KEYS.root, "finance.treasury");
    assert.equal(TREASURY_RESOURCE_KEYS.closing, "finance.treasury.closing");
    assert.equal(
      TREASURY_RESOURCE_KEYS.reconciliation,
      "finance.treasury.reconciliation"
    );
    assert.ok(TREASURY_LEGACY_BAG_KEYS.includes("finance.treasury.view"));
    assert.ok(TREASURY_LEGACY_BAG_KEYS.includes("finance.treasury.closing.close"));
    assert.ok(
      TREASURY_LEGACY_BAG_KEYS.includes("finance.treasury.reconciliation.manage")
    );
  });

  it("adapter Nomus permanece read-only (sem mutação)", () => {
    const adapter = readFileSync(
      join(here, "adapters/treasuryOfficialTitlesAdapter.server.ts"),
      "utf8"
    );
    assert.match(adapter, /sem cópia\/upsert|read-only|Projeta Official/i);
    assert.doesNotMatch(adapter, /\.(create|update|upsert|delete|createMany)\s*\(/);

    const officialRepo = readFileSync(
      join(here, "repositories/treasuryOfficialTitlesRepository.server.ts"),
      "utf8"
    );
    assert.doesNotMatch(
      officialRepo,
      /nomusAccounts(Receivable|Payable)\.(create|update|upsert|delete)/i
    );
  });

  it("OFX apply é idempotente por fingerprint / fileSha256", () => {
    const apply = readFileSync(
      join(here, "services/treasuryBankImportOfxApplyService.server.ts"),
      "utf8"
    );
    assert.match(apply, /Idempotente|idempotent/i);
    assert.match(apply, /fileSha256/);
    assert.match(apply, /fingerprint/);
    assert.match(apply, /EXISTING_FILE|EXISTING_MOVEMENT/);

    const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
    assert.match(schema, /model TreasuryBankImportBatch/);
    assert.match(schema, /model TreasuryBankMovement/);
    assert.match(schema, /fingerprint/);
  });

  it("conciliação não realiza baixa Nomus", () => {
    assert.equal(TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL, true);
    const service = readFileSync(
      join(here, "services/treasuryReconciliationMatchService.server.ts"),
      "utf8"
    );
    assert.match(service, /TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL/);
    assert.match(service, /doesNotRealizeOfficial:\s*true/);
    assert.doesNotMatch(
      service,
      /nomusAccounts(Receivable|Payable)\.(update|upsert)/i
    );
  });

  it("fechamento diário é versionado (reabertura cria nova versão)", () => {
    const plan = planTreasuryDailyClosingReopen({
      current: {
        id: "closing-1",
        companyCode: "INDUS",
        civilDate: "2026-07-28",
        version: 1,
        status: "CLOSED",
        sourceHash: "hash-v1",
      },
      reason: "Correção operacional pós-fechamento",
    });
    assert.equal(plan.nextVersion, 2);
    assert.equal(plan.previousStatus, "REOPENED");
    assert.equal(plan.newStatus, "OPEN");

    const rules = readFileSync(
      join(here, "domain/treasuryDailyClosingRules.ts"),
      "utf8"
    );
    assert.match(rules, /versão|version/i);
    assert.match(rules, /REOPENED/);

    const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
    assert.match(schema, /model TreasuryDailyClosing/);
    assert.match(schema, /model TreasuryDailyClosingAccountPosition/);
  });

  it("ledger manual não permite exclusão física (só reversão)", () => {
    assert.throws(() =>
      assertTreasuryManualLedgerReversible({
        status: "REVERSED",
        nature: "MANUAL",
        expectedVersion: 1,
        currentVersion: 1,
      })
    );
    assert.doesNotThrow(() =>
      assertTreasuryManualLedgerReversible({
        status: "ACTIVE",
        nature: "MANUAL",
        expectedVersion: 1,
        currentVersion: 1,
      })
    );

    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.match(routes, /TREASURY_LEDGER_ENTRIES_PATH/);
    assert.match(routes, /manualLedger\.reverse/);
    assert.doesNotMatch(
      routes,
      /app\.delete\(\s*TREASURY_LEDGER_ENTRIES_PATH/
    );

    const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
    assert.match(schema, /model TreasuryLedgerEntry/);
    assert.match(schema, /REVERSED/);
  });

  it("transferências internas são neutras no consolidado", () => {
    const net = treasuryTransferConsolidatedImpact([
      { amount: "1500.00", sign: -1 },
      { amount: "1500.00", sign: 1 },
    ]);
    assert.equal(net, "0.00");

    const transferService = readFileSync(
      join(here, "services/treasuryTransferService.server.ts"),
      "utf8"
    );
    assert.match(transferService, /transferGroupId/);
    assert.equal(existsSync(join(here, "domain/treasuryTransferRules.ts")), true);
  });

  it("projeção atual preserva camadas e motor", () => {
    assert.deepEqual([...ENUM_LAYERS], [
      "CONTRACTUAL",
      "PROBABLE",
      "CONFIRMED",
      "MANUAL",
    ]);
    assert.deepEqual([...TREASURY_PROJECTION_LAYERS], [...ENUM_LAYERS]);

    const engine = join(here, "domain/treasuryProjectionEngine.ts");
    assert.equal(existsSync(engine), true);
    const engineSrc = readFileSync(engine, "utf8");
    assert.match(engineSrc, /TreasuryProjectionLayer/);
    assert.match(engineSrc, /scenario:/);
    assert.match(engineSrc, /minimumBalance/);
    assert.match(engineSrc, /riskCode/);
    assert.match(engineSrc, /TREASURY_PROJECTION_ALGORITHM_VERSION/);

    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.match(routes, /projections\.calculate/);
    assert.match(routes, /projections\.getAgenda/);
    assert.match(routes, /projections\.compareScenarios/);
  });

  it("anti-duplicidade: realizado suprime previsto; conciliado vence baixa", () => {
    assert.ok(
      TREASURY_FINANCIAL_PRECEDENCE.RECONCILED_MOVEMENT <
        TREASURY_FINANCIAL_PRECEDENCE.OFFICIAL_SETTLEMENT
    );
    assert.ok(
      TREASURY_FINANCIAL_PRECEDENCE.OFFICIAL_SETTLEMENT <
        TREASURY_FINANCIAL_PRECEDENCE.FORECAST
    );

    const titleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const settledVsForecast = resolveTreasuryFinancialIdentities([
      claim({
        id: "settled",
        source: "OFFICIAL_SETTLEMENT",
        amount: "100.00",
        settledAmount: "100.00",
        openBalance: "0.00",
        officialTitleId: titleId,
      }),
      claim({
        id: "forecast",
        source: "FORECAST",
        amount: "100.00",
        openBalance: "0.00",
        officialTitleId: titleId,
      }),
    ]);
    const cashIds = settledVsForecast.slices
      .filter((s) => s.includeInCashProjection)
      .map((s) => s.claimId);
    assert.deepEqual(cashIds, ["settled"]);
    assert.ok(settledVsForecast.suppressedClaimIds.includes("forecast"));
    assert.equal(settledVsForecast.consolidatedCashTotal, "100.00");

    const reconciledWins = resolveTreasuryFinancialIdentities([
      claim({
        id: "reconciled",
        source: "RECONCILED_MOVEMENT",
        amount: "80.00",
        settledAmount: "80.00",
        reconciliationMatchId: "m1",
        officialTitleId: titleId,
      }),
      claim({
        id: "baixa",
        source: "OFFICIAL_SETTLEMENT",
        amount: "80.00",
        settledAmount: "80.00",
        officialTitleId: titleId,
      }),
    ]);
    assert.equal(reconciledWins.consolidatedCashTotal, "80.00");
    assert.ok(reconciledWins.suppressedClaimIds.includes("baixa"));
  });

  it("shell e controllers avançados permanecem no repositório", () => {
    assert.ok(
      existsSync(join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"))
    );
    const controllers = readdirSync(join(here, "controllers")).filter((f) =>
      f.endsWith(".ts")
    );
    assert.ok(controllers.length >= 20, `controllers=${controllers.length}`);
    for (const name of [
      "treasuryDashboardController.ts",
      "treasuryDailyClosingController.ts",
      "treasuryBankImportOfxApplyController.ts",
      "treasuryReconciliationMatchController.ts",
      "treasuryProjectionController.ts",
      "treasuryTransferController.ts",
      "treasuryManualLedgerController.ts",
    ]) {
      assert.ok(existsSync(join(here, "controllers", name)), name);
    }
  });

  it("nenhum model Treasury* avançado foi removido; rotina diária é domínio reutilizável", () => {
    const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
    for (const model of [
      "TreasuryFinancialAccount",
      "TreasuryBalanceSnapshot",
      "TreasuryAuditLog",
      "TreasuryLedgerEntry",
      "TreasuryTransfer",
      "TreasuryDailyClosing",
      "TreasuryDailyClosingAccountPosition",
      "TreasuryBankImportBatch",
      "TreasuryBankMovement",
      "TreasuryReconciliationMatch",
      "TreasuryProjectionRun",
      "TreasuryException",
    ]) {
      assert.match(schema, new RegExp(`model ${model}\\b`));
    }
    assert.doesNotMatch(schema, /model TreasuryDailyAccountRoutine\b/);
    assert.ok(
      existsSync(join(here, "domain/treasuryDailyAccountRoutineRules.ts"))
    );
    assert.ok(existsSync(join(here, "domain/treasuryDailyCashEngine.ts")));
    assert.ok(existsSync(join(here, "domain/treasuryGuidedTodayRules.ts")));
    assert.ok(
      existsSync(
        join(
          repoRoot,
          "src/components/finance/treasury/TreasuryTodayPage.tsx"
        )
      )
    );
    assert.match(
      readFileSync(join(here, "contracts/treasuryConstants.ts"), "utf8"),
      /TREASURY_TODAY_PATH/
    );
  });
});
