import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryBankMovementDto } from "../contracts/treasuryDto.js";
import {
  adaptTreasuryBankMovementToCashSupportRow,
  adaptTreasuryBankMovementsToCashSupportRows,
  buildCashSupportBankBalanceWarnings,
  summarizeCashSupportBankPosition,
} from "./cashSupportBankAdapter.js";

function movement(overrides: Partial<TreasuryBankMovementDto>): TreasuryBankMovementDto {
  return {
    id: "mov-1",
    batchId: "batch-1",
    companyCode: "EMP1",
    accountId: "acc-1",
    accountCode: "CXA",
    accountName: "Caixa",
    fingerprint: "fp-1",
    fitId: "FIT-1",
    direction: "CREDIT",
    amount: "1000.00",
    currency: "BRL",
    postedCivilDate: "2026-07-20",
    userCivilDate: null,
    description: "Depósito cliente",
    documentNumber: null,
    counterpartyName: null,
    trnType: null,
    reconciliationStatus: "PENDING",
    reconciledAmount: "0.00",
    sortOrder: 0,
    createdAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  } as TreasuryBankMovementDto;
}

describe("cashSupportBankAdapter", () => {
  it("movimento PENDING (sem match) aparece e é elegível estruturalmente", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(movement({}));
    assert.equal(row.resourceType, "BANK_MOVEMENT");
    assert.equal(row.reconcilable, true);
    assert.equal(row.reconciliationState, "PENDING");
    assert.equal(row.bankMovementKey?.bankMovementId, "mov-1");
  });

  it("movimento IGNORED continua aparecendo, mas não é reconcilable", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(
      movement({ reconciliationStatus: "IGNORED" })
    );
    assert.equal(row.reconcilable, false, "IGNORED não é elegível");
    assert.equal(row.resourceType, "BANK_MOVEMENT", "mas continua aparecendo (regra §4.3)");
  });

  it("bankDate é sempre postedCivilDate — nunca dueDate/expectedDate", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(
      movement({ postedCivilDate: "2026-08-01" })
    );
    assert.equal(row.bankDate, "2026-08-01");
    assert.equal(row.dueDate, null);
    assert.equal(row.expectedDate, null);
  });

  it("direção CREDIT vira IN e DEBIT vira OUT", () => {
    assert.equal(
      adaptTreasuryBankMovementToCashSupportRow(movement({ direction: "CREDIT" })).direction,
      "IN"
    );
    assert.equal(
      adaptTreasuryBankMovementToCashSupportRow(movement({ direction: "DEBIT" })).direction,
      "OUT"
    );
  });

  it("conta e empresa vêm sempre preenchidas (o movimento sempre as tem)", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(movement({}));
    assert.deepEqual(row.companyContext, { companyCode: "EMP1" });
    assert.deepEqual(row.accountContext, { accountId: "acc-1", accountName: "Caixa" });
  });

  it("residual = amount - reconciledAmount, em centavos, sem float", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(
      movement({ amount: "1000.00", reconciledAmount: "300.00" })
    );
    assert.equal(row.residualAmount, "700.00");
    assert.equal(typeof row.residualAmount, "string");
  });

  it("PARTIAL conserva o estado oficial sem inventar outro", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(
      movement({ reconciliationStatus: "PARTIAL", amount: "500.00", reconciledAmount: "200.00" })
    );
    assert.equal(row.reconciliationState, "PARTIAL");
    assert.equal(row.residualAmount, "300.00");
  });

  it("adjustmentAmount não confunde ajuste com allocation neste adaptador", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(movement({}));
    assert.equal(row.adjustmentAmount, "0.00");
  });

  it("aviso de correção OFX indisponível está sempre presente", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(movement({}));
    assert.ok(row.warnings.some((w) => w.code === "SOURCE_CORRECTION_UNSUPPORTED"));
  });

  it("posição bancária soma direto dos movimentos, sem consulta paralela", () => {
    const rows = [
      movement({ id: "a", direction: "CREDIT", amount: "1000.00", reconciliationStatus: "MATCHED", reconciledAmount: "1000.00" }),
      movement({ id: "b", direction: "DEBIT", amount: "400.00", reconciliationStatus: "PARTIAL", reconciledAmount: "100.00" }),
      movement({ id: "c", direction: "CREDIT", amount: "250.00", reconciliationStatus: "PENDING", reconciledAmount: "0.00" }),
    ];
    const summary = summarizeCashSupportBankPosition(rows);
    assert.equal(summary.inflows, "1250.00");
    assert.equal(summary.outflows, "400.00");
    assert.equal(summary.reconciled, "1000.00");
    assert.equal(summary.partiallyReconciled, "400.00");
    assert.equal(summary.unreconciled, "250.00");
  });

  it("lista de movimentos vazia produz posição zerada, não erro", () => {
    const summary = summarizeCashSupportBankPosition([]);
    assert.equal(summary.inflows, "0.00");
    assert.equal(summary.outflows, "0.00");
  });

  it("warnings estruturais de saldo não inventam available/cobertura", () => {
    const warnings = buildCashSupportBankBalanceWarnings();
    const codes = warnings.map((w) => w.code);
    assert.ok(codes.includes("AVAILABLE_BALANCE_UNSUPPORTED"));
    assert.ok(codes.includes("STATEMENT_COVERAGE_UNKNOWN"));
    assert.ok(codes.includes("BALANCE_NOT_COMPARABLE"));
  });

  it("adapta lista preservando ordem e cardinalidade 1:1", () => {
    const input = [movement({ id: "x" }), movement({ id: "y" })];
    const rows = adaptTreasuryBankMovementsToCashSupportRows(input);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.bankMovementKey?.bankMovementId, "x");
    assert.equal(rows[1]!.bankMovementKey?.bankMovementId, "y");
  });

  it("nenhum valor monetário é number", () => {
    const row = adaptTreasuryBankMovementToCashSupportRow(movement({}));
    assert.equal(typeof row.bankAmount, "string");
    assert.equal(typeof row.allocatedAmount, "string");
    assert.equal(typeof row.residualAmount, "string");
  });
});
