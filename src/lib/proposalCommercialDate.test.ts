/**
 * Data comercial da proposta — CP 01350 é o caso de referência:
 * aberta no Nomus em 03/08/2026, importada no IndusCost em 04/08/2026.
 * A tela mostrava 04/08 porque lia `createdAt`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatProposalCommercialDate,
  isExternalSourcedProposal,
  isProposalCommercialDateFallback,
  resolveProposalCommercialDate,
} from "./proposalCommercialDate.js";

const CP_01350 = {
  sourceSystem: "NOMUS",
  externalOpenedAt: new Date(2026, 7, 3), // 03/08/2026
  createdAt: new Date(2026, 7, 4), // 04/08/2026 — importação
};

describe("proposalCommercialDate — proposta Nomus", () => {
  it("CP 01350 usa a data de abertura do Nomus, não a da importação", () => {
    const date = resolveProposalCommercialDate(CP_01350)!;
    assert.equal(date.getDate(), 3);
    assert.equal(date.getMonth(), 7);
    assert.equal(date.getFullYear(), 2026);
  });

  it("createdAt de 04/08 não substitui a data oficial", () => {
    assert.equal(formatProposalCommercialDate(CP_01350), "03/08/2026");
    assert.notEqual(formatProposalCommercialDate(CP_01350), "04/08/2026");
  });

  it("não é fallback quando a data de origem existe", () => {
    assert.equal(isProposalCommercialDateFallback(CP_01350), false);
  });
});

describe("proposalCommercialDate — fallback documentado", () => {
  it("proposta Nomus sem data de origem cai em createdAt", () => {
    const p = {
      sourceSystem: "NOMUS",
      externalOpenedAt: null,
      createdAt: new Date(2026, 7, 4),
    };
    assert.equal(formatProposalCommercialDate(p), "04/08/2026");
  });

  it("e esse caso é sinalizado como fallback", () => {
    assert.equal(
      isProposalCommercialDateFallback({
        sourceSystem: "NOMUS",
        externalOpenedAt: null,
        createdAt: new Date(2026, 7, 4),
      }),
      true
    );
  });

  it("data de origem inválida também cai no fallback sinalizado", () => {
    const p = {
      sourceSystem: "NOMUS",
      externalOpenedAt: "não é data",
      createdAt: new Date(2026, 7, 4),
    };
    assert.equal(isProposalCommercialDateFallback(p), true);
    assert.equal(formatProposalCommercialDate(p), "04/08/2026");
  });
});

describe("proposalCommercialDate — proposta nascida no IndusCost", () => {
  it("usa createdAt e NÃO é fallback (ela nasceu aqui)", () => {
    const p = {
      sourceSystem: null,
      externalOpenedAt: null,
      createdAt: new Date(2026, 7, 4),
    };
    assert.equal(formatProposalCommercialDate(p), "04/08/2026");
    assert.equal(isProposalCommercialDateFallback(p), false);
  });

  it("ignora externalOpenedAt residual quando não há origem externa", () => {
    const p = {
      sourceSystem: null,
      externalOpenedAt: new Date(2020, 0, 1),
      createdAt: new Date(2026, 7, 4),
    };
    assert.equal(formatProposalCommercialDate(p), "04/08/2026");
  });

  it("sourceSystem vazio ou só espaços não conta como externa", () => {
    assert.equal(isExternalSourcedProposal(""), false);
    assert.equal(isExternalSourcedProposal("   "), false);
    assert.equal(isExternalSourcedProposal("NOMUS"), true);
  });
});

describe("proposalCommercialDate — bordas", () => {
  it("sem nenhuma data devolve null e formata como travessão", () => {
    const p = { sourceSystem: "NOMUS", externalOpenedAt: null, createdAt: null };
    assert.equal(resolveProposalCommercialDate(p), null);
    assert.equal(formatProposalCommercialDate(p), "—");
  });

  it("aceita string ISO em qualquer um dos campos", () => {
    const p = {
      sourceSystem: "NOMUS",
      externalOpenedAt: "2026-08-03T00:00:00-03:00",
      createdAt: "2026-08-04T10:00:00-03:00",
    };
    assert.equal(resolveProposalCommercialDate(p)!.getDate(), 3);
  });
});
