import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FinancialBehaviorPanel, providerNumber, trendOf } from "./LikeSerasaBehavior";

const MONTHS = ["OUT/2025", "NOV/2025", "DEZ/2025", "JAN/2026", "FEV/2026", "MAR/2026", "ABR/2026", "MAI/2026", "JUN/2026", "JUL/2026", "AGO/2026", "SET/2026"];
const series = (values: Array<string | null>) => MONTHS.map((period, i) => ({ period, value: values[i] ?? null }));
const cents = (value: number | null) => (value == null ? "—" : (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

// Mesmo retorno da ficha que motivou a mudança (COLOR VISAO, 29/10/2026).
function sections(late: Array<{ description: string; values: Array<string | null> }>) {
  return {
    financialBehavior: {
      present: true,
      punctualPayments: { score: "100", series: series(["100", "100", "100", "100", "100", "99", "100", "100", "100", "100", "100", "100"]) },
      commitments: { score: "0.9", series: series(["0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0", "0.1", "0.1", "0.1", "0", "0"]) },
      creditObtained: { score: "26044", series: series(["2601", "3114", "2725", "2600", "2645", "3033", "2856", "2921", "1548", "1629", "237", "135"]) },
      latePayments: late.map((row) => ({ description: row.description, score: "0", series: series(row.values) })),
      businessEvents: null,
      supplierRelationship: { score: null, items: ["ATE 6 MESES", "DE 7 A 12 MESES", "DE 1 A 2 ANOS", "DE 3 A 5 ANOS", "DE 6 A 10 ANOS", "MAIS DE 10 ANOS"].map((period) => ({ period, value: "0" })) },
    },
    revenue: { range: "15", annualLabel: null, presumedLabel: null, presumedCents: null, referenceDate: null, message: null },
  } as never;
}

const NO_LATE = [
  { description: "PAGTO ATRASADO - 6 A 15 DIAS", values: [null, null, null, null, null, "0", null, null, null, null, null, null] },
  { description: "PAGTO ATRASADO - 16 A 30 DIAS", values: [] },
  { description: "PAGTO ATRASADO - 31 A 60 DIAS", values: [] },
  { description: "PAGTO ATRASADO - MAIS DE 60 DIAS", values: [] },
  { description: "PAGTO ATRASADO - MEDIA EM DIAS", values: Array(12).fill("0") },
];

describe("LIKE SERASA › comportamento de pagamento", () => {
  it("lê os números do provedor (inteiro, decimal com ponto como no retorno ou com vírgula, vazio)", () => {
    assert.equal(providerNumber("2601"), 2601);
    assert.equal(providerNumber("0,9"), 0.9);
    assert.equal(providerNumber("0.1"), 0.1);
    assert.equal(providerNumber("26044"), 26044);
    assert.equal(providerNumber("—"), null);
    assert.equal(providerNumber(null), null);
  });

  it("tendência dos 3 últimos meses contra os 3 anteriores", () => {
    assert.equal(trendOf(series(["2601", "3114", "2725", "2600", "2645", "3033", "2856", "2921", "1548", "1629", "237", "135"])), "down");
    assert.equal(trendOf(series(Array(12).fill("100"))), "flat");
    assert.equal(trendOf(series(["1", "1", "1", "1", "1", "1", "1", "1", "1", "5", "5", "5"])), "up");
    assert.equal(trendOf(series(["1", "2"])), null);
  });

  it("cada indicador vira um cartão com significado, último mês, gráfico de 12 meses e tendência; sem atraso vira um resumo", () => {
    const html = renderToStaticMarkup(<FinancialBehaviorPanel sections={sections(NO_LATE)} cents={cents} />);
    for (const id of ["punctual", "commitments", "credit-obtained"]) assert.match(html, new RegExp(`data-testid="like-serasa-${id}"`));
    assert.match(html, /Pontualidade nos pagamentos/);
    assert.match(html, /quanto maior, mais contas a empresa pagou no vencimento/);
    assert.match(html, /Crédito obtido[\s\S]*>135<[\s\S]*em Set\/2026/);
    assert.match(html, /total 26\.044/);
    assert.match(html, /caindo nos últimos 3 meses/);
    assert.match(html, /data-testid="like-serasa-no-late"/);
    assert.match(html, /Nenhum pagamento em atraso registrado nos últimos 12 meses/);
    assert.match(html, /Nenhum relacionamento com fornecedores informado/);
    assert.match(html, /Faixa 15/);
    assert.match(html, /Não é o faturamento realizado/);
    assert.doesNotMatch(html, /unidade não documentada\)/, "sem o jargão repetido em cada linha");
    assert.doesNotMatch(html, /OUT\/2025: 100/, "sem a fileira de etiquetas mês a mês");
  });

  it("com atraso: tabela por faixa e mês, destacando só os meses com atraso", () => {
    const late = [{ description: "PAGTO ATRASADO - 16 A 30 DIAS", values: [null, null, null, "2", null, null, null, null, null, null, null, null] }, ...NO_LATE.slice(2)];
    const html = renderToStaticMarkup(<FinancialBehaviorPanel sections={sections(late)} cents={cents} />);
    assert.doesNotMatch(html, /like-serasa-no-late/);
    assert.match(html, /16 a 30 dias/);
    assert.match(html, /bg-red-50 font-bold text-red-800">2</);
    assert.match(html, /atraso médio \(dias\)/);
  });

  it("sem a seção no retorno: aviso único", () => {
    const html = renderToStaticMarkup(<FinancialBehaviorPanel sections={{ financialBehavior: { present: false } } as never} cents={cents} />);
    assert.match(html, /Informação indisponível neste retorno/);
  });
});
