import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TREASURY_FEATURE_FLAG_IDS } from "./treasuryFeatureFlags.js";
import {
  filterTreasuryUiSections,
  resolveTreasuryUiLandingPath,
  TREASURY_UI_SECTION_FEATURE_FLAG,
} from "./treasuryRollout.js";
import {
  canAccessTreasuryAdvancedNavigation,
  isTreasuryAdvancedPath,
  isTreasuryPrimaryPath,
  TREASURY_UI_ADVANCED_HUB_PATH,
  TREASURY_UI_ADVANCED_SECTIONS,
  TREASURY_UI_PRIMARY_SECTIONS,
} from "./treasurySimpleNavigation.js";
import {
  TREASURY_UI_BASE_PATH,
  TREASURY_UI_SECTIONS,
} from "../../components/finance/treasury/treasuryFeatureUi.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

function allFlagsOn() {
  return Object.fromEntries(
    TREASURY_FEATURE_FLAG_IDS.map((id) => [id, true])
  ) as Record<(typeof TREASURY_FEATURE_FLAG_IDS)[number], boolean>;
}

describe("treasurySimpleNavigation — navegação principal", () => {
  it("expõe exatamente 3 abas principais com linguagem simples", () => {
    assert.equal(TREASURY_UI_PRIMARY_SECTIONS.length, 3);
    assert.deepEqual(
      TREASURY_UI_PRIMARY_SECTIONS.map((s) => s.label),
      ["Contas", "Caixa", "Apoio ao Caixa"]
    );
    assert.deepEqual(
      TREASURY_UI_PRIMARY_SECTIONS.map((s) => s.path),
      [
        `${TREASURY_UI_BASE_PATH}/accounts`,
        `${TREASURY_UI_BASE_PATH}/caixa`,
        `${TREASURY_UI_BASE_PATH}/cash-support`,
      ]
    );
  });

  it("Hoje, Conferir banco e Fluxo Gerencial saíram da barra mas seguem no catálogo", () => {
    const primaryIds = new Set<string>(
      TREASURY_UI_PRIMARY_SECTIONS.map((s) => s.id)
    );
    const advancedIds = new Set<string>(
      TREASURY_UI_ADVANCED_SECTIONS.map((s) => s.id)
    );
    for (const id of ["today", "bank", "projection"] as const) {
      assert.equal(primaryIds.has(id), false, `${id} não deve ser aba principal`);
      assert.equal(advancedIds.has(id), true, `${id} deve seguir no avançado`);
    }
  });

  it("landing da experiência simples é Contas quando a subflag está liberada", () => {
    const flags = allFlagsOn();
    assert.equal(
      resolveTreasuryUiLandingPath(
        TREASURY_UI_PRIMARY_SECTIONS,
        flags,
        `${TREASURY_UI_BASE_PATH}/caixa`
      ),
      `${TREASURY_UI_BASE_PATH}/accounts`
    );
  });

  it("subflag de contas desligada deixa Caixa e Apoio ao Caixa (que seguem outras flags)", () => {
    const flags = allFlagsOn();
    flags["treasury.accounts.enabled"] = false;
    const visible = filterTreasuryUiSections(TREASURY_UI_PRIMARY_SECTIONS, flags);
    assert.deepEqual(
      visible.map((s) => s.id),
      ["caixa", "cash-support"]
    );
    assert.ok(TREASURY_UI_ADVANCED_SECTIONS.some((s) => s.id === "reconcile"));
    assert.ok(TREASURY_UI_ADVANCED_SECTIONS.some((s) => s.id === "projections"));
  });
});

