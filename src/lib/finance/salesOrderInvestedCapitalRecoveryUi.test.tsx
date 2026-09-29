/**
 * Recuperação do Dinheiro Investido — render estático real das seções da
 * Visão Geral, do painel Por Cliente e dos dois PDFs sobre um payload montado
 * pelos motores puros (snapshot → totais → agregação por cliente). Garante
 * que a tela só mostra o que o DTO traz, que os blocos existem, que a
 * nomenclatura é a pedida e que nada vira "Lucro". Loader vazio para `.css`.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_BRANDING } from "@/src/types/branding";
import {
  buildSalesOrderInvestedCapitalRecoverySnapshot,
  type SalesOrderInvestedCapitalRecoverySnapshot,
} from "./salesOrderInvestedCapitalRecoverySnapshot.js";
import { buildInvestedCapitalRecoveryComparableTotals } from "./salesOrderInvestedCapitalRecoveryTotals.js";
import { aggregateInvestedCapitalRecoveryByCustomer } from "./salesOrderInvestedCapitalRecoveryByCustomer.js";
import { INVESTED_CAPITAL_AGING_BUCKET_LABELS } from "./salesOrderInvestedCapitalRecoveryMath.js";
import type { InvestedCapitalRecoveryPayload } from "../../components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes.js";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

let economicModule: typeof import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryEconomicSection.js");
let realizedModule: typeof import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRealizedSection.js");
let receivablesModule: typeof import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryReceivablesSection.js");
let executiveModule: typeof import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryExecutiveSection.js");
let panelModule: typeof import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPanel.js");
let printModule: typeof import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.js");
let customerPrintModule: typeof import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPrintDocument.js");

before(async () => {
  economicModule = await import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryEconomicSection.js");
  realizedModule = await import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRealizedSection.js");
  receivablesModule = await import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryReceivablesSection.js");
  executiveModule = await import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryExecutiveSection.js");
  panelModule = await import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPanel.js");
  printModule = await import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.js");
  customerPrintModule = await import("../../components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPrintDocument.js");
});

const TODAY = "2026-09-01";

function order(input: { id: string; customerId: string | null; sale: number; capital: number | null; received: number; outstanding: number }): SalesOrderInvestedCapitalRecoverySnapshot {
  return buildSalesOrderInvestedCapitalRecoverySnapshot(
    {
      salesOrderId: input.id,
      orderCode: `PD ${input.id}`,
      customerId: input.customerId,
      issueDate: "2026-08-10",
      customerName: input.customerId ? `Cliente ${input.customerId}` : null,
      sellerName: null,
      saleValue: input.sale,
      invoicedValue: input.sale,
      investedCapital: input.capital,
      investedCapitalUnavailableReason: input.capital == null ? "Custo publicado não localizado na data do pedido" : null,
      orderStatus: "SENT_TO_NOMUS",
      orderStatusLabel: "Enviado",
      industrialCost: input.capital == null ? null : Math.round(input.capital * 80) / 100,
      totalTaxes: input.capital == null ? null : Math.round(input.capital * 20) / 100,
      taxSourceLabel: null,
      realReceivables: [
        { externalId: 1, dueDate: "2026-06-01", settlementDate: "2026-06-05", amountReceivable: input.received, amountReceived: input.received, balanceReceivable: 0 },
        { externalId: 2, dueDate: "2026-10-01", settlementDate: null, amountReceivable: input.outstanding, amountReceived: 0, balanceReceivable: input.outstanding },
      ],
    },
    TODAY
  );
}

/** Mesmo encadeamento do serviço, sem banco: snapshot → KPIs raiz → totais comparáveis → por cliente. */
function buildPayload(): InvestedCapitalRecoveryPayload {
  const rows = [
    order({ id: "A", customerId: "x", sale: 100, capital: 60, received: 75, outstanding: 25 }),
    order({ id: "C", customerId: "x", sale: 100, capital: 60, received: 10, outstanding: 20 }),
    order({ id: "E", customerId: "y", sale: 100, capital: 110, received: 60, outstanding: 40 }),
    order({ id: "D", customerId: "y", sale: 100, capital: null, received: 50, outstanding: 50 }),
  ];
  const cents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  const sum = (pick: (r: SalesOrderInvestedCapitalRecoverySnapshot) => number | null, subset = rows) =>
    cents(subset.reduce((acc, r) => acc + (pick(r) ?? 0), 0));
  const withCapital = rows.filter((r) => r.capitalRecovered != null);
  const totals = buildInvestedCapitalRecoveryComparableTotals(rows);
  const byCustomer = aggregateInvestedCapitalRecoveryByCustomer(rows);
  return {
    ok: true,
    generatedAt: "2026-09-01T12:00:00.000Z",
    totalOrdersInScope: rows.length,
    truncated: false,
    kpis: {
      moneyOnStreetToday: sum((r) => r.moneyOnStreet, withCapital),
      capitalRecoveredTotal: sum((r) => r.capitalRecovered, withCapital),
      investedCapitalAnalyzedTotal: sum((r) => r.investedCapital, withCapital),
      totalOutstandingReceivable: sum((r) => r.outstandingReceivable),
      ordersFullyRecoveredCount: rows.filter((r) => r.status === "CAPITAL_RECUPERADO").length,
      ordersPartiallyRecoveredCount: rows.filter((r) => r.status === "EM_RECUPERACAO").length,
      ordersInsufficientDataCount: rows.filter((r) => r.status === "DADOS_INSUFICIENTES").length,
      averageDaysToRecoverCapital: null,
      totalSaleValueAnalyzed: sum((r) => r.saleValue),
      totalIndustrialCostAnalyzed: sum((r) => r.industrialCost, withCapital),
      totalTaxesAnalyzed: sum((r) => r.totalTaxes, withCapital),
      ...totals,
    },
    agingBuckets: (Object.keys(INVESTED_CAPITAL_AGING_BUCKET_LABELS) as Array<keyof typeof INVESTED_CAPITAL_AGING_BUCKET_LABELS>).map((key) => ({
      key,
      label: INVESTED_CAPITAL_AGING_BUCKET_LABELS[key],
      amount: key === "d31to60" ? 100 : 0,
    })),
    topCustomers: [{ customerName: "Cliente x", moneyOnStreet: 50, percentOfTotal: 50 }],
    rows,
    byCustomer,
    populationDiagnostics: null,
  };
}

