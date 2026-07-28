import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TreasuryReceivableListItemDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_SIMPLE_RECEIVABLES_REVIEW_TITLE,
  TREASURY_SIMPLE_REVIEW_DENIED,
  createEmptyTreasurySimpleReviewFilters,
} from "@/src/lib/treasury/treasurySimpleTitleReviewUi.js";
import { deriveTreasurySimpleReceivableReviewCategory } from "@/src/lib/treasury/domain/treasurySimpleTitleReviewRules.js";
import { TreasurySimpleReceivablesReviewPanel } from "./TreasurySimpleReceivablesReviewPanel.js";
import { TreasurySimplePayablesReviewPanel } from "./TreasurySimplePayablesReviewPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleReceivable(): TreasuryReceivableListItemDto {
  return {
    titleId: "t1",
    externalId: 10,
    official: {
      id: "t1",
      externalId: 10,
      installmentNumber: 1,
      installmentLabel: "1/2",
      counterparty: {
        personId: 1,
        name: "Cliente Alfa",
        taxId: null,
        role: "CUSTOMER",
      },
      description: "NF 1",
      documentNumber: "1",
      salesOrderExternalId: null,
      salesOrderCode: null,
      invoice: { externalId: null, number: null },
      issuedOn: "2026-07-01",
      dueDate: "2026-07-28",
      originalAmount: "100.00",
      openBalance: "100.00",
      settlements: { settledAmount: null, settledAt: null, paidAt: null },
      cancellation: {
        isCancelledOrRemovedFromSource: false,
        sourcePresenceStatus: "PRESENT",
        sourceRemovedAt: null,
      },
      officialStatus: {
        nomusStatus: false,
        isOpen: true,
        isSettled: false,
        sourcePresenceStatus: "PRESENT",
      },
      lastSyncedAt: "2026-07-28T12:00:00.000+00:00",
    },
    complement: {
      id: "c1",
      expectedDate: "2026-07-28",
      confirmedDate: null,
      scheduledDate: null,
      expectedAmount: "100.00",
      confirmedAmount: null,
      scheduledAmount: null,
      status: "ACTIVE",
      priority: "NORMAL",
      plannedAccountId: "acc-1",
      responsibleUserId: null,
      nextAction: null,
      reason: null,
      notes: null,
      version: 1,
      updatedAt: "2026-07-28T12:00:00.000+00:00",
      cancelledAt: null,
    },
    sellerName: null,
    commercialOwnerName: null,
    openAmount: "100.00",
    receivedAmount: null,
    daysOverdue: 0,
    operationalStatus: "OPEN",
    lastAction: null,
    nextAction: null,
  };
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("TreasurySimpleTitleReview — UI", () => {
  it("recebimentos: estados, categorias, mobile-friendly e overlays via detalhes", () => {
    assert.match(
      render(
        <TreasurySimpleReceivablesReviewPanel
          viewKind="denied"
          rows={[]}
          accounts={[]}
          filters={createEmptyTreasurySimpleReviewFilters("2026-07-28")}
          error={null}
          page={1}
          totalPages={1}
          canManage
          canPromise
          canCollect
          onFiltersChange={noop}
          onRefresh={noop}
          onPageChange={noop}
          onOpenDetails={noop}
        />
      ),
      new RegExp(TREASURY_SIMPLE_REVIEW_DENIED)
    );

    const row = sampleReceivable();
    const category = deriveTreasurySimpleReceivableReviewCategory(
      row,
      "2026-07-28"
    );
    const html = render(
      <TreasurySimpleReceivablesReviewPanel
        viewKind="ready"
        rows={[{ row, category }]}
        accounts={[
          {
            id: "acc-1",
            companyCode: "EMP1",
            companyName: "Emp",
            code: "CX",
            name: "Caixa",
            institutionName: "Banco",
            institutionCode: null,
            accountType: "CHECKING",
            currency: "BRL",
            agencyMasked: "***",
            accountNumberMasked: "***",
            includeInConsolidated: true,
            minimumBalance: "0.00",
            allowNegativeBalance: false,
            liquidity: "IMMEDIATE",
            defaultBalanceOrigin: "MANUAL",
            sortOrder: 1,
            isActive: true,
            nomusBankAccountId: null,
            createdByUserId: "u1",
            createdAt: "2026-07-01T00:00:00.000+00:00",
            updatedAt: "2026-07-01T00:00:00.000+00:00",
            deactivatedAt: null,
            deactivatedByUserId: null,
            deactivationReason: null,
          },
        ]}
        filters={createEmptyTreasurySimpleReviewFilters("2026-07-28")}
        error={null}
        page={1}
        totalPages={2}
        canManage
        canPromise
        canCollect
        onFiltersChange={noop}
        onRefresh={noop}
        onPageChange={noop}
        onOpenDetails={noop}
      />
    );
    assert.match(html, new RegExp(TREASURY_SIMPLE_RECEIVABLES_REVIEW_TITLE));
    assert.match(html, /Cliente Alfa/);
    assert.match(html, /Situação: Previsto para hoje/);
    assert.match(html, /Expectativa local/);
    assert.match(html, /Abrir detalhes/);
    assert.match(html, /Página 1 de 2/);
    assert.match(html, /grid-cols-1/);
    assert.match(html, />Vencido</);
    assert.match(html, />Em aberto</);
    assert.doesNotMatch(html, />SETTLED</);
    assert.doesNotMatch(html, />OVERDUE</);
  });

  it("pagamentos: painel simples e rotas preservadas sem escrita Nomus", () => {
    const html = render(
      <TreasurySimplePayablesReviewPanel
        viewKind="empty"
        rows={[]}
        accounts={[]}
        filters={createEmptyTreasurySimpleReviewFilters("2026-07-28")}
        error={null}
        page={1}
        totalPages={1}
        canProgram
        onFiltersChange={noop}
        onRefresh={noop}
        onPageChange={noop}
        onOpenDetails={noop}
      />
    );
    assert.match(html, /treasury-simple-payables-empty/);

    const mod = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(mod, /path="today\/receivables"/);
    assert.match(mod, /path="today\/payables"/);
    assert.match(mod, /TreasurySimpleReceivablesReviewPage/);
    assert.match(mod, /TreasurySimplePayablesReviewPage/);

    const recvPage = readFileSync(
      join(
        repoRoot,
        "src/components/finance/treasury/TreasurySimpleReceivablesReviewPage.tsx"
      ),
      "utf8"
    );
    const payPage = readFileSync(
      join(
        repoRoot,
        "src/components/finance/treasury/TreasurySimplePayablesReviewPage.tsx"
      ),
      "utf8"
    );
    assert.doesNotMatch(
      recvPage + payPage,
      /nomusAccounts(Receivable|Payable)\.(create|update|upsert|delete)/i
    );
    assert.match(recvPage, /TreasuryReceivableDetailDrawer/);
    assert.match(payPage, /TreasuryPayableDetailDrawer/);
  });
});
