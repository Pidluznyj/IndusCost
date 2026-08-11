/**
 * Regressão — capacidades avançadas da Tesouraria permanecem disponíveis.
 *
 * A simplificação da UX padrão (abas principais) NÃO pode remover:
 * models, migrations, handlers, services, repositories, adapters,
 * rotas avançadas, contratos, flags, permissões nem deep-links.
 *
 * Complementa treasurySimpleDailyFlow.characterization.test.ts com
 * congelamento explícito de superfície API/UI/banco/shell.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TREASURY_ACCOUNTS_PATH,
  TREASURY_AGENDA_PATH,
  TREASURY_ALERT_SETTINGS_PATH,
  TREASURY_ALERTS_PATH,
  TREASURY_API_PREFIX,
  TREASURY_AUDIT_PATH,
  TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
  TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH,
  TREASURY_BANK_IMPORTS_PATH,
  TREASURY_BANK_MOVEMENTS_PATH,
  TREASURY_COLLECTION_ACTIONS_PATH,
  TREASURY_DAILY_CLOSING_PATH,
  TREASURY_DAILY_CLOSING_PREVIEW_PATH,
  TREASURY_DASHBOARD_PATH,
  TREASURY_DISPUTES_PATH,
  TREASURY_EXCEPTIONS_PATH,
  TREASURY_FORECAST_VS_ACTUAL_PATH,
  TREASURY_LEDGER_ENTRIES_PATH,
  TREASURY_PAYABLES_PATH,
  TREASURY_PAYMENT_SCHEDULE_PATH,
  TREASURY_PROJECTIONS_PATH,
  TREASURY_PROMISES_PATH,
  TREASURY_RECEIVABLES_PATH,
  TREASURY_RECONCILE_WORKSPACE_PATH,
  TREASURY_RECONCILIATIONS_PATH,
  TREASURY_REPORTS_PATH,
  TREASURY_TRANSFERS_PATH,
} from "./contracts/treasuryContracts.js";
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
import {
  canAccessTreasuryAdvancedNavigation,
  isTreasuryAdvancedPath,
  isTreasuryPrimaryPath,
  TREASURY_ADVANCED_NAV_ROLES,
  TREASURY_UI_ADVANCED_HUB_PATH,
  TREASURY_UI_ADVANCED_SECTIONS,
  TREASURY_UI_PRIMARY_SECTIONS,
} from "./treasurySimpleNavigation.js";
import {
  TREASURY_UI_BASE_PATH,
  TREASURY_UI_SECTIONS,
} from "../../components/finance/treasury/treasuryFeatureUi.js";
import { TREASURY_UI_SECTION_FEATURE_FLAG } from "./treasuryRollout.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const treasuryRoot = here;
const modulePath = join(
  repoRoot,
  "src/components/finance/treasury/TreasuryModule.tsx"
);
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationsDir = join(repoRoot, "prisma/migrations");

/** Congelamento — superfície HTTP.
 *  +1 GET (total 99, get 53) para GET /api/treasury/caixa/scenarios,
 *  endpoint único dos três cenários da Caixa (Fase 4 da consolidação). */
const EXPECTED_HTTP_HANDLERS = {
  // +3 GET: cash-support, cash-support/summary, cash-support/suggestions (CS-006/008).
  // +2 GET +1 POST: Conciliação Bancária — title-grid, history (leitura) e
  // auto-reconcile (escrita idempotente de matches locais; nunca baixa oficial).
  total: 105,
  get: 58,
  post: 41,
  put: 4,
  patch: 2,
  delete: 0,
} as const;

