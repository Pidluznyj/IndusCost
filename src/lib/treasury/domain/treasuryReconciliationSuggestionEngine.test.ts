import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runTreasuryReconciliationSuggestionEngine,
  treasuryNameSimilarity,
  type TreasuryReconciliationMovementSeed,
  type TreasuryReconciliationTitleSeed,
} from "./treasuryReconciliationSuggestionEngine.js";

const MOVEMENT_CREDIT: TreasuryReconciliationMovementSeed = {
  id: "mov-credit-1",
  accountId: "acc-1",
  direction: "CREDIT",
  amount: "1500.00",
  postedCivilDate: "2026-07-15",
  documentNumber: "NF-7788",
  counterpartyName: "Cliente Alpha Industria Ltda",
  description: "PIX RECEBIDO NF-7788 12345678000199",
  reconciliationStatus: "PENDING",
  reconciledAmount: "0.00",
};

const TITLE_AR_MATCH: TreasuryReconciliationTitleSeed = {
  side: "AR",
  officialTitleId: "title-ar-1",
  externalId: 1001,
  counterpartyName: "Cliente Alpha Industria LTDA",
  counterpartyTaxId: "12.345.678/0001-99",
  documentNumber: null,
  description: "NF-7788 parcela 1",
  invoiceNumber: "7788",
  dueDate: "2026-07-16",
  openBalance: "1500.00",
  isCancelled: false,
  isSettled: false,
  priorSuccessfulMatchCount: 2,
};

function run(input: {
  movements?: TreasuryReconciliationMovementSeed[];
  titles?: TreasuryReconciliationTitleSeed[];
}) {
  return runTreasuryReconciliationSuggestionEngine({
    companyCode: "LZ",
    asOfCivilDate: "2026-07-20",
    movements: input.movements ?? [MOVEMENT_CREDIT],
    titles: input.titles ?? [TITLE_AR_MATCH],
  });
}

describe("treasuryReconciliationSuggestionEngine — ranking", () => {
  it("ranqueia o melhor candidato primeiro com score e motivos", () => {
    const weak: TreasuryReconciliationTitleSeed = {
      ...TITLE_AR_MATCH,
      officialTitleId: "title-ar-weak",
      externalId: 1002,
      counterpartyName: "Outro Cliente",
      counterpartyTaxId: "00000000000191",
      documentNumber: null,
      description: "sem documento util",
      invoiceNumber: null,
      dueDate: "2026-08-30",
      priorSuccessfulMatchCount: 0,
    };
    const result = run({ titles: [weak, TITLE_AR_MATCH] });
    assert.equal(result.autoMatched, false);
    assert.equal(result.algorithmVersion, "1.0.0");
    assert.ok(result.suggestions.length >= 1);
    const top = result.suggestions[0]!;
    assert.equal(top.allocations[0].officialTitleId, "title-ar-1");
    assert.equal(top.confidence, "HIGH");
    assert.ok(top.score >= 80);
    assert.ok(top.reasons.includes("AMOUNT_EXACT"));
    assert.ok(top.reasons.includes("DOCUMENT_MATCH"));
    assert.ok(top.reasons.includes("TAX_ID_MATCH"));
    assert.ok(top.reasons.includes("DATE_PROXIMITY"));
    assert.ok(top.reasons.includes("NAME_SIMILAR"));
    assert.ok(top.reasons.includes("HISTORY_MATCH"));
    assert.ok(top.reasons.includes("DIRECTION_COMPATIBLE"));
    assert.equal(top.totalSuggestedAmount, "1500.00");
  });

  it("classifica alta / média / baixa confiança por faixas", () => {
    const high = run({ titles: [TITLE_AR_MATCH] }).suggestions[0]!;
    assert.equal(high.confidence, "HIGH");

    const mediumTitle: TreasuryReconciliationTitleSeed = {
      side: "AR",
      officialTitleId: "title-ar-med",
      externalId: 2001,
      counterpartyName: "Cliente Qualquer",
      counterpartyTaxId: null,
      documentNumber: null,
      description: "NF-7788",
      invoiceNumber: "NF-7788",
      dueDate: "2026-09-01",
      openBalance: "1500.00",
      isCancelled: false,
      isSettled: false,
    };
    const medium = run({ titles: [mediumTitle] }).suggestions[0]!;
    assert.equal(medium.confidence, "MEDIUM");
    assert.ok(medium.score >= 55 && medium.score < 80);

    const lowTitle: TreasuryReconciliationTitleSeed = {
      side: "AR",
      officialTitleId: "title-ar-low",
      externalId: 2002,
      counterpartyName: "Sem Nome Parecido",
      counterpartyTaxId: null,
      documentNumber: null,
      description: "outro doc",
      invoiceNumber: null,
      dueDate: "2026-09-01",
      openBalance: "1500.00",
      isCancelled: false,
      isSettled: false,
    };
    const low = run({ titles: [lowTitle] }).suggestions[0]!;
    assert.equal(low.confidence, "LOW");
    assert.ok(low.reasons.includes("AMOUNT_EXACT"));
    assert.ok(low.score >= 35 && low.score < 55);
  });

  it("ordena determinísticamente por score desc e suggestionKey", () => {
    const a: TreasuryReconciliationTitleSeed = {
      ...TITLE_AR_MATCH,
      officialTitleId: "title-z",
      externalId: 9,
      priorSuccessfulMatchCount: 0,
      dueDate: "2026-09-01",
      counterpartyTaxId: null,
      description: "x",
      invoiceNumber: null,
      counterpartyName: "zzz",
    };
    const b: TreasuryReconciliationTitleSeed = {
      ...a,
      officialTitleId: "title-a",
      externalId: 8,
    };
    const result = run({ titles: [a, b] });
    assert.equal(result.suggestions.length, 2);
    assert.equal(result.suggestions[0]!.score, result.suggestions[1]!.score);
    assert.ok(
      result.suggestions[0]!.suggestionKey <
        result.suggestions[1]!.suggestionKey
    );
  });
});

