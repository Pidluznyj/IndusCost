import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TreasuryGuidedDailyOpeningWorkspaceDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_TODAY_OPENING_DENIED_MESSAGE,
  TREASURY_TODAY_OPENING_EMPTY_TITLE,
  createTreasuryTodayOpeningDrafts,
} from "@/src/lib/treasury/treasuryTodayOpeningUi.js";
import { TreasuryTodayOpeningPanel } from "./TreasuryTodayOpeningPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleWorkspace(): TreasuryGuidedDailyOpeningWorkspaceDto {
  return {
    ok: true,
    civilDate: "2026-07-28",
    asOf: "2026-07-28T12:00:00.000+00:00",
    title: "Saldos iniciais de hoje",
    accounts: [
      {
        accountId: "acc-1",
        accountCode: "CX01",
        accountName: "Caixa Matriz",
        bank: "Itaú",
        previousClosingBalance: "1000.00",
        previousClosingCivilDate: "2026-07-27",
        previousClosingId: "c1",
        suggestedOpeningBalance: "1000.00",
        currentOpeningBalance: null,
        expectedVersion: 0,
        situation: "READY_TO_CONFIRM",
        situationLabel: "Pronto para confirmar",
        requiresManualInput: false,
        canConfirmSuggested: true,
      },
    ],
    confirmableCount: 1,
    pendingCount: 1,
    confirmedCount: 0,
  };
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("TreasuryTodayOpeningPage — painel", () => {
  it("exibe estados denied/loading/error/empty", () => {
    assert.match(
      render(
        <TreasuryTodayOpeningPanel
          viewKind="denied"
          data={null}
          drafts={{}}
          error={null}
          saving={false}
          canManage={false}
          onDraftChange={noop}
          onConfirmAll={noop}
          onSave={noop}
          onRefresh={noop}
        />
      ),
      new RegExp(TREASURY_TODAY_OPENING_DENIED_MESSAGE)
    );
    assert.match(
      render(
        <TreasuryTodayOpeningPanel
          viewKind="loading"
          data={null}
          drafts={{}}
          error={null}
          saving={false}
          canManage={false}
          onDraftChange={noop}
          onConfirmAll={noop}
          onSave={noop}
          onRefresh={noop}
        />
      ),
      /treasury-opening-loading/
    );
    assert.match(
      render(
        <TreasuryTodayOpeningPanel
          viewKind="error"
          data={null}
          drafts={{}}
          error="Falha"
          saving={false}
          canManage={false}
          onDraftChange={noop}
          onConfirmAll={noop}
          onSave={noop}
          onRefresh={noop}
        />
      ),
      /Falha/
    );
    assert.match(
      render(
        <TreasuryTodayOpeningPanel
          viewKind="empty"
          data={{ ...sampleWorkspace(), accounts: [] }}
          drafts={{}}
          error={null}
          saving={false}
          canManage={false}
          onDraftChange={noop}
          onConfirmAll={noop}
          onSave={noop}
          onRefresh={noop}
        />
      ),
      new RegExp(TREASURY_TODAY_OPENING_EMPTY_TITLE)
    );
  });

  it("exibe tabela conceitual, confirmação e edição", () => {
    const data = sampleWorkspace();
    const html = render(
      <TreasuryTodayOpeningPanel
        viewKind="ready"
        data={data}
        drafts={createTreasuryTodayOpeningDrafts(data)}
        error={null}
        saving={false}
        canManage={true}
        onDraftChange={noop}
        onConfirmAll={noop}
        onSave={noop}
        onRefresh={noop}
      />
    );
    assert.match(html, /Saldos iniciais de hoje/);
    assert.match(html, /Saldo final anterior/);
    assert.match(html, /Saldo inicial de hoje/);
    assert.match(html, /Situação: Pronto para confirmar/);
    assert.match(html, /Confirmar todos sem divergência/);
    assert.match(html, /Salvar e continuar/);
    assert.match(html, /Caixa Matriz/);
    assert.match(html, /Observação/);
  });

  it("módulo e rotas preservam deep-link de abertura", () => {
    const mod = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(mod, /path="today\/opening"/);
    assert.match(mod, /TreasuryTodayOpeningPage/);
    const routes = readFileSync(
      join(repoRoot, "src/lib/treasury/treasuryRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /TREASURY_TODAY_OPENING_PATH/);
  });
});
