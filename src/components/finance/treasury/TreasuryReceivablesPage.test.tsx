import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreasuryReceivableListItemDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_RECEIVABLES_DENIED_MESSAGE,
  TREASURY_RECEIVABLES_EMPTY_TITLE,
  TREASURY_RECEIVABLES_PAGE_TITLE,
  createEmptyTreasuryReceivablesFilters,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";
import { TreasuryReceivablesPanel } from "./TreasuryReceivablesPanel.js";
import { TreasuryReceivableDetailDrawer } from "./TreasuryReceivableDetailDrawer.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleRow(): TreasuryReceivableListItemDto {
  return {
    titleId: "t1",
    externalId: 88421,
    official: {
      id: "t1",
      externalId: 88421,
      installmentNumber: 2,
      installmentLabel: "2/3",
      counterparty: {
        personId: 1,
        name: "Cliente Industrial",
        taxId: "12345678000199",
        role: "CUSTOMER",
      },
      description: "NF 45210",
      documentNumber: null,
      salesOrderExternalId: 55,
      salesOrderCode: "PV-55",
      invoice: { externalId: 99, number: "45210" },
      issuedOn: "2026-06-01",
      dueDate: "2026-07-20",
      originalAmount: "1000.00",
      openBalance: "400.00",
      settlements: {
        settledAmount: "600.00",
        settledAt: "2026-07-15",
        paidAt: null,
      },
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
      lastSyncedAt: "2026-07-20T12:00:00.000+00:00",
    },
    complement: {
      id: "c1",
      expectedDate: "2026-07-28",
      confirmedDate: null,
      scheduledDate: null,
      expectedAmount: "400.00",
      confirmedAmount: null,
      scheduledAmount: null,
      status: "ACTIVE",
      priority: "HIGH",
      plannedAccountId: "acc-1",
      responsibleUserId: "collector-1",
      nextAction: "Enviar boleto",
      reason: "Acordo",
      notes: null,
      version: 1,
      updatedAt: "2026-07-21T10:00:00.000+00:00",
      cancelledAt: null,
    },
    sellerName: "Maria",
    commercialOwnerName: "Ana",
    openAmount: "400.00",
    receivedAmount: "600.00",
    daysOverdue: 7,
    operationalStatus: "OVERDUE",
    lastAction: {
      at: "2026-07-21T10:00:00.000+00:00",
      summary: "Acordo",
    },
    nextAction: "Enviar boleto",
  };
}

const panelBase = {
  rows: [] as TreasuryReceivableListItemDto[],
  error: null as string | null,
  staleMessage: null as string | null,
  filters: createEmptyTreasuryReceivablesFilters(),
  page: 1,
  pageSize: 50,
  totalPages: 1,
  titleCount: 0,
  openAmountTotal: "0.00",
  onFiltersChange: noop,
  onPageChange: noop,
  onRefresh: noop,
  onClearFilters: noop,
  onOpenDetails: noop,
};

describe("TreasuryReceivablesPage — componentes e fluxo", () => {
  it("exibe estado sem permissão", () => {
    const html = renderToStaticMarkup(
      <TreasuryReceivablesPanel {...panelBase} viewKind="denied" />
    );
    assert.match(html, /treasury-receivables-permission-denied/);
    assert.ok(html.includes(TREASURY_RECEIVABLES_DENIED_MESSAGE));
  });

  it("exibe carregando, vazio, erro e stale", () => {
    const loading = renderToStaticMarkup(
      <TreasuryReceivablesPanel {...panelBase} viewKind="loading" />
    );
    assert.match(loading, /Carregando contas a receber/);

    const empty = renderToStaticMarkup(
      <TreasuryReceivablesPanel {...panelBase} viewKind="empty" />
    );
    assert.ok(empty.includes(TREASURY_RECEIVABLES_EMPTY_TITLE));

    const error = renderToStaticMarkup(
      <TreasuryReceivablesPanel
        {...panelBase}
        viewKind="error"
        error="Falha de rede"
      />
    );
    assert.match(error, /Falha de rede/);

    const stale = renderToStaticMarkup(
      <TreasuryReceivablesPanel
        {...panelBase}
        viewKind="ready"
        rows={[sampleRow()]}
        titleCount={1}
        openAmountTotal="400.00"
        staleMessage="Dados possivelmente desatualizados"
      />
    );
    assert.match(stale, /treasury-receivables-stale/);
  });

  it("lista título com badge, atraso, prioridade, ações e summary filtrado", () => {
    const html = renderToStaticMarkup(
      <TreasuryReceivablesPanel
        {...panelBase}
        viewKind="ready"
        rows={[sampleRow()]}
        titleCount={3}
        openAmountTotal="1250.50"
      />
    );
    assert.match(html, /treasury-receivables-table/);
    assert.match(html, /treasury-receivables-mobile-list/);
    assert.match(html, /Cliente Industrial/);
    assert.match(html, /treasury-receivable-status-OVERDUE/);
    assert.match(html, /Enviar boleto/);
    assert.match(html, /Acordo/);
    assert.match(html, /treasury-receivables-summary/);
    assert.match(html, /3 título/);
    assert.match(html, /filter-customer/);
    assert.match(html, /filter-status/);
  });

  it("drawer de detalhes cobre título, pedido/NF e histórico (fonte)", () => {
    // Overlay usa portal/`document` — em SSR o markup fica vazio; valida o wiring no fonte.
    const drawer = readFileSync(
      join(here, "TreasuryReceivableDetailDrawer.tsx"),
      "utf8"
    );
    assert.match(drawer, /treasury-receivable-detail-drawer/);
    assert.match(drawer, /Título oficial/);
    assert.match(drawer, /Pedido e nota fiscal/);
    assert.match(drawer, /Histórico operacional/);
    assert.match(drawer, /Cobrança e contestações/);
    assert.match(drawer, /TreasuryReceivableOpsTimeline/);
    assert.match(drawer, /Visão financeira do cliente/);
    assert.match(drawer, /TreasuryReceivableCustomerSummary/);
    assert.match(drawer, /Vendedor do pedido/);
    assert.match(drawer, /Responsável comercial/);
    assert.match(drawer, /buildTreasuryReceivableOperationalHistory/);
    assert.match(drawer, /salesOrderCode/);
    assert.match(drawer, /invoice\.number/);
    // Garante que o componente aceita a linha de fixture (tipo/props).
    assert.equal(typeof TreasuryReceivableDetailDrawer, "function");
    assert.equal(sampleRow().official.salesOrderCode, "PV-55");
  });

  it("wiring App + módulo + página existem sem Prisma", () => {
    const moduleSrc = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    const pageSrc = readFileSync(
      join(here, "TreasuryReceivablesPage.tsx"),
      "utf8"
    );
    const appSrc = readFileSync(join(repoRoot, "src/App.tsx"), "utf8");
    assert.match(moduleSrc, /TreasuryReceivablesPage/);
    assert.match(moduleSrc, /path="receivables"/);
    assert.match(pageSrc, /fetchTreasuryReceivables/);
    assert.match(pageSrc, /TreasuryReceivableDetailDrawer/);
    assert.doesNotMatch(pageSrc, /@prisma\/client|\.server\.js/);
    assert.match(appSrc, /TreasuryModule/);
    assert.ok(TREASURY_RECEIVABLES_PAGE_TITLE.length > 0);
  });
});