describe("treasuryReconciliationSuggestionEngine — falsos positivos", () => {
  it("não sugere título com direção incompatível (CREDIT×AP)", () => {
    const ap: TreasuryReconciliationTitleSeed = {
      ...TITLE_AR_MATCH,
      side: "AP",
      officialTitleId: "title-ap-wrong",
      externalId: 3001,
    };
    const result = run({ titles: [ap] });
    assert.deepEqual(result.suggestions, []);
    assert.deepEqual(result.unmatchedMovementIds, ["mov-credit-1"]);
  });

  it("não sugere DEBIT contra AR", () => {
    const debit: TreasuryReconciliationMovementSeed = {
      ...MOVEMENT_CREDIT,
      id: "mov-debit-1",
      direction: "DEBIT",
      description: "PAGAMENTO NF-7788 12345678000199",
    };
    const result = run({
      movements: [debit],
      titles: [TITLE_AR_MATCH],
    });
    assert.deepEqual(result.suggestions, []);
  });

  it("exclui títulos cancelados e integralmente realizados", () => {
    const cancelled: TreasuryReconciliationTitleSeed = {
      ...TITLE_AR_MATCH,
      officialTitleId: "title-cancelled",
      isCancelled: true,
    };
    const settled: TreasuryReconciliationTitleSeed = {
      ...TITLE_AR_MATCH,
      officialTitleId: "title-settled",
      isSettled: true,
      openBalance: "0.00",
    };
    const result = run({ titles: [cancelled, settled, TITLE_AR_MATCH] });
    assert.ok(
      result.excludedTitleIds.includes("title-cancelled") &&
        result.excludedTitleIds.includes("title-settled")
    );
    assert.equal(result.suggestions.length, 1);
    assert.equal(result.suggestions[0]!.allocations[0].officialTitleId, "title-ar-1");
  });

  it("não marca AMOUNT_EXACT em valor próximo (falso positivo de centavos)", () => {
    const near: TreasuryReconciliationTitleSeed = {
      ...TITLE_AR_MATCH,
      officialTitleId: "title-near",
      openBalance: "1500.01",
      documentNumber: null,
      description: "sem doc",
      invoiceNumber: null,
      counterpartyTaxId: null,
      counterpartyName: "Sem Nome",
      dueDate: "2026-09-01",
      priorSuccessfulMatchCount: 0,
    };
    const result = run({ titles: [near] });
    // remaining 1500 < open 1500.01 → elegível, mas só direção → score 0 → filtrado
    assert.deepEqual(result.suggestions, []);
    assert.deepEqual(result.unmatchedMovementIds, ["mov-credit-1"]);
  });

  it("não sugere quando valor do movimento excede saldo aberto", () => {
    const smaller: TreasuryReconciliationTitleSeed = {
      ...TITLE_AR_MATCH,
      officialTitleId: "title-small",
      openBalance: "100.00",
    };
    const result = run({ titles: [smaller] });
    assert.deepEqual(result.suggestions, []);
  });

  it("ignora movimentos já MATCHED / IGNORED", () => {
    const matched: TreasuryReconciliationMovementSeed = {
      ...MOVEMENT_CREDIT,
      id: "mov-matched",
      reconciliationStatus: "MATCHED",
      reconciledAmount: "1500.00",
    };
    const ignored: TreasuryReconciliationMovementSeed = {
      ...MOVEMENT_CREDIT,
      id: "mov-ignored",
      reconciliationStatus: "IGNORED",
    };
    const result = run({
      movements: [matched, ignored],
      titles: [TITLE_AR_MATCH],
    });
    assert.deepEqual(result.suggestions, []);
    assert.deepEqual(result.unmatchedMovementIds, [
      "mov-ignored",
      "mov-matched",
    ]);
  });

  it("nome pouco similar não gera NAME_SIMILAR (falso positivo de nome)", () => {
    assert.ok(
      treasuryNameSimilarity(
        "Cliente Alpha Industria Ltda",
        "Cliente Alpha Industria LTDA"
      ) >= 0.5
    );
    assert.ok(
      treasuryNameSimilarity("Alpha Industria", "Beta Comercio") < 0.5
    );
    const title: TreasuryReconciliationTitleSeed = {
      ...TITLE_AR_MATCH,
      officialTitleId: "title-name-fp",
      counterpartyName: "Beta Comercio XYZ",
      counterpartyTaxId: null,
      documentNumber: null,
      description: "outro",
      invoiceNumber: null,
      dueDate: "2026-09-01",
      priorSuccessfulMatchCount: 0,
    };
    const sug = run({ titles: [title] }).suggestions[0]!;
    assert.equal(sug.confidence, "LOW");
    assert.equal(sug.reasons.includes("NAME_SIMILAR"), false);
  });
});