const EXPECTED_TREASURY_MODELS = [
  "TreasuryFinancialAccount",
  "TreasuryFinancialAccountAccess",
  "TreasuryBalanceSnapshot",
  "TreasuryAuditLog",
  "TreasuryTitleOperationalComplement",
  "TreasuryPaymentPromise",
  "TreasuryCollectionAction",
  "TreasuryDispute",
  "TreasuryProjectionRun",
  "TreasuryProjectionDayLine",
  "TreasuryProjectionCompositionItem",
  "TreasuryProjectionRecalcJob",
  "TreasuryLedgerEntry",
  "TreasuryTransfer",
  "TreasuryException",
  "TreasuryAlertSettings",
  "TreasuryDailyClosing",
  "TreasuryDailyClosingAccountPosition",
  "TreasuryDailyClosingFrozenPendency",
  "TreasuryDailyClosingFrozenException",
  "TreasuryDailyClosingCaveat",
  "TreasuryDailyClosingReopening",
  "TreasuryBankImportBatch",
  "TreasuryBankMovement",
  "TreasuryReconciliationMatch",
  "TreasuryReconciliationMatchMovement",
  "TreasuryReconciliationAllocation",
  // Adicionado na consolidação dos cenários da Caixa (Fase 2 —
  // política persistida, singleton "GLOBAL", auditada via TreasuryAuditLog).
  "TreasuryScenarioPolicy",
] as const;

// +1: 20260905120000_treasury_reconciliation_idempotency (aditiva — ADD COLUMN + CREATE INDEX).
const EXPECTED_TREASURY_MIGRATIONS_WITH_MODEL = 21;

const EXPECTED_LAYER_COUNTS = {
  controllersMin: 27,
  servicesMin: 30,
  repositoriesMin: 35,
  adaptersMin: 3,
} as const;

/** Rotas frontend “antigas” / deep-links — devem permanecer registradas e gated. */
const ADVANCED_UI_DEEP_LINKS: ReadonlyArray<{
  pathFragment: string;
  pageComponent: string;
  sectionId: string | null;
}> = [
  { pathFragment: "dashboard", pageComponent: "TreasuryDashboardPage", sectionId: null },
  { pathFragment: "advanced", pageComponent: "TreasuryAdvancedHubPage", sectionId: null },
  {
    pathFragment: "receivables",
    pageComponent: "TreasuryReceivablesPage",
    sectionId: "receivables",
  },
  {
    pathFragment: "payables",
    pageComponent: "TreasuryPayablesPage",
    sectionId: "payables",
  },
  {
    pathFragment: "payment-schedule",
    pageComponent: "TreasuryPaymentSchedulePage",
    sectionId: "payment-schedule",
  },
  { pathFragment: "agenda", pageComponent: "TreasuryAgendaPage", sectionId: "agenda" },
  {
    pathFragment: "projections",
    pageComponent: "TreasuryProjectionComparisonPage",
    sectionId: "projections",
  },
  {
    pathFragment: "transfers",
    pageComponent: "TreasuryTransfersPage",
    sectionId: "transfers",
  },
  {
    pathFragment: "manual-entries",
    pageComponent: "TreasuryManualEntriesPage",
    sectionId: "manual-entries",
  },
  {
    pathFragment: "bank-movements",
    pageComponent: "TreasuryBankMovementsPage",
    sectionId: "bank-movements",
  },
  { pathFragment: "ofx", pageComponent: "TreasuryBankMovementsPage", sectionId: "ofx" },
  {
    pathFragment: "reconcile",
    pageComponent: "TreasuryReconcileWorkspacePage",
    sectionId: "reconcile",
  },
  {
    pathFragment: "exceptions",
    pageComponent: "TreasuryExceptionsPage",
    sectionId: "exceptions",
  },
  {
    pathFragment: "alert-settings",
    pageComponent: "TreasuryAlertSettingsPage",
    sectionId: "alert-settings",
  },
  {
    pathFragment: "closing",
    pageComponent: "TreasuryDailyClosingPage",
    sectionId: "closing",
  },
  { pathFragment: "reports", pageComponent: "TreasuryReportsPage", sectionId: "reports" },
  { pathFragment: "audit", pageComponent: "TreasuryAuditPage", sectionId: "audit" },
];

