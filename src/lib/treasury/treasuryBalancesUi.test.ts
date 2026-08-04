import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "@/src/lib/http.js";
import type { TreasuryBalanceSnapshotDto } from "./contracts/index.js";
import {
  createEmptyTreasuryBalanceForm,
  formatTreasuryApiMoneyToPtBr,
  maskTreasuryMoneyInputPtBr,
  parseTreasuryPtBrMoneyToApi,
  resolveTreasuryBalanceSaveError,
  resolveTreasuryBalanceStaleState,
  toTreasuryBalanceSnapshotApiBody,
  validateTreasuryBalanceForm,
} from "./treasuryBalancesUi.js";

function sampleLatest(
  overrides: Partial<TreasuryBalanceSnapshotDto> = {}
): TreasuryBalanceSnapshotDto {
  return {
    id: "snap-1",
    accountId: "acc-1",
    referenceAt: "2026-07-20T12:00:00.000Z",
    civilDate: "2026-07-20",
    availableBalance: "1000.50",
    blockedBalance: "10.00",
    investmentsBalance: "5.00",
    usedLimit: "1.00",
    observedBalance: "1015.50",
    operationalAvailableBalance: "1000.50",
    origin: "MANUAL",
    idempotencyKey: "k1",
    notes: null,
    attachmentUrl: null,
    createdByUserId: "u1",
    previousSnapshotId: null,
    createdAt: "2026-07-20T12:01:00.000Z",
    cancelledAt: null,
    cancelledByUserId: null,
    cancelReason: null,
    ...overrides,
  };
}

describe("treasuryBalancesUi — máscara monetária pt-BR", () => {
  it("mascara digitação em centavos e formata API→pt-BR", () => {
    assert.equal(maskTreasuryMoneyInputPtBr("123456"), "1.234,56");
    assert.equal(maskTreasuryMoneyInputPtBr("1"), "0,01");
    assert.equal(formatTreasuryApiMoneyToPtBr("1000.50"), "1.000,50");
    assert.equal(formatTreasuryApiMoneyToPtBr("-20.5"), "-20,50");
  });

  it("converte pt-BR para string decimal da API sem símbolo monetário", () => {
    assert.equal(parseTreasuryPtBrMoneyToApi("1.234,56"), "1234.56");
    assert.equal(parseTreasuryPtBrMoneyToApi("10,5"), "10.50");
    assert.equal(parseTreasuryPtBrMoneyToApi("10.50"), "10.50");
    assert.equal(parseTreasuryPtBrMoneyToApi(""), null);
    assert.equal(parseTreasuryPtBrMoneyToApi("abc"), null);
    const api = parseTreasuryPtBrMoneyToApi("1.234,56");
    assert.ok(api);
    assert.doesNotMatch(api, /R\$/);
    assert.doesNotMatch(api, /,/);
  });
});

describe("treasuryBalancesUi — formulário", () => {
  it("valida campos e monta payload decimal para API", () => {
    const empty = createEmptyTreasuryBalanceForm();
    assert.match(validateTreasuryBalanceForm(empty) ?? "", /disponível/i);

    const form = createEmptyTreasuryBalanceForm(sampleLatest());
    form.availableBalance = maskTreasuryMoneyInputPtBr("250075");
    form.blockedBalance = maskTreasuryMoneyInputPtBr("1000");
    form.investmentsBalance = maskTreasuryMoneyInputPtBr("500");
    form.usedLimit = maskTreasuryMoneyInputPtBr("0");
    form.notes = "conferência";
    assert.equal(validateTreasuryBalanceForm(form), null);

    const body = toTreasuryBalanceSnapshotApiBody(form);
    assert.ok(body);
    assert.equal(body.availableBalance, "2500.75");
    assert.equal(body.blockedBalance, "10.00");
    assert.equal(body.investmentsBalance, "5.00");
    assert.equal(body.usedLimit, "0.00");
    assert.equal(body.origin, "MANUAL");
    assert.equal(body.notes, "conferência");
    assert.doesNotMatch(body.availableBalance, /,/);
    assert.ok(body.referenceAt.includes("+") || body.referenceAt.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(body.referenceAt));
  });
});

describe("treasuryBalancesUi — estados stale/erro", () => {
  it("alerta saldo ausente ou desatualizado", () => {
    assert.equal(resolveTreasuryBalanceStaleState(null).kind, "missing");
    const stale = resolveTreasuryBalanceStaleState(
      sampleLatest({ referenceAt: "2026-01-01T00:00:00.000Z" }),
      new Date("2026-07-27T00:00:00.000Z"),
      24
    );
    assert.equal(stale.kind, "stale");
    const fresh = resolveTreasuryBalanceStaleState(
      sampleLatest({ referenceAt: "2026-07-26T20:00:00.000Z" }),
      new Date("2026-07-27T00:00:00.000Z"),
      24
    );
    assert.equal(fresh.kind, "none");
  });

  it("mapeia conflito HTTP 409", () => {
    const conflict = resolveTreasuryBalanceSaveError(
      new HttpError(409, "conta inativa", "CONFLICT")
    );
    assert.equal(conflict.isConflict, true);
    assert.match(conflict.message, /Conflito/i);
    const other = resolveTreasuryBalanceSaveError(
      new HttpError(400, "valor inválido", "INVALID_MONEY")
    );
    assert.equal(other.isConflict, false);
    assert.match(other.message, /inválido/i);
  });
});
