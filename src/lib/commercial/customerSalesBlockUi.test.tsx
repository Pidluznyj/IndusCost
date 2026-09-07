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
const DOMAIN = "src/lib/commercial/customerSalesBlock.ts";
const PO360 = "src/lib/nomus/nomusPurchaseOrder360.ts";

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

const unresolved: CustomerSalesBlockPublic = {
  blocked: true,
  reason: "FINANCIAL_IDENTITY_UNRESOLVED",
  resolution: "UNRESOLVED_IDENTITY_CONFLICT",
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

  it("cliente bloqueado por boleto: [Ativo] [Venda bloqueada] em vermelho com ícone e tooltip de boleto", () => {
    const html = renderToStaticMarkup(
      <>
        <CustomerCadastralStatusBadge status="ACTIVE" />
        <CustomerSalesBlockBadge salesBlock={blocked} />
      </>
    );
    assert.match(html, /Ativo/);
    assert.match(html, /Venda bloqueada/);
    assert.match(html, /text-red-700/);
    assert.match(html, /data-reason="OVERDUE_BOLETO"/);
    assert.match(html, /lucide-lock|data-testid="customer-sales-block-badge"/);
    assert.match(html, /title="Venda bloqueada: 2 boletos vencidos, com R\$\s?18\.450,00 em aberto\./);
  });

  it("identidade não validada: badge vermelho, mas tooltip NÃO afirma boleto vencido", () => {
    const html = renderToStaticMarkup(<CustomerSalesBlockBadge salesBlock={unresolved} />);
    assert.match(html, /Venda bloqueada/);
    assert.match(html, /text-red-700/);
    assert.match(html, /data-reason="FINANCIAL_IDENTITY_UNRESOLVED"/);
    assert.match(html, /title="Venda bloqueada: não foi possível validar a situação financeira do cliente\."/);
    assert.doesNotMatch(html, /boleto/i);
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

  it("Nova venda fica disabled nos dois motivos, com a dica certa; Novo orçamento permanece", () => {
    const overdue = renderToStaticMarkup(
      <>
        <CustomerNewSaleButton salesBlock={blocked} />
        <CustomerNewQuoteButton />
      </>
    );
    assert.match(overdue, /<button[^>]*disabled=""[^>]*data-testid="customer-new-sale"/);
    assert.match(overdue, /title="Venda bloqueada: cliente possui boleto\(s\) vencido\(s\)\."/);
    assert.match(overdue, /Novo orçamento/);
    assert.match(overdue, /customer-new-quote/);
    assert.doesNotMatch(overdue, /customer-new-quote"[^>]*disabled/);

    const identity = renderToStaticMarkup(<CustomerNewSaleButton salesBlock={unresolved} />);
    assert.match(identity, /disabled=""/);
    assert.match(identity, /title="Venda bloqueada: não foi possível validar a situação financeira do cliente\."/);
    assert.doesNotMatch(identity, /boleto/i);

    const free = renderToStaticMarkup(
      <CustomerNewSaleButton salesBlock={{ blocked: false, reason: null, resolution: "RESOLVED" }} />
    );
    assert.doesNotMatch(free, /disabled=""/);
    assert.match(free, /title="Nova venda"/);
  });

  it("grid de clientes, header 360 e propostas consomem o payload sem recalcular dívida", () => {
    const page = read(PAGE);
    const header = read(HEADER);
    const proposals = read(PROPOSALS);
    assert.match(page, /CustomerSalesBlockBadge/);
    assert.match(page, /CustomerCadastralStatusBadge/);
    assert.match(page, /CustomerNewSaleButton/);
    assert.match(page, /salesBlock=\{editingCustomer\.salesBlock\}/);
    assert.match(header, /CustomerSalesBlockBadge/);
    assert.match(header, /CustomerCadastralStatusBadge/);
    assert.doesNotMatch(page, /dueDate < /);
    assert.doesNotMatch(page, /balanceReceivable/);
    assert.match(proposals, /salesBlock\?\.blocked/);
    assert.match(proposals, /customerSalesBlockButtonHint/);
  });

  it("backend da criação de venda revalida a trava e responde com o código do motivo real", () => {
    const server = read(SERVER);
    assert.match(server, /assertCustomerSalesAllowed\(prisma, proposal\.customerId\)/);
    assert.match(server, /instanceof CustomerSalesBlockedError/);
    assert.match(server, /code: error\.code/);
    assert.match(server, /generate-sales-order/);
    // único salesOrder.create local continua sendo o de generate-sales-order
    assert.equal((server.match(/salesOrder\.create\(/g) ?? []).length, 1);
  });

  it("boleto é decidido por paymentMethodId; o helper genérico de Compras não é autoridade de AR", () => {
    const domain = read(DOMAIN);
    assert.match(domain, /CANONICAL_AR_BOLETO_PAYMENT_METHOD_IDS: ReadonlySet<number> = new Set\(\[10\]\)/);
    assert.doesNotMatch(domain, /isBoletoPaymentMethod/);
    assert.doesNotMatch(domain, /\/boleto\/i/);
    // Purchase Order 360 continua com o seu classificador de nome, intacto.
    assert.match(read(PO360), /export function isBoletoPaymentMethod\(name: string \| null \| undefined\): boolean \{\s*return \/boleto\/i\.test\(name \?\? ""\);/);
  });
});