function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(value).replace(/ /g, " ");
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}

describe("Recuperação do Dinheiro Investido — render das seções (Visão Geral)", () => {
  it("bloco 1 mostra Vendemos, Capital investido, Margem econômica e Dados insuficientes com os números do DTO e as duas fórmulas", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(<economicModule.InvestedCapitalRecoveryEconomicSection kpis={payload.kpis} ordersCount={payload.rows.length} />);
    const t = text(html);
    assert.match(t, /1\. Economia dos pedidos/);
    assert.match(t, /O que foi vendido e quanto dessa venda representa capital × margem/);
    assert.match(t, /Vendemos/);
    assert.match(t, /Capital investido/);
    assert.match(t, /Margem econômica dos PVs/);
    assert.match(t, /Pedidos com dados insuficientes/);
    assert.match(t, /Composição do capital investido/);
    assert.match(t, /Leitura econômica/);
    // Venda comparável = capital + margem: A 100, C 100, E 100 → 300 = 230 + 70.
    assert.equal(payload.kpis.comparableSaleValueTotal, 300);
    assert.equal(payload.kpis.investedCapitalAnalyzedTotal, 230);
    assert.equal(payload.kpis.economicMarginTotal, 70);
    assert.match(t, new RegExp(brl(300).replace(/[.$]/g, "\\$&")));
    assert.match(t, new RegExp(brl(230).replace(/[.$]/g, "\\$&")));
    assert.match(t, new RegExp(brl(70).replace(/[.$]/g, "\\$&")));
    assert.match(html, /data-testid="icr-formula-sale"/);
    assert.match(html, /data-testid="icr-formula-capital"/);
    assert.match(t, /Custo industrial/);
    assert.match(t, /Imposto/);
    assert.match(html, /metric-card--margin/); // margem positiva no tom nativo de margem
    assert.doesNotMatch(t, /\bLucro\b/i);
  });

  it("margem econômica negativa fica visível e em tom de risco", () => {
    const payload = buildPayload();
    const kpis = { ...payload.kpis, economicMarginTotal: -12.34 };
    const html = renderToStaticMarkup(<economicModule.InvestedCapitalRecoveryEconomicSection kpis={kpis} ordersCount={4} />);
    assert.match(text(html), /-R\$ 12,34|R\$ -12,34|−R\$ 12,34/);
    assert.match(html, /metric-card--danger/);
  });

  it("bloco 2 mostra capital recuperado, ganho realizado, recebido comparável e a barra de recuperação com percentuais do DTO", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(<realizedModule.InvestedCapitalRecoveryRealizedSection kpis={payload.kpis} />);
    const t = text(html);
    assert.match(t, /2\. O que já aconteceu/);
    assert.match(t, /Capital recuperado/);
    assert.match(t, /Ganho já realizado/);
    assert.match(t, /Total recebido/);
    assert.match(t, /Recuperação do capital investido/);
    assert.match(html, /data-testid="icr-recovery-bar"/);
    // A 60 + C 10 + E 60 = 130 recuperado; ganho realizado só A (15); recebido comparável 145.
    assert.equal(payload.kpis.capitalRecoveredTotal, 130);
    assert.equal(payload.kpis.realizedGainTotal, 15);
    assert.equal(payload.kpis.actualReceivedComparableTotal, 145);
    assert.match(t, new RegExp(brl(145).replace(/[.$]/g, "\\$&")));
    // Percentuais vêm prontos: 130/230 = 56,52% e 100/230 = 43,48%.
    assert.match(html, /width:56\.52%/);
    assert.match(html, /width:43\.48%/);
    // Recebido total (inclusive D) aparece como nota, sem virar recebido comparável.
    assert.match(t, new RegExp(brl(195).replace(/[.$]/g, "\\$&")));
  });

  it("bloco 3 mostra falta receber, capital a recuperar, ganho a receber, capital sem CR e a parcela não classificada", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <receivablesModule.InvestedCapitalRecoveryReceivablesSection kpis={payload.kpis}>
        <div data-testid="aging-slot" />
      </receivablesModule.InvestedCapitalRecoveryReceivablesSection>
    );
    const t = text(html);
    assert.match(t, /3\. O que ainda tem para entrar/);
    assert.match(t, /Falta receber/);
    assert.match(t, /Capital a recuperar nos CRs/);
    assert.match(t, /Ganho a receber/);
    assert.match(t, /Capital na rua sem CR aberto/);
    assert.match(t, /Não classificado/);
    assert.match(t, /Regra por PV/);
    assert.match(html, /data-testid="icr-receivables-bar"/);
    assert.match(html, /data-testid="icr-formula-money-on-street"/);
    assert.match(html, /data-testid="aging-slot"/);
    // A 0+25, C 20+0, E 40+0, D 50 não classificado → 135 = 60 + 25 + 50.
    assert.equal(payload.kpis.totalOutstandingReceivable, 135);
    assert.equal(payload.kpis.capitalReceivableCoveredTotal, 60);
    assert.equal(payload.kpis.gainReceivableTotal, 25);
    assert.equal(payload.kpis.outstandingReceivableUnclassifiedTotal, 50);
    assert.equal(payload.kpis.capitalWithoutOpenReceivableTotal, 40);
    assert.match(t, new RegExp(brl(135).replace(/[.$]/g, "\\$&")));
  });

  it("bloco 4 mostra a leitura gerencial e o prazo médio indisponível como '—' (nunca inventado)", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(<executiveModule.InvestedCapitalRecoveryExecutiveSection kpis={payload.kpis} />);
    const t = text(html);
    assert.match(t, /4\. Leitura gerencial/);
    assert.match(t, /Soma do valor dos PVs/);
    assert.match(t, /Custo industrial \+ imposto/);
    assert.match(t, /Recuperaram capital/);
    assert.match(t, /Parcialmente recuperados/);
    assert.match(t, /Prazo médio realizado/);
    assert.match(t, /Indisponível: sem evidência de data de saída/);
    assert.match(t, /Ganho a receber/);
  });
});