describe("treasuryReconciliationSuggestionEngine — débito/AP", () => {
  it("sugere AP compatível com DEBIT", () => {
    const debit: TreasuryReconciliationMovementSeed = {
      id: "mov-ap-1",
      accountId: "acc-1",
      direction: "DEBIT",
      amount: "200.00",
      postedCivilDate: "2026-07-10",
      documentNumber: "DUP-55",
      counterpartyName: "Fornecedor Beta SA",
      description: "PAG FORNECEDOR DUP-55",
      reconciliationStatus: "PENDING",
    };
    const ap: TreasuryReconciliationTitleSeed = {
      side: "AP",
      officialTitleId: "title-ap-1",
      externalId: 4001,
      counterpartyName: "Fornecedor Beta S/A",
      counterpartyTaxId: "11222333000181",
      documentNumber: "DUP-55",
      description: "Duplicata 55",
      invoiceNumber: null,
      dueDate: "2026-07-12",
      openBalance: "200.00",
      isCancelled: false,
      isSettled: false,
      priorSuccessfulMatchCount: 1,
    };
    const result = run({ movements: [debit], titles: [ap] });
    assert.equal(result.suggestions.length, 1);
    assert.equal(result.suggestions[0]!.allocations[0].side, "AP");
    assert.ok(result.suggestions[0]!.reasons.includes("DIRECTION_COMPATIBLE"));
    assert.ok(result.suggestions[0]!.reasons.includes("AMOUNT_EXACT"));
    assert.ok(result.suggestions[0]!.reasons.includes("DOCUMENT_MATCH"));
  });
});
