import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TREASURY_BALANCE_CONFLICT_MESSAGE,
  TREASURY_BALANCE_DENIED_MESSAGE,
  TREASURY_BALANCE_STALE_NONE_MESSAGE,
  createEmptyTreasuryBalanceForm,
  maskTreasuryMoneyInputPtBr,
} from "@/src/lib/treasury/treasuryBalancesUi.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { TreasuryBalanceUpdateForm } from "./TreasuryBalanceUpdateForm.js";
import { TreasuryBalanceConfirmDialog } from "./TreasuryBalanceConfirmDialog.js";
import { TreasuryBalanceHistory } from "./TreasuryBalanceHistory.js";
import type { TreasuryBalanceSnapshotDto } from "@/src/lib/treasury/contracts/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleRow(): TreasuryBalanceSnapshotDto {
  return {
    id: "snap-1",
    accountId: "acc-1",
    referenceAt: "2026-07-20T15:30:00.000Z",
    civilDate: "2026-07-20",
    availableBalance: "100.00",
    blockedBalance: "10.00",
    investmentsBalance: "5.00",
    usedLimit: "1.00",
    observedBalance: "115.00",
    operationalAvailableBalance: "100.00",
    origin: "MANUAL",
    idempotencyKey: "k1",
    notes: "ok",
    attachmentUrl: null,
    createdByUserId: "u1",
    previousSnapshotId: null,
    createdAt: "2026-07-20T15:31:00.000Z",
  };
}

describe("TreasuryAccountBalancePage — formulário e estados", () => {
  it("exibe estado sem permissão", () => {
    const html = renderToStaticMarkup(
      <PermissionDenied
        title="Sem permissão"
        message={TREASURY_BALANCE_DENIED_MESSAGE}
        testId="treasury-balance-permission-denied"
      />
    );
    assert.match(html, /treasury-balance-permission-denied/);
    assert.ok(html.includes(TREASURY_BALANCE_DENIED_MESSAGE));
  });

  it("form aplica máscara e mostra erro/conflito", () => {
    const form = createEmptyTreasuryBalanceForm();
    form.availableBalance = maskTreasuryMoneyInputPtBr("123456");
    const html = renderToStaticMarkup(
      <TreasuryBalanceUpdateForm
        form={form}
        canManage
        saving={false}
        error={TREASURY_BALANCE_CONFLICT_MESSAGE}
        isConflict
        onChange={noop}
        onSubmitRequest={noop}
        onReload={noop}
      />
    );
    assert.match(html, /treasury-balance-update-form/);
    assert.match(html, /treasury-balance-field-available/);
    assert.ok(html.includes("1.234,56"));
    assert.match(html, /treasury-balance-form-error/);
    assert.match(html, /treasury-balance-conflict-reload/);
    assert.ok(html.includes(TREASURY_BALANCE_CONFLICT_MESSAGE));
  });

  it("form readonly sem manage e confirmação antes de salvar", () => {
    const readonly = renderToStaticMarkup(
      <TreasuryBalanceUpdateForm
        form={createEmptyTreasuryBalanceForm()}
        canManage={false}
        saving={false}
        error={null}
        isConflict={false}
        onChange={noop}
        onSubmitRequest={noop}
        onReload={noop}
      />
    );
    assert.match(readonly, /treasury-balance-form-readonly/);

    const confirm = renderToStaticMarkup(
      <TreasuryBalanceConfirmDialog
        accountLabel="CC-01 · Principal"
        payload={{
          referenceAt: "2026-07-20T12:00:00.000-03:00",
          availableBalance: "100.00",
          blockedBalance: "0.00",
          investmentsBalance: "0.00",
          usedLimit: "0.00",
          origin: "MANUAL",
          notes: "teste",
        }}
        saving={false}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    assert.match(confirm, /treasury-balance-confirm-dialog/);
    assert.match(confirm, /treasury-balance-confirm-save/);
  });

  it("histórico renderiza timeline/tabela e alerta vazio", () => {
    const empty = renderToStaticMarkup(<TreasuryBalanceHistory rows={[]} />);
    assert.match(empty, /Sem histórico/);

    const withRows = renderToStaticMarkup(
      <TreasuryBalanceHistory rows={[sampleRow()]} />
    );
    assert.match(withRows, /treasury-balance-history/);
    assert.ok(withRows.includes("ok"));
  });

  it("wiring de rota e página de saldo", () => {
    const mod = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(mod, /accounts\/:accountId\/balances/);
    assert.match(mod, /TreasuryAccountBalancePage/);

    const page = readFileSync(
      join(
        repoRoot,
        "src/components/finance/treasury/TreasuryAccountBalancePage.tsx"
      ),
      "utf8"
    );
    assert.match(page, /createTreasuryBalanceSnapshot/);
    assert.match(page, /Idempotency|newIdempotencyKey/);
    assert.match(page, /treasury-balance-stale-alert/);
    assert.doesNotMatch(page, /@prisma\/client|\.server\.js/);
    assert.ok(page.includes(TREASURY_BALANCE_STALE_NONE_MESSAGE) || page.includes("resolveTreasuryBalanceStaleState"));
  });
});
