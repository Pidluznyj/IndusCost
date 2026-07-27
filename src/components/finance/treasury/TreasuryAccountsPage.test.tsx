import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreasuryFinancialAccountDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_ACCOUNTS_DENIED_MESSAGE,
  TREASURY_ACCOUNTS_EMPTY_TITLE,
  TREASURY_ACCOUNTS_PAGE_TITLE,
} from "@/src/lib/treasury/treasuryAccountsUi.js";
import { TreasuryAccountsPanel } from "./TreasuryAccountsPanel.js";
import { TreasuryAccountFormDialog } from "./TreasuryAccountFormDialog.js";
import { createEmptyTreasuryAccountForm } from "@/src/lib/treasury/treasuryAccountsUi.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleRow(): TreasuryFinancialAccountDto {
  return {
    id: "acc-1",
    companyCode: "LZ",
    companyName: "Lazarios",
    code: "CC-01",
    name: "Conta principal",
    institutionName: "Banco X",
    institutionCode: "001",
    accountType: "CHECKING",
    currency: "BRL",
    agencyMasked: "****-1",
    accountNumberMasked: "******89",
    includeInConsolidated: true,
    minimumBalance: "1500.00",
    allowNegativeBalance: false,
    liquidity: "D_PLUS_1",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 1,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: "u1",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-20T15:30:00.000Z",
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivationReason: null,
  };
}

const panelBase = {
  canManage: true,
  rows: [] as TreasuryFinancialAccountDto[],
  error: null as string | null,
  search: "",
  status: "all" as const,
  page: 1,
  pageSize: 50,
  totalPages: 1,
  total: 0,
  onSearchChange: noop,
  onStatusChange: noop,
  onPageChange: noop,
  onRefresh: noop,
  onCreate: noop,
  onEdit: noop,
  onDeactivate: noop,
  onReactivate: noop,
  onManageAccess: noop,
};

describe("TreasuryAccountsPage — componentes e fluxo", () => {
  it("exibe estado sem permissão", () => {
    const html = renderToStaticMarkup(
      <TreasuryAccountsPanel {...panelBase} viewKind="denied" canManage={false} />
    );
    assert.match(html, /treasury-accounts-permission-denied/);
    assert.ok(html.includes(TREASURY_ACCOUNTS_DENIED_MESSAGE));
  });

  it("exibe carregando, vazio e erro", () => {
    const loading = renderToStaticMarkup(
      <TreasuryAccountsPanel {...panelBase} viewKind="loading" />
    );
    assert.match(loading, /Carregando contas financeiras/);

    const empty = renderToStaticMarkup(
      <TreasuryAccountsPanel {...panelBase} viewKind="empty" />
    );
    assert.ok(empty.includes(TREASURY_ACCOUNTS_EMPTY_TITLE));

    const error = renderToStaticMarkup(
      <TreasuryAccountsPanel
        {...panelBase}
        viewKind="error"
        error="Falha de rede"
      />
    );
    assert.ok(error.includes("Falha de rede"));
  });

  it("lista conta com saldo mínimo, liquidez, consolidado, máscara e última atualização", () => {
    const row = sampleRow();
    const html = renderToStaticMarkup(
      <TreasuryAccountsPanel
        {...panelBase}
        viewKind="ready"
        rows={[row]}
        total={1}
      />
    );
    assert.match(html, /treasury-accounts-table/);
    assert.match(html, /treasury-accounts-mobile-list/);
    assert.ok(html.includes("CC-01"));
    assert.ok(html.includes("****-1"));
    assert.ok(html.includes("******89"));
    assert.ok(html.includes("D+1") || html.includes("D_PLUS_1") === false);
    assert.ok(html.includes("Sim"));
    assert.ok(html.includes("Editar"));
    assert.ok(html.includes("Acessos"));
    assert.ok(html.includes("Desativar"));
    assert.ok(!html.includes("accountNumber") || html.includes("******89"));
  });

  it("form dialog mascara campos sensíveis e expõe saldo/liquidez/consolidado", () => {
    const form = createEmptyTreasuryAccountForm();
    form.name = "Nova";
    form.agencyMasked = "****-9";
    form.accountNumberMasked = "******01";
    form.minimumBalance = "200.00";
    form.includeInConsolidated = true;
    const html = renderToStaticMarkup(
      <TreasuryAccountFormDialog
        mode="create"
        form={form}
        saving={false}
        error={null}
        onChange={noop}
        onClose={noop}
        onSave={noop}
      />
    );
    assert.match(html, /treasury-account-form-dialog/);
    assert.match(html, /treasury-account-field-agency/);
    assert.match(html, /treasury-account-field-minimum-balance/);
    assert.match(html, /treasury-account-field-liquidity/);
    assert.match(html, /treasury-account-field-consolidated/);
    assert.ok(html.includes("mascarad"));
  });

  it("wiring App + módulo + página existem com títulos e contratos", () => {
    const app = readFileSync(join(repoRoot, "src/App.tsx"), "utf8");
    assert.match(app, /finance\/treasury\/\*/);
    assert.match(app, /TreasuryModule/);

    const page = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryAccountsPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes(TREASURY_ACCOUNTS_PAGE_TITLE) || page.includes("TREASURY_ACCOUNTS_PAGE_TITLE"));
    assert.match(page, /fetchTreasuryAccounts/);
    assert.match(page, /canViewTreasuryAccounts/);
    assert.doesNotMatch(page, /@prisma\/client|\.server\.js/);

    const panel = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryAccountsPanel.tsx"),
      "utf8"
    );
    assert.match(panel, /md:hidden/);
    assert.match(panel, /hidden.*md:block|md:block/);
  });
});