describe("treasurySimpleNavigation — recursos avançados e papéis", () => {
  it("ADMIN e SUPER_ADMIN acessam hub; SELLER bloqueado", () => {
    assert.equal(canAccessTreasuryAdvancedNavigation("ADMIN"), true);
    assert.equal(canAccessTreasuryAdvancedNavigation("SUPER_ADMIN"), true);
    assert.equal(canAccessTreasuryAdvancedNavigation("SELLER"), false);
    assert.equal(canAccessTreasuryAdvancedNavigation("VIEWER"), false);
    assert.equal(canAccessTreasuryAdvancedNavigation(null), false);
  });

  it("preserva seções avançadas com labels simples onde pedido", () => {
    const byId = Object.fromEntries(
      TREASURY_UI_ADVANCED_SECTIONS.map((s) => [s.id, s])
    );
    assert.equal(byId.receivables?.label, "Recebimentos");
    assert.equal(byId.payables?.label, "Pagamentos");
    assert.equal(byId.closing?.label, "Fechar o dia");
    assert.ok(TREASURY_UI_ADVANCED_SECTIONS.length >= 15);
    assert.equal(TREASURY_UI_ADVANCED_HUB_PATH, `${TREASURY_UI_BASE_PATH}/advanced`);
  });

  it("classifica paths primários vs avançados (deep-link)", () => {
    assert.equal(isTreasuryPrimaryPath(`${TREASURY_UI_BASE_PATH}/accounts`), true);
    assert.equal(isTreasuryPrimaryPath(`${TREASURY_UI_BASE_PATH}/caixa`), true);
    // Saíram da barra principal, mas seguem acessíveis como avançados.
    assert.equal(isTreasuryPrimaryPath(`${TREASURY_UI_BASE_PATH}/today`), false);
    assert.equal(isTreasuryAdvancedPath(`${TREASURY_UI_BASE_PATH}/today`), true);
    assert.equal(isTreasuryPrimaryPath(`${TREASURY_UI_BASE_PATH}/bank`), false);
    assert.equal(isTreasuryAdvancedPath(`${TREASURY_UI_BASE_PATH}/bank`), true);
    assert.equal(
      isTreasuryAdvancedPath(`${TREASURY_UI_BASE_PATH}/projection`),
      true
    );
    assert.equal(
      isTreasuryAdvancedPath(`${TREASURY_UI_BASE_PATH}/receivables`),
      true
    );
    assert.equal(
      isTreasuryAdvancedPath(`${TREASURY_UI_BASE_PATH}/closing`),
      true
    );
    assert.equal(isTreasuryAdvancedPath(TREASURY_UI_ADVANCED_HUB_PATH), true);
    assert.equal(isTreasuryPrimaryPath(`${TREASURY_UI_BASE_PATH}/receivables`), false);
  });
});

describe("treasurySimpleNavigation — shell e preservação", () => {
  it("TreasuryModule usa nav primária e preserva rotas avançadas", () => {
    const mod = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(mod, /TREASURY_UI_PRIMARY_SECTIONS/);
    assert.match(mod, /canAccessTreasuryAdvancedNavigation/);
    assert.match(mod, /Recursos avançados/);
    assert.match(mod, /path="today"/);
    assert.match(mod, /path="bank"/);
    assert.match(mod, /path="projection"/);
    assert.match(mod, /path="advanced"/);
    for (const fragment of [
      "receivables",
      "payables",
      "agenda",
      "projections",
      "transfers",
      "manual-entries",
      "ofx",
      "reconcile",
      "closing",
      "reports",
      "audit",
    ]) {
      assert.match(mod, new RegExp(`path="${fragment}"`));
    }
  });

  it("nenhum componente avançado de página foi removido", () => {
    const dir = join(repoRoot, "src/components/finance/treasury");
    for (const name of [
      "TreasuryDashboardPage.tsx",
      "TreasuryTodayPage.tsx",
      "TreasuryTodayOpeningPage.tsx",
      "TreasuryAccountsPage.tsx",
      "TreasuryReceivablesPage.tsx",
      "TreasuryPayablesPage.tsx",
      "TreasuryAgendaPage.tsx",
      "TreasuryProjectionComparisonPage.tsx",
      "TreasuryTransfersPage.tsx",
      "TreasuryManualEntriesPage.tsx",
      "TreasuryBankMovementsPage.tsx",
      "TreasuryReconcileWorkspacePage.tsx",
      "TreasuryExceptionsPage.tsx",
      "TreasuryDailyClosingPage.tsx",
      "TreasuryReportsPage.tsx",
      "TreasuryAuditPage.tsx",
      "TreasuryAlertSettingsPage.tsx",
      "TreasuryPaymentSchedulePage.tsx",
      "TreasuryAdvancedHubPage.tsx",
    ]) {
      assert.ok(existsSync(join(dir, name)), name);
    }
    const pages = readdirSync(dir).filter((f) => f.endsWith("Page.tsx"));
    assert.ok(pages.length >= 16, `pages=${pages.length}`);
  });

  it("flags de seções novas apontam para subflags existentes", () => {
    assert.equal(
      TREASURY_UI_SECTION_FEATURE_FLAG.today,
      "treasury.dashboard.enabled"
    );
    assert.equal(
      TREASURY_UI_SECTION_FEATURE_FLAG.bank,
      "treasury.ofxImport.enabled"
    );
    assert.equal(
      TREASURY_UI_SECTION_FEATURE_FLAG.projection,
      "treasury.projection.enabled"
    );
    assert.equal(TREASURY_UI_SECTION_FEATURE_FLAG.advanced, null);
    assert.equal(TREASURY_UI_SECTION_FEATURE_FLAG.caixa, null);
  });

  it("catálogo TREASURY_UI_SECTIONS inclui primárias e avançadas", () => {
    const ids = new Set(TREASURY_UI_SECTIONS.map((s) => s.id));
    for (const id of ["today", "accounts", "bank", "projection", "caixa", "advanced"] as const) {
      assert.ok(ids.has(id), id);
    }
    for (const section of TREASURY_UI_ADVANCED_SECTIONS) {
      assert.ok(ids.has(section.id), section.id);
    }
  });
});
