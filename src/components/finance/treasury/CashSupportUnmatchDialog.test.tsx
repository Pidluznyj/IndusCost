import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CashSupportUnmatchDialog } from "./CashSupportUnmatchDialog.js";
import type { TreasuryReconciliationMatchDto } from "@/src/lib/treasury/contracts/index.js";

function match(): TreasuryReconciliationMatchDto {
  return {
    id: "match-1",
    companyCode: "EMP1",
    accountId: "acc-1",
    status: "MATCHED",
    matchedAmount: "1000.00",
    currency: "BRL",
    matchedCivilDate: "2026-07-20",
    justification: null,
    suggestionKey: null,
    algorithmVersion: null,
    suggestionScore: null,
    suggestionConfidence: null,
    suggestionReasons: null,
    version: 1,
    movements: [],
    allocations: [],
    createdAt: "2026-07-20T10:00:00.000Z",
    createdByUserId: "u1",
    updatedAt: "2026-07-20T10:00:00.000Z",
    updatedByUserId: null,
    unmatchedAt: null,
    unmatchedByUserId: null,
    unmatchReason: null,
    isReversed: false,
  } as TreasuryReconciliationMatchDto;
}

describe("CashSupportUnmatchDialog", () => {
  it("fechado não renderiza", () => {
    const html = renderToStaticMarkup(
      <CashSupportUnmatchDialog open={false} match={null} onCancel={() => {}} onConfirm={() => {}} />
    );
    assert.equal(html, "");
  });

  it("aberto mostra valor do match e nasce com botão desabilitado", () => {
    const html = renderToStaticMarkup(
      <CashSupportUnmatchDialog open match={match()} onCancel={() => {}} onConfirm={() => {}} />
    );
    assert.ok(html.includes('data-testid="cash-support-unmatch-dialog"'));
    const tag = html.match(/<button[^>]*data-testid="cash-support-unmatch-submit"[^>]*>/)?.[0];
    assert.ok(tag?.includes('disabled=""'), "sem motivo, deve nascer desabilitado");
  });

  it("erro do backend é exibido", () => {
    const html = renderToStaticMarkup(
      <CashSupportUnmatchDialog
        open
        match={match()}
        error="Versão desatualizada."
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    assert.ok(html.includes("Versão desatualizada."));
  });

  it("aviso de que Nomus não é alterado", () => {
    const html = renderToStaticMarkup(
      <CashSupportUnmatchDialog open match={match()} onCancel={() => {}} onConfirm={() => {}} />
    );
    assert.ok(html.includes("Não altera títulos oficiais Nomus"));
  });
});
