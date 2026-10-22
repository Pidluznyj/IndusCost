import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerCreditListFilterLabel,
  parseCustomerCreditListFilter,
  portfolioDecisionMatchesCreditFilter,
} from "./customerCreditListFilter.js";

describe("filtro de situação de crédito da carteira", () => {
  it("aceita só as quatro situações oficiais", () => {
    assert.equal(parseCustomerCreditListFilter(" blocked "), "blocked");
    assert.equal(parseCustomerCreditListFilter("EM_ANALISE"), "");
    assert.equal(parseCustomerCreditListFilter(""), "");
    assert.equal(customerCreditListFilterLabel("review"), "Em análise");
    assert.equal(customerCreditListFilterLabel(""), "Todas as situações");
  });

  it("separa bloqueio, análise, leitura e liberado", () => {
    assert.equal(portfolioDecisionMatchesCreditFilter("BLOQUEADO", "blocked"), true);
    assert.equal(portfolioDecisionMatchesCreditFilter("BLOQUEIO_CRITICO", "blocked"), true);
    assert.equal(portfolioDecisionMatchesCreditFilter("EM_ANALISE", "blocked"), false);
    assert.equal(portfolioDecisionMatchesCreditFilter("EM_ANALISE", "review"), true);
    assert.equal(portfolioDecisionMatchesCreditFilter("LEITURA_INDISPONIVEL", "unread"), true);
    assert.equal(portfolioDecisionMatchesCreditFilter("LEITURA_INDISPONIVEL", "review"), false);
    assert.equal(portfolioDecisionMatchesCreditFilter("LIBERADO", "released"), true);
    assert.equal(portfolioDecisionMatchesCreditFilter("LIBERADO", ""), true);
  });
});
