import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  TREASURY_SIMPLE_OFX_DENIED_MESSAGE,
  TREASURY_SIMPLE_OFX_LABELS,
  TREASURY_SIMPLE_OFX_PAGE_TITLE,
} from "@/src/lib/treasury/treasurySimpleOfxInvestigationUi.js";
import { buildTreasurySimpleOfxInvestigationResult } from "@/src/lib/treasury/domain/treasurySimpleOfxInvestigationRules.js";
import { TreasurySimpleOfxInvestigationPanel } from "./TreasurySimpleOfxInvestigationPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("TreasurySimpleOfxInvestigation — UI", () => {
  it("exibe etapas, labels simples e resultado", () => {
    assert.match(
      render(
        <TreasurySimpleOfxInvestigationPanel
          viewKind="denied"
          step="import"
          error={null}
          canManage
          importSlot={null}
          movements={[]}
          result={null}
          busyId={null}
          selectedOtherTitleId={{}}
          onStepChange={noop}
          onConfirmSuggestion={noop}
          onOtherTitleChange={noop}
          onConfirmOtherTitle={noop}
          onCreateManual={noop}
          onUnmatch={noop}
          onRefresh={noop}
        />
      ),
      new RegExp(TREASURY_SIMPLE_OFX_DENIED_MESSAGE)
    );

    const result = buildTreasurySimpleOfxInvestigationResult({
      divergenceBefore: "80.00",
      movements: [
        {
          id: "m1",
          amount: "20.00",
          reconciliationStatus: "MATCHED",
          reconciledAmount: "20.00",
        },
        {
          id: "m2",
          amount: "15.00",
          reconciliationStatus: "PENDING",
          reconciledAmount: "0.00",
        },
      ],
    });

    const html = render(
      <TreasurySimpleOfxInvestigationPanel
        viewKind="ready"
        step="result"
        error={null}
        canManage
        importSlot={<div>import</div>}
        movements={[]}
        result={result}
        busyId={null}
        selectedOtherTitleId={{}}
        onStepChange={noop}
        onConfirmSuggestion={noop}
        onOtherTitleChange={noop}
        onConfirmOtherTitle={noop}
        onCreateManual={noop}
        onUnmatch={noop}
        onRefresh={noop}
      />
    );
    assert.match(html, new RegExp(TREASURY_SIMPLE_OFX_PAGE_TITLE));
    assert.match(html, new RegExp(TREASURY_SIMPLE_OFX_LABELS.divergenceBefore));
    assert.match(html, new RegExp(TREASURY_SIMPLE_OFX_LABELS.remainingDivergence));
    assert.doesNotMatch(html, /\bSETTLED\b|\bAUTO_MATCH\b/);
  });

  it("reutiliza OFX/match/ledger e não muta Nomus", () => {
    const mod = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(mod, /TreasurySimpleOfxInvestigationPage/);
    assert.match(mod, /path="bank"/);
    assert.match(mod, /path="reconcile"/);

    const page = readFileSync(
      join(
        repoRoot,
        "src/components/finance/treasury/TreasurySimpleOfxInvestigationPage.tsx"
      ),
      "utf8"
    );
    assert.match(page, /previewTreasuryOfxImport|TreasuryOfxImportDialog/);
    assert.match(page, /runTreasuryReconciliationSuggestionEngine/);
    assert.match(page, /confirmTreasurySimpleOfxTitleMatch/);
    assert.match(page, /createTreasurySimpleOfxManualFromMovement/);
    assert.doesNotMatch(page, /nomusAccounts(Receivable|Payable)\.(create|update|delete)/i);
    assert.match(page, /assertTreasurySimpleOfxNoAutoMatch/);

    const actions = readFileSync(
      join(
        repoRoot,
        "src/lib/treasury/treasurySimpleOfxInvestigationActions.ts"
      ),
      "utf8"
    );
    assert.match(actions, /acceptTreasuryReconciliation/);
    assert.match(actions, /TREASURY_LEDGER_ENTRIES_PATH/);
    assert.match(actions, /counterpartRef: `ofx:/);
  });
});