describe("Recuperação do Dinheiro Investido — render Por Cliente e PDFs", () => {
  it("painel por cliente mostra os novos conceitos agregados por cliente sem recalcular", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <panelModule.InvestedCapitalRecoveryCustomerPanel byCustomer={payload.byCustomer!} rows={payload.rows} onOpenOrder={() => {}} />
    );
    const t = text(html);
    for (const label of ["Margem econômica", "Falta receber", "Capital a recuperar nos recebíveis", "Ganho a receber", "Capital na rua sem CR aberto", "Saldo econômico atual"]) {
      assert.match(t, new RegExp(label));
    }
    assert.doesNotMatch(t, /Resultado potencial/);
    // Cliente y: margem −10 (E) e CR não classificado de D entra em "Falta receber" (90).
    const y = payload.byCustomer!.customers.find((row) => row.customerId === "y")!;
    assert.equal(y.economicMargin, -10);
    assert.equal(y.outstandingReceivable, 90);
    assert.match(t, new RegExp(brl(90).replace(/[.$]/g, "\\$&")));
  });

  it("PDF da visão geral tem os 4 blocos, as fórmulas, a tabela com as novas colunas e o rodapé com totais do DTO", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <printModule.InvestedCapitalRecoveryPrintDocument payload={payload} branding={DEFAULT_BRANDING} filterLabels="Ano: 2026" />
    );
    const t = text(html);
    assert.match(html, /id="sales-orders-print-root"/);
    for (const title of ["1. Economia dos pedidos", "2. O que já aconteceu", "3. O que ainda tem para entrar", "4. Leitura gerencial", "5. Detalhamento por pedido"]) {
      assert.match(t, new RegExp(title.replace(".", "\\.")));
    }
    assert.match(t, /Venda comparável = Capital investido \+ Margem econômica/);
    assert.match(t, /Capital investido = Custo industrial \+ Imposto/);
    for (const col of ["Margem", "G. realiz.", "Cap. no CR", "G. a rec.", "Cap. s/ CR"]) {
      assert.match(t, new RegExp(col.replace(/[./]/g, "\\$&")));
    }
    // Rodapé: recebido TOTAL (inclui D) = 195; margem 70.
    assert.match(t, new RegExp(brl(195).replace(/[.$]/g, "\\$&")));
    assert.match(t, new RegExp(brl(70).replace(/[.$]/g, "\\$&")));
    assert.doesNotMatch(t, /\bLucro\b/i);
  });

  it("PDF por cliente traz os novos campos por cliente", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <customerPrintModule.InvestedCapitalRecoveryCustomerPrintDocument byCustomer={payload.byCustomer!} generatedAt={payload.generatedAt} branding={DEFAULT_BRANDING} filterLabels="" />
    );
    const t = text(html);
    for (const label of ["Margem econ.", "Falta receber", "Cap. no CR", "Ganho a rec.", "Cap. s/ CR", "Capital na rua sem CR aberto"]) {
      assert.match(t, new RegExp(label.replace(/[./]/g, "\\$&")));
    }
  });
});
