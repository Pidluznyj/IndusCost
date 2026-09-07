import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CustomerCadastralStatusBadge,
  CustomerNewQuoteButton,
  CustomerNewSaleButton,
  CustomerSalesBlockBadge,
} from "../../components/customers/CustomerSalesBlockBadge.js";
import type { CustomerSalesBlockPublic } from "./customerSalesBlockView.js";

const PAGE = "src/components/CustomerModule.tsx";
const HEADER = "src/components/crm/customer-intelligence/CustomerIntelligenceHeader.tsx";
const PROPOSALS = "src/components/ProposalModule.tsx";
const SERVER = "server.ts";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const blocked: CustomerSalesBlockPublic = {
  blocked: true,
  reason: "OVERDUE_BOLETO",
  resolution: "RESOLVED",
  overdueBoletoCount: 2,
  overdueOpenBalance: 18450,
  oldestDueDate: "2026-08-15",
  maxDaysOverdue: 23,
};

describe("customer sales block UI", () => {
  it("cliente liberado: só o status cadastral, sem badge vermelho", () => {
    const html = renderToStaticMarkup(
      <>
        <CustomerCadastralStatusBadge status="ACTIVE" />
        <CustomerSalesBlockBadge salesBlock={{ blocked: false, reason: null, resolution: "RESOLVED" }} />
      </>
    );
    assert.match(html, /Ativo/);
    assert.doesNotMatch(html, /Venda bloqueada/);
  });

  it("cliente bloqueado: [Ativo] [Venda bloqueada] em vermelho com ícone", () => {
    const html = renderToStaticMarkup(
      <>
        <CustomerCadastralStatusBadge status="ACTIVE" />
        <CustomerSalesBlockBadge salesBlock={blocked} />
      </>
    );
    assert.match(html, /Ativo/);
    assert.match(html, /Venda bloqueada/);
    assert.match(html, /text-red-700/);
    assert.match(html, /lucide-lock|data-testid="customer-sales-block-badge"/);
  });

  it("Inativo e Bloqueado cadastral coexistem com a trava financeira", () => {
    const inactive = renderToStaticMarkup(
      <>
        <CustomerCadastralStatusBadge status="INACTIVE" />
        <CustomerSalesBlockBadge salesBlock={blocked} />
      </>
    );
    assert.match(inactive, /Inativo/);
    assert.match(inactive, /Venda bloqueada/);
    const cadastralBlocked = renderToStaticMarkup(
      <>
        <CustomerCadastralStatusBadge status="BLOCKED" />
        <CustomerSalesBlockBadge salesBlock={blocked} />
      </>
    );
    assert.match(cadastralBlocked, /Bloqueado/);
    assert.match(cadastralBlocked, /Venda bloqueada/);
  });

  it("Nova venda fica disabled quando blocked; Novo orçamento permanece", () => {
    const html = renderToStaticMarkup(
      <>
        <CustomerNewSaleButton blocked />
        <CustomerNewQuoteButton />
      </>
    );
    assert.match(html, /disabled/);
    assert.match(html, /Nova venda/);
    assert.match(html, /Novo orçamento/);
    assert.match(html, /customer-new-quote/);
  });

  it("grid de clientes, header 360 e propostas consomem o payload sem recalcular dívida", () => {
    const page = read(PAGE);
    const header = read(HEADER);
    const proposals = read(PROPOSALS);
    assert.match(page, /CustomerSalesBlockBadge/);
    assert.match(page, /CustomerCadastralStatusBadge/);
    assert.match(page, /CustomerNewSaleButton/);
    assert.match(header, /CustomerSalesBlockBadge/);
    assert.match(header, /CustomerCadastralStatusBadge/);
    assert.doesNotMatch(page, /dueDate < /);
    assert.doesNotMatch(page, /balanceReceivable/);
    assert.match(proposals, /salesBlock\?\.blocked/);
    assert.match(proposals, /CUSTOMER_SALES_BLOCKED_BUTTON_HINT/);
  });

  it("backend da criação de venda revalida a trava", () => {
    const server = read(SERVER);
    assert.match(server, /assertCustomerSalesAllowed/);
    assert.match(server, /CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO/);
    assert.match(server, /generate-sales-order/);
  });
});
