import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type {
  TreasuryBankImportBatchDto,
  TreasuryBankMovementDto,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";
import { TreasuryBankMovementsPanel } from "./TreasuryBankMovementsPanel.js";
import { createEmptyTreasuryBankMovementsFilters } from "@/src/lib/treasury/treasuryBankMovementsUi.js";

const here = dirname(fileURLToPath(import.meta.url));

const account: TreasuryFinancialAccountDto = {
  id: "acc-1",
  companyCode: "EMP1",
  companyName: "Emp",
  code: "CX1",
  name: "Caixa",
  institutionName: "Banco",
  institutionCode: "341",
  accountType: "CHECKING",
  currency: "BRL",
  agencyMasked: "***",
  accountNumberMasked: "****",
  includeInConsolidated: true,
  minimumBalance: "0.00",
  allowNegativeBalance: false,
  liquidity: "IMMEDIATE",
  defaultBalanceOrigin: "MANUAL",
  sortOrder: 1,
  nomusBankAccountId: null,
  isActive: true,
  createdByUserId: "u1",
  createdAt: "2026-07-01T00:00:00.000+00:00",
  updatedAt: "2026-07-01T00:00:00.000+00:00",
  deactivatedAt: null,
  deactivatedByUserId: null,
  deactivationReason: null,
};

const batch: TreasuryBankImportBatchDto = {
  id: "batch-1",
  companyCode: "EMP1",
  accountId: "acc-1",
  accountCode: "CX1",
  accountName: "Caixa",
  fileSha256: "abc",
  originalFileName: "extrato.ofx",
  byteLength: 100,
  format: "OFX1",
  status: "PROCESSED",
  transactionCount: 1,
  summaryJson: { createdCount: 1 },
  requestId: null,
  notes: null,
  createdByUserId: "u1",
  createdAt: "2026-07-20T12:00:00.000+00:00",
  processedAt: "2026-07-20T12:01:00.000+00:00",
};

const movement: TreasuryBankMovementDto = {
  id: "mov-1",
  batchId: "batch-1",
  companyCode: "EMP1",
  accountId: "acc-1",
  accountCode: "CX1",
  accountName: "Caixa",
  fingerprint: "fp1",
  fitId: "FIT-1",
  direction: "CREDIT",
  amount: "150.00",
  currency: "BRL",
  postedCivilDate: "2026-07-15",
  userCivilDate: null,
  description: "Recebimento",
  documentNumber: null,
  counterpartyName: "Cliente X",
  trnType: "CREDIT",
  reconciliationStatus: "PENDING",
  reconciledAmount: "0.00",
  sortOrder: 0,
  createdAt: "2026-07-20T12:01:00.000+00:00",
};

describe("TreasuryBankMovementsPage — fluxo UI", () => {
  it("registra rota e aba no módulo", () => {
    const mod = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    const ui = readFileSync(join(here, "treasuryFeatureUi.ts"), "utf8");
    assert.match(mod, /TreasuryBankMovementsPage/);
    assert.match(mod, /bank-movements/);
    assert.match(ui, /bank-movements/);
    assert.match(ui, /Movimentos bancários/);
  });

  it("renderiza lotes, movimentos, filtros e detalhe", () => {
    const html = renderToStaticMarkup(
      <TreasuryBankMovementsPanel
        filters={createEmptyTreasuryBankMovementsFilters()}
        accounts={[account]}
        batches={[batch]}
        movements={[movement]}
        selected={movement}
        canManage
        duplicatesMessage={null}
        onFiltersChange={() => undefined}
        onImport={() => undefined}
        onSelectMovement={() => undefined}
        onClearSelection={() => undefined}
        onSelectBatch={() => undefined}
      />
    );
    assert.match(html, /treasury-bank-movements-panel/);
    assert.match(html, /Importar OFX/);
    assert.match(html, /extrato\.ofx/);
    assert.match(html, /Recebimento/);
    assert.match(html, /Cliente X/);
    assert.match(html, /Detalhes do movimento/);
    assert.match(html, /Não conciliados/);
  });

  it("mostra mensagem clara para filtro de duplicados", () => {
    const html = renderToStaticMarkup(
      <TreasuryBankMovementsPanel
        filters={{
          ...createEmptyTreasuryBankMovementsFilters(),
          bucket: "DUPLICATES",
        }}
        accounts={[account]}
        batches={[]}
        movements={[]}
        selected={null}
        canManage={false}
        duplicatesMessage="Duplicados não são gravados."
        onFiltersChange={() => undefined}
        onImport={() => undefined}
        onSelectMovement={() => undefined}
        onClearSelection={() => undefined}
        onSelectBatch={() => undefined}
      />
    );
    assert.match(html, /treasury-bank-duplicates-info/);
    assert.match(html, /Duplicados não são gravados/);
  });
});