const REQUIRED_API_PATHS = [
  TREASURY_DASHBOARD_PATH,
  TREASURY_ACCOUNTS_PATH,
  TREASURY_RECEIVABLES_PATH,
  TREASURY_PAYABLES_PATH,
  TREASURY_PROMISES_PATH,
  TREASURY_COLLECTION_ACTIONS_PATH,
  TREASURY_DISPUTES_PATH,
  TREASURY_AGENDA_PATH,
  TREASURY_PROJECTIONS_PATH,
  TREASURY_PAYMENT_SCHEDULE_PATH,
  TREASURY_TRANSFERS_PATH,
  TREASURY_LEDGER_ENTRIES_PATH,
  TREASURY_EXCEPTIONS_PATH,
  TREASURY_ALERTS_PATH,
  TREASURY_ALERT_SETTINGS_PATH,
  TREASURY_DAILY_CLOSING_PATH,
  TREASURY_DAILY_CLOSING_PREVIEW_PATH,
  TREASURY_FORECAST_VS_ACTUAL_PATH,
  TREASURY_BANK_IMPORTS_PATH,
  TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH,
  TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
  TREASURY_BANK_MOVEMENTS_PATH,
  TREASURY_RECONCILIATIONS_PATH,
  TREASURY_RECONCILE_WORKSPACE_PATH,
  TREASURY_REPORTS_PATH,
  TREASURY_AUDIT_PATH,
] as const;

const REQUIRED_SERVICE_FILES = [
  "treasuryPaymentPromiseService.server.ts",
  "treasuryCollectionActionService.server.ts",
  "treasuryDisputeService.server.ts",
  "treasuryTransferService.server.ts",
  "treasuryDailyClosingService.server.ts",
  "treasuryExceptionService.server.ts",
  "treasuryReportService.server.ts",
  "treasuryAuditService.server.ts",
  "treasuryBankImportOfxPreviewService.server.ts",
  "treasuryBankImportOfxApplyService.server.ts",
  "treasuryReconciliationMatchService.server.ts",
  "treasuryProjectionExecutionService.server.ts",
  "treasuryProjectionApiService.server.ts",
] as const;

const REQUIRED_REPOSITORY_FILES = [
  "treasuryPaymentPromiseRepository.server.ts",
  "treasuryDisputeRepository.server.ts",
  "treasuryLedgerEntryRepository.server.ts",
  "treasuryTransferRepository.server.ts",
  "treasuryExceptionRepository.server.ts",
  "treasuryReconciliationMatchRepository.server.ts",
  "treasuryOfficialTitlesRepository.server.ts",
] as const;

const REQUIRED_ADAPTER_FILES = [
  "treasuryOfficialTitlesAdapter.server.ts",
] as const;

function countHandlers(routesSrc: string) {
  const counts = { get: 0, post: 0, put: 0, patch: 0, delete: 0 };
  for (const m of routesSrc.matchAll(/app\.(get|post|put|patch|delete)\(/g)) {
    counts[m[1] as keyof typeof counts] += 1;
  }
  return {
    ...counts,
    total: counts.get + counts.post + counts.put + counts.patch + counts.delete,
  };
}

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}

function migrationsTouchingTreasury(): string[] {
  return readdirSync(migrationsDir)
    .filter((d) => statSync(join(migrationsDir, d)).isDirectory())
    .filter((d) => {
      try {
        return readFileSync(
          join(migrationsDir, d, "migration.sql"),
          "utf8"
        ).includes("Treasury");
      } catch {
        return false;
      }
    })
    .sort();
}

