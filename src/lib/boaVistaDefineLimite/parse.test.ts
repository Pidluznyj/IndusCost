import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDocument, formatCnpj, isValidCnpj } from "./cnpj.js";
import { buildBoaVistaDemoResponse } from "./fixtures.js";
import { maskBoaVistaDocument, parseBoaVistaDefineLimite, parseBrlToCents, redactBoaVistaRawPayload } from "./parse.js";

const CNPJ = "11444777000161";

describe("parser Boa Vista Define Limite Positivo PJ (campos documentados, defensivo)", () => {
  it("fixture sintética completa: score como texto e número, classe, PD, limite em centavos, restrições contadas, sócios mascarados", () => {
    const parsed = parseBoaVistaDefineLimite(buildBoaVistaDemoResponse({ cnpj: CNPJ, now: new Date("2026-10-28T12:00:00Z") }));
    assert.equal(parsed.insufficient, false);
    assert.equal(parsed.partial, false);
    assert.equal(parsed.scoreRaw, "593");
    assert.equal(parsed.score, 593);
    assert.equal(parsed.scoreClass, "B");
    assert.equal(parsed.defaultProbability, "13,0");
    assert.equal(parsed.suggestedLimitCents, 31670000);
    assert.equal(parsed.suggestedLimitLabel, "316700,00");
    assert.equal(parsed.sections.limit.available, true);
    assert.equal(parsed.confirmedRestriction, true);
    assert.equal(parsed.restrictionCount, 1 + 6 + 3 + 0 + 0 + 0);
    assert.equal(parsed.sections.restrictions.protests.totalCents, 5148131);
    assert.equal(parsed.sections.restrictions.protests.items.length, 1);
    assert.equal(parsed.sections.restrictions.bankruptcyRecovery.present, true);
    assert.equal(parsed.sections.restrictions.bankruptcyRecovery.countNumber, 0);
    assert.equal(parsed.sections.governance.partners[0]?.document, "•••91");
    assert.doesNotMatch(JSON.stringify(parsed.sections), /00000000191/);
    assert.equal(parsed.sections.financialBehavior.creditObtained?.series.length, 12);
    assert.equal(parsed.sections.score.scale, null);
    assert.match(parsed.sections.score.scaleNote, /não é convertido/);
    assert.equal(parsed.sections.providerMeta.queryId?.startsWith("demo-"), true);
    assert.equal(parsed.sections.identification.companyName, "EMPRESA DEMONSTRACAO LTDA (SIMULADO)");
    assert.equal(parsed.sections.identification.capitalLabel, "900000,00");
  });

  it("limite ausente: available=false, sem zero inventado; score ausente: null; nós ausentes = informação indisponível", () => {
    const parsed = parseBoaVistaDefineLimite({
      metaDados: { consultaUid: "uid-1", resultado: "Sucesso" },
      retorno: { cnpj: CNPJ, razaoSocial: "EMPRESA X", restricoes: { protestos: { quantidade: "2", valorTotal: "100,00", ocorrencias: [] } } },
    });
    assert.equal(parsed.insufficient, false);
    assert.equal(parsed.partial, true, "sem bloco de score = parcial");
    assert.equal(parsed.score, null);
    assert.equal(parsed.scoreRaw, null);
    assert.equal(parsed.suggestedLimitCents, null);
    assert.equal(parsed.sections.limit.available, false);
    assert.equal(parsed.sections.limit.valueLabel, null);
    assert.equal(parsed.sections.restrictions.financialPending.present, false, "nó ausente não é 'sem pendência'");
    assert.equal(parsed.sections.restrictions.financialPending.countNumber, null);
    assert.equal(parsed.confirmedRestriction, true);
    assert.equal(parsed.restrictionCount, 2);
    assert.deepEqual(parsed.sections.unavailable, ["score", "limiteCredito", "indicadores", "governancas"]);
  });

  it("valores monetários nulos ou não numéricos ficam como rótulo sem número", () => {
    assert.deepEqual(parseBrlToCents(null), { label: null, cents: null });
    assert.deepEqual(parseBrlToCents(""), { label: null, cents: null });
    assert.deepEqual(parseBrlToCents("NAO INFORMADO"), { label: "NAO INFORMADO", cents: null });
    assert.deepEqual(parseBrlToCents("R$ 316.700,00"), { label: "R$ 316.700,00", cents: 31670000 });
    assert.deepEqual(parseBrlToCents("26003.86"), { label: "26003.86", cents: 2600386 });
    assert.deepEqual(parseBrlToCents("0,00"), { label: "0,00", cents: 0 });
    const numeric = parseBrlToCents(12.5);
    assert.deepEqual({ label: numeric.label?.replace(/ /g, " "), cents: numeric.cents }, { label: "R$ 12,50", cents: 1250 });
    const parsed = parseBoaVistaDefineLimite({ metaDados: {}, retorno: { razaoSocial: "X", score: { score: "ABC" }, restricoes: { limiteCredito: { valor: null, descricao: "SEM LIMITE" } } } });
    assert.equal(parsed.score, null);
    assert.equal(parsed.scoreRaw, "ABC");
    assert.equal(parsed.sections.limit.available, false);
    assert.equal(parsed.sections.limit.description, "SEM LIMITE");
  });

  it("resposta inesperada (sem retorno, array, string) é insuficiente, não quebra", () => {
    for (const body of [null, "texto", [], {}, { metaDados: { resultado: "Sucesso" } }, { retorno: null }]) {
      const parsed = parseBoaVistaDefineLimite(body);
      assert.equal(parsed.insufficient, true, JSON.stringify(body));
      assert.equal(parsed.confirmedRestriction, false);
      assert.equal(parsed.restrictionCount, null);
    }
  });

  it("retorno parcial da fixture: só cadastro → parcial, sem restrição confirmada, sem limite", () => {
    const parsed = parseBoaVistaDefineLimite(buildBoaVistaDemoResponse({ cnpj: CNPJ, variant: "partial" }));
    assert.equal(parsed.insufficient, false);
    assert.equal(parsed.partial, true);
    assert.equal(parsed.confirmedRestriction, false);
    assert.equal(parsed.restrictionCount, null);
    assert.equal(parsed.sections.limit.available, false);
  });

  it("retorno bruto redigido: sem e-mail/telefones, documentos de pessoas mascarados", () => {
    const raw = redactBoaVistaRawPayload({ metaDados: { consultaUid: "u" }, retorno: { email: "x@y", telefones: [{ numero: "1" }], governancas: { socios: [{ nome: "A", documento: "12345678901" }] } } }) as {
      retorno: { email?: unknown; telefones?: unknown; governancas: { socios: Array<{ documento: string }> } };
    };
    assert.equal(raw.retorno.email, undefined);
    assert.equal(raw.retorno.telefones, undefined);
    assert.equal(raw.retorno.governancas.socios[0]?.documento, "•••01");
    assert.equal(maskBoaVistaDocument("123"), "documento informado");
    assert.equal(maskBoaVistaDocument(null), null);
  });

  it("CNPJ: válido, dígitos repetidos, CPF (pessoa física) e formatação", () => {
    assert.equal(isValidCnpj(CNPJ), true);
    assert.equal(isValidCnpj("11.444.777/0001-61"), true);
    assert.equal(isValidCnpj("11444777000162"), false);
    assert.equal(isValidCnpj("11111111111111"), false);
    assert.equal(classifyDocument("123.456.789-09"), "CPF");
    assert.equal(classifyDocument(CNPJ), "CNPJ");
    assert.equal(classifyDocument(""), "INVALID");
    assert.equal(formatCnpj(CNPJ), "11.444.777/0001-61");
  });
});
