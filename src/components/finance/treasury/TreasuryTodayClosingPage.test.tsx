import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TreasuryGuidedDailyClosingWorkspaceDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_TODAY_CLOSING_DENIED_MESSAGE,
  TREASURY_TODAY_CLOSING_PAGE_TITLE,
  createTreasuryTodayClosingDrafts,
} from "@/src/lib/treasury/treasuryTodayClosingUi.js";
import { TreasuryTodayClosingPanel } from "./TreasuryTodayClosingPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleWorkspace(): TreasuryGuidedDailyClosingWorkspaceDto {
  return {
    ok: true,
    civilDate: "2026-07-28",
    asOf: "2026-07-28T20:00:00.000+00:00",
    title: TREASURY_TODAY_CLOSING_PAGE_TITLE,
    companyCode: "LZ",
    accounts: [
      {
        accountId: "acc-1",
        accountCode: "CX",
        accountName: "Caixa",
        bank: "Banco",
        openingBalance: "1000.00",
        realizedInflows: "200.00",
        realizedOutflows: "50.00",
        transfersReceived: "0.00",
        transfersSent: "0.00",
        transfersNet: "0.00",
        localInflows: "10.00",
        localOutflows: "5.00",
        localNet: "5.00",
        realizedClosingBalance: "1155.00",
        informedClosingBalance: "1200.00",
        divergence: "45.00",
        expectedVersion: 2,
        situation: "HAS_DIVERGENCE",
        situationLabel: "Há diferença",
        divergenceMessage: "Existe uma diferença de R$ 45,00 nesta conta.",
        canInformClosing: true,
      },
    ],
    informedCount: 1,
    pendingCount: 0,
    divergenceCount: 1,
    investigationActions: [
      {
        id: "IMPORT_STATEMENT",
        label: "Importar extrato",
        href: "/finance/treasury/ofx",
      },
      {
        id: "CLOSE_WITH_CAVEAT",
        label: "Fechar com ressalva",
        href: "/finance/treasury/today/closing?step=close",
      },
    ],
    closeGates: {
      openingsInformed: true,
      closingsInformed: true,
      hasDivergences: true,
      unidentifiedMovementsCount: 0,
      unlinkedAccountsCount: 0,
      transfersInTransitCount: 0,
      requiredCaveatCodes: ["RECONCILIATION_DIFFERENCE"],
      absoluteBlocks: [],
      warnings: [],
      canCloseWithoutCaveats: false,
      canCloseWithCaveats: true,
      sourceHash: "hash-1",
      dayAlreadyClosed: false,
    },
  };
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("TreasuryTodayClosing — UI", () => {
  it("exibe etapas, divergência, gates e ações sem enums técnicos", () => {
    assert.match(
      render(
        <TreasuryTodayClosingPanel
          viewKind="denied"
          step="final-balances"
          data={null}
          drafts={{}}
          error={null}
          saving={false}
          closing={false}
          canManage
          canClose
          caveatDrafts={{}}
          onDraftChange={noop}
          onCaveatChange={noop}
          onStepChange={noop}
          onSave={noop}
          onCloseDay={noop}
          onRefresh={noop}
        />
      ),
      new RegExp(TREASURY_TODAY_CLOSING_DENIED_MESSAGE)
    );

    const data = sampleWorkspace();
    const drafts = createTreasuryTodayClosingDrafts(data);
    const finalHtml = render(
      <TreasuryTodayClosingPanel
        viewKind="ready"
        step="final-balances"
        data={data}
        drafts={drafts}
        error={null}
        saving={false}
        closing={false}
        canManage
        canClose
        caveatDrafts={{}}
        onDraftChange={noop}
        onCaveatChange={noop}
        onStepChange={noop}
        onSave={noop}
        onCloseDay={noop}
        onRefresh={noop}
      />
    );
    assert.match(finalHtml, /Saldo realizado calculado/);
    assert.match(finalHtml, /Saldo final visto no banco/);
    assert.match(finalHtml, /Existe uma diferença de R\$ 45,00/);

    const divHtml = render(
      <TreasuryTodayClosingPanel
        viewKind="ready"
        step="divergences"
        data={data}
        drafts={drafts}
        error={null}
        saving={false}
        closing={false}
        canManage
        canClose
        caveatDrafts={{}}
        onDraftChange={noop}
        onCaveatChange={noop}
        onStepChange={noop}
        onSave={noop}
        onCloseDay={noop}
        onRefresh={noop}
      />
    );
    assert.match(divHtml, /Importar extrato/);
    assert.match(divHtml, /Nenhum lançamento é criado automaticamente/);

    const closeHtml = render(
      <TreasuryTodayClosingPanel
        viewKind="ready"
        step="close"
        data={data}
        drafts={drafts}
        error={null}
        saving={false}
        closing={false}
        canManage
        canClose
        caveatDrafts={{ RECONCILIATION_DIFFERENCE: "Diferença investigada" }}
        onDraftChange={noop}
        onCaveatChange={noop}
        onStepChange={noop}
        onSave={noop}
        onCloseDay={noop}
        onRefresh={noop}
      />
    );
    assert.match(closeHtml, /Saldos iniciais informados/);
    assert.match(closeHtml, /Fechar com ressalvas/);
    assert.match(closeHtml, /Voltar e revisar/);
  });

  it("rota e página reutilizam fechamento formal sem segundo sistema", () => {
    const mod = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(mod, /path="today\/closing"/);
    assert.match(mod, /TreasuryTodayClosingPage/);
    assert.match(mod, /path="closing"/);

    const page = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryTodayClosingPage.tsx"),
      "utf8"
    );
    assert.match(page, /closeTreasuryDailyClosing/);
    assert.doesNotMatch(page, /createTreasuryDailyClosingService/);
  });
});