describe("treasury advanced capabilities — API handlers", () => {
  it("quantidade e métodos HTTP permanecem iguais (105 = 58/41/4/2/0)", () => {
    const routesSrc = readFileSync(join(treasuryRoot, "treasuryRoutes.ts"), "utf8");
    const counts = countHandlers(routesSrc);
    assert.equal(counts.total, EXPECTED_HTTP_HANDLERS.total);
    assert.equal(counts.get, EXPECTED_HTTP_HANDLERS.get);
    assert.equal(counts.post, EXPECTED_HTTP_HANDLERS.post);
    assert.equal(counts.put, EXPECTED_HTTP_HANDLERS.put);
    assert.equal(counts.patch, EXPECTED_HTTP_HANDLERS.patch);
    assert.equal(counts.delete, EXPECTED_HTTP_HANDLERS.delete);
  });

  it("endpoints canônicos (promessas, cobrança, disputas, agenda, OFX…) seguem registrados", () => {
    const routesSrc = readFileSync(join(treasuryRoot, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_API_PREFIX, "/api/finance/treasury");
    for (const path of REQUIRED_API_PATHS) {
      assert.ok(path.startsWith(TREASURY_API_PREFIX), path);
    }
    const requiredConstants = [
      "TREASURY_DASHBOARD_PATH",
      "TREASURY_ACCOUNTS_PATH",
      "TREASURY_RECEIVABLES_PATH",
      "TREASURY_PAYABLES_PATH",
      "TREASURY_PROMISES_PATH",
      "TREASURY_COLLECTION_ACTIONS_PATH",
      "TREASURY_DISPUTES_PATH",
      "TREASURY_AGENDA_PATH",
      "TREASURY_PROJECTIONS_PATH",
      "TREASURY_PAYMENT_SCHEDULE_PATH",
      "TREASURY_TRANSFERS_PATH",
      "TREASURY_LEDGER_ENTRIES_PATH",
      "TREASURY_EXCEPTIONS_PATH",
      "TREASURY_ALERTS_PATH",
      "TREASURY_ALERT_SETTINGS_PATH",
      "TREASURY_DAILY_CLOSING_PATH",
      "TREASURY_DAILY_CLOSING_PREVIEW_PATH",
      "TREASURY_FORECAST_VS_ACTUAL_PATH",
      "TREASURY_BANK_IMPORTS_PATH",
      "TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH",
      "TREASURY_BANK_IMPORTS_OFX_APPLY_PATH",
      "TREASURY_BANK_MOVEMENTS_PATH",
      "TREASURY_RECONCILIATIONS_PATH",
      "TREASURY_RECONCILE_WORKSPACE_PATH",
      "TREASURY_REPORTS_PATH",
      "TREASURY_AUDIT_PATH",
    ] as const;
    for (const name of requiredConstants) {
      assert.match(routesSrc, new RegExp(name), `constante ausente: ${name}`);
    }
  });
});

describe("treasury advanced capabilities — banco (models + migrations)", () => {
  it("nenhum model Treasury* foi removido (27 models)", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const found = [...schema.matchAll(/^model (Treasury\w+)/gm)].map((m) => m[1]);
    assert.equal(found.length, EXPECTED_TREASURY_MODELS.length);
    assert.deepEqual(found.sort(), [...EXPECTED_TREASURY_MODELS].sort());
    for (const model of EXPECTED_TREASURY_MODELS) {
      assert.match(schema, new RegExp(`model ${model}\\b`));
    }
  });

  it("migrations Treasury permanecem aditivas (sem DROP TABLE Treasury*)", () => {
    const migs = migrationsTouchingTreasury();
    assert.equal(
      migs.length,
      EXPECTED_TREASURY_MIGRATIONS_WITH_MODEL,
      `migrations Treasury mudaram: ${migs.join(", ")}`
    );
    for (const dir of migs) {
      const sql = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
      assert.doesNotMatch(
        sql,
        /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?["`]?Treasury/i,
        `DROP TABLE Treasury* em ${dir}`
      );
      assert.doesNotMatch(
        sql,
        /DROP\s+COLUMN/i,
        `DROP COLUMN em migration Treasury ${dir} — remoção de coluna não permitida sem justificativa`
      );
    }
  });
});

describe("treasury advanced capabilities — rotas frontend e deep-links", () => {
  it("lista completa de rotas avançadas permanece no Module, com gate e página", () => {
    const mod = readFileSync(modulePath, "utf8");
    assert.match(mod, /TreasuryFlagGate|function gate\b|gate\(/);
    assert.match(mod, /canAccessTreasuryAdvancedNavigation/);
    assert.match(mod, /Recursos avançados/);

    for (const link of ADVANCED_UI_DEEP_LINKS) {
      assert.match(
        mod,
        new RegExp(`path="${link.pathFragment}"`),
        `deep-link ausente: ${link.pathFragment}`
      );
      assert.match(
        mod,
        new RegExp(link.pageComponent),
        `componente ausente no Module: ${link.pageComponent}`
      );
      const pageFile = join(
        repoRoot,
        "src/components/finance/treasury",
        `${link.pageComponent}.tsx`
      );
      assert.ok(existsSync(pageFile), pageFile);
    }

    // Simplificação: projection primária ≠ agenda avançada
    assert.match(mod, /TreasurySimpleCashRiskProjectionPage/);
    assert.match(mod, /path="agenda"[\s\S]*TreasuryAgendaPage/);
    assert.match(mod, /path="projections"[\s\S]*TreasuryProjectionComparisonPage/);
  });

  it("deep-links avançados não estão nas abas principais", () => {
    const primaryPaths = new Set<string>(
      TREASURY_UI_PRIMARY_SECTIONS.map((s) => s.path)
    );
    assert.equal(TREASURY_UI_PRIMARY_SECTIONS.length, 3);
    for (const section of TREASURY_UI_ADVANCED_SECTIONS) {
      assert.ok(!primaryPaths.has(section.path), section.path);
      assert.equal(isTreasuryAdvancedPath(section.path), true);
      assert.equal(isTreasuryPrimaryPath(section.path), false);
    }
    assert.equal(isTreasuryAdvancedPath(TREASURY_UI_ADVANCED_HUB_PATH), true);
    assert.ok(
      TREASURY_UI_SECTIONS.some((s) => s.path === TREASURY_UI_ADVANCED_HUB_PATH)
    );
  });

  it("cada seção avançada do catálogo tem flag (ou null) e path sob /finance/treasury", () => {
    assert.ok(TREASURY_UI_ADVANCED_SECTIONS.length >= 15);
    for (const section of TREASURY_UI_ADVANCED_SECTIONS) {
      assert.ok(
        section.path.startsWith(`${TREASURY_UI_BASE_PATH}/`),
        section.path
      );
      assert.ok(
        section.id in TREASURY_UI_SECTION_FEATURE_FLAG,
        `flag mapping ausente: ${section.id}`
      );
    }
  });
});

describe("treasury advanced capabilities — shell, papéis, flags e permissões", () => {
  it("hub avançado só para ADMIN/SUPER_ADMIN; deep-links preservados no código", () => {
    assert.deepEqual([...TREASURY_ADVANCED_NAV_ROLES], ["ADMIN", "SUPER_ADMIN"]);
    assert.equal(canAccessTreasuryAdvancedNavigation("ADMIN"), true);
    assert.equal(canAccessTreasuryAdvancedNavigation("SUPER_ADMIN"), true);
    assert.equal(canAccessTreasuryAdvancedNavigation("SELLER"), false);
    assert.equal(canAccessTreasuryAdvancedNavigation("VIEWER"), false);

    const hub = readFileSync(
      join(
        repoRoot,
        "src/components/finance/treasury/TreasuryAdvancedHubPage.tsx"
      ),
      "utf8"
    );
    assert.match(hub, /treasury-advanced-hub/);
    assert.match(hub, /TREASURY_UI_ADVANCED_SECTIONS/);
    assert.match(hub, /Recursos avançados/);
  });

  it("feature flags mestra + subflags intactas (opt-in)", () => {
    assert.equal(TREASURY_FEATURE_FLAG_IDS.length, 15);
    assert.equal(TREASURY_MASTER_DEFAULT_WHEN_ABSENT, false);
    assert.equal(isTreasuryModuleEnabled({}), false);
    for (const id of [
      "treasury.enabled",
      "treasury.promises.enabled",
      "treasury.payablesProgramming.enabled",
      "treasury.projection.enabled",
      "treasury.reconciliation.enabled",
      "treasury.ofxImport.enabled",
      "treasury.dailyClosing.enabled",
      "treasury.exceptions.enabled",
      "treasury.reports.enabled",
      "treasury.transfers.enabled",
    ] as const) {
      assert.ok(TREASURY_FEATURE_FLAG_IDS.includes(id), id);
      assert.ok(TREASURY_FEATURE_FLAG_ENV[id], id);
    }
  });

  it("permissões finance.treasury* (recursos + bags) intactas", () => {
    assert.equal(Object.keys(TREASURY_RESOURCE_KEYS).length, 18);
    assert.equal(TREASURY_LEGACY_BAG_KEYS.length, 28);
    for (const key of [
      "finance.treasury.receivables.promise",
      "finance.treasury.receivables.collection",
      "finance.treasury.payables.program",
      "finance.treasury.closing.close",
      "finance.treasury.reconciliation.manage",
      "finance.treasury.audit.view",
      "finance.treasury.reports.view",
      "finance.treasury.agenda.view",
    ] as const) {
      assert.ok(
        (TREASURY_LEGACY_BAG_KEYS as readonly string[]).includes(key),
        key
      );
    }
    assert.equal(
      TREASURY_RESOURCE_KEYS.receivablesPromise,
      "finance.treasury.receivables.promise"
    );
    assert.equal(
      TREASURY_RESOURCE_KEYS.receivablesCollection,
      "finance.treasury.receivables.collection"
    );
  });
});

describe("treasury advanced capabilities — services, repositories, adapters", () => {
  it("camadas server-side permanecem no repositório (contagens mínimas congeladas)", () => {
    const controllers = listTsFiles(join(treasuryRoot, "controllers"));
    const services = listTsFiles(join(treasuryRoot, "services"));
    const repositories = listTsFiles(join(treasuryRoot, "repositories"));
    const adapters = listTsFiles(join(treasuryRoot, "adapters"));

    assert.ok(
      controllers.length >= EXPECTED_LAYER_COUNTS.controllersMin,
      `controllers=${controllers.length}`
    );
    assert.ok(
      services.length >= EXPECTED_LAYER_COUNTS.servicesMin,
      `services=${services.length}`
    );
    assert.ok(
      repositories.length >= EXPECTED_LAYER_COUNTS.repositoriesMin,
      `repositories=${repositories.length}`
    );
    assert.ok(
      adapters.length >= EXPECTED_LAYER_COUNTS.adaptersMin,
      `adapters=${adapters.length}`
    );

    for (const name of REQUIRED_SERVICE_FILES) {
      assert.ok(existsSync(join(treasuryRoot, "services", name)), name);
    }
    for (const name of REQUIRED_REPOSITORY_FILES) {
      assert.ok(existsSync(join(treasuryRoot, "repositories", name)), name);
    }
    for (const name of REQUIRED_ADAPTER_FILES) {
      assert.ok(existsSync(join(treasuryRoot, "adapters", name)), name);
    }
  });

  it("contratos de domínio avançado (cenários, motor, rotinas) não foram apagados", () => {
    for (const rel of [
      "domain/treasuryProjectionEngine.ts",
      "domain/treasuryDailyCashEngine.ts",
      "domain/treasuryTransferRules.ts",
      "domain/treasuryDailyClosingRules.ts",
      "domain/treasuryAlertRules.ts",
      "domain/treasuryReconciliationMatchRules.ts",
      "contracts/treasuryContracts.ts",
      "contracts/treasuryDto.ts",
      "contracts/treasuryEnums.ts",
      "contracts/treasuryConstants.ts",
    ]) {
      assert.ok(existsSync(join(treasuryRoot, rel)), rel);
    }
  });
});
