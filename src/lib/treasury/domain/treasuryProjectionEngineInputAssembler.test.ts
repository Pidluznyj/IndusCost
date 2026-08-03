import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleTreasuryProjectionEngineInput,
  type AssembleTreasuryProjectionEngineInput,
} from "./treasuryProjectionEngineInputAssembler.js";

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUTSIDE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function baseInput(
  overrides: Partial<AssembleTreasuryProjectionEngineInput> = {}
): AssembleTreasuryProjectionEngineInput {
  return {
    accounts: [],
    receivables: [],
    payables: [],
    ledgerEntries: [],
    transfers: [],
    ...overrides,
  };
}

describe("assembleTreasuryProjectionEngineInput — contas", () => {
  it("mapeia conta real com saldo de abertura do snapshot", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts: [
          {
            account: {
              id: ACCOUNT_A,
              code: "CX01",
              name: "Caixa Principal",
              includeInConsolidated: true,
              allowNegativeBalance: false,
              minimumBalance: "500.00",
            },
            balance: {
              availableBalance: "1234.50",
              blockedBalance: "0.00",
              investmentsBalance: "0.00",
              usedLimit: "0.00",
            },
          },
        ],
      })
    );
    assert.equal(out.accounts.length, 1);
    assert.equal(out.accounts[0]!.accountId, ACCOUNT_A);
    assert.equal(out.accounts[0]!.openingBalance, "1234.50");
    assert.equal(out.accounts[0]!.minimumBalance, "500.00");
    assert.equal(out.fallbackAccountId, ACCOUNT_A);
  });

  it("conta sem snapshot de saldo → abertura 0,00 (não null, não NaN)", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts: [
          {
            account: {
              id: ACCOUNT_A,
              code: "CX01",
              name: null,
              includeInConsolidated: true,
              allowNegativeBalance: false,
              minimumBalance: "0",
            },
            balance: null,
          },
        ],
      })
    );
    assert.equal(out.accounts[0]!.openingBalance, "0.00");
    assert.equal(out.accounts[0]!.name, undefined);
  });

  it("SEM conta real → tudo vazio e fallback null (guarda do bug de FK)", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        // Mesmo com títulos/ledger presentes, sem conta não monta nada.
        receivables: [
          {
            view: {
              id: "r1",
              externalId: 1,
              installmentNumber: null,
              dueDate: "2026-08-10",
              originalAmount: "100.00",
              openBalance: "100.00",
              isCancelledOrRemovedFromSource: false,
            },
            complement: null,
            activePromise: null,
          },
        ],
        ledgerEntries: [
          {
            id: "l1",
            accountId: ACCOUNT_A,
            civilDate: "2026-08-10",
            amount: "50.00",
            direction: "CREDIT",
            status: "ACTIVE",
            transferGroupId: null,
          },
        ],
      })
    );
    assert.equal(out.accounts.length, 0);
    assert.equal(out.fallbackAccountId, null);
    // Recebíveis ainda são mapeados (o serviço filtra por conta depois), mas
    // ledger sem conta conhecida é descartado.
    assert.equal(out.ledgerEntries.length, 0);
  });
});

describe("assembleTreasuryProjectionEngineInput — títulos", () => {
  const accounts: AssembleTreasuryProjectionEngineInput["accounts"] = [
    {
      account: {
        id: ACCOUNT_A,
        code: "CX01",
        name: "Caixa",
        includeInConsolidated: true,
        allowNegativeBalance: false,
        minimumBalance: "0.00",
      },
      balance: null,
    },
  ];

  it("recebível: conta planejada, datas do complemento e promessa ativa", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts,
        receivables: [
          {
            view: {
              id: "r1",
              externalId: 42,
              installmentNumber: 2,
              dueDate: "2026-08-20",
              originalAmount: "300.00",
              openBalance: "300.00",
              isCancelledOrRemovedFromSource: false,
            },
            complement: {
              plannedAccountId: ACCOUNT_A,
              expectedDate: new Date(Date.UTC(2026, 7, 18)),
              confirmedDate: null,
              scheduledDate: null,
              status: "ACTIVE",
            },
            activePromise: {
              promisedDate: new Date(Date.UTC(2026, 7, 25)),
              status: "ACTIVE",
            },
          },
        ],
      })
    );
    assert.equal(out.receivables.length, 1);
    const r = out.receivables[0]!;
    assert.equal(r.accountId, ACCOUNT_A);
    assert.equal(r.dueDate, "2026-08-20");
    assert.equal(r.expectedDate, "2026-08-18");
    assert.equal(r.activePromiseDate, "2026-08-25");
    assert.equal(r.activePromiseStatus, "ACTIVE");
    assert.equal(r.openBalance, "300.00");
    assert.equal(r.installmentNumber, 2);
  });

  it("saldo em aberto zerado é descartado (não gera movimento futuro)", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts,
        receivables: [
          {
            view: {
              id: "r-quitado",
              externalId: 7,
              installmentNumber: null,
              dueDate: "2026-08-10",
              originalAmount: "100.00",
              openBalance: "0.00",
              isCancelledOrRemovedFromSource: false,
            },
            complement: null,
            activePromise: null,
          },
        ],
      })
    );
    assert.equal(out.receivables.length, 0);
  });

  it("pagável: programação local tem prioridade sobre agenda Nomus", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts,
        payables: [
          {
            view: {
              id: "p1",
              externalId: 99,
              installmentNumber: null,
              dueDate: "2026-08-30",
              nomusScheduleDate: "2026-08-28",
              originalAmount: "200.00",
              openBalance: "200.00",
              isCancelledOrRemovedFromSource: false,
            },
            complement: {
              plannedAccountId: ACCOUNT_A,
              expectedDate: null,
              confirmedDate: null,
              scheduledDate: new Date(Date.UTC(2026, 7, 26)),
              status: "ACTIVE",
            },
          },
        ],
      })
    );
    assert.equal(out.payables[0]!.scheduledDate, "2026-08-26");
    assert.equal(out.payables[0]!.programmingStatus, "ACTIVE");
  });

  it("pagável sem complemento cai na agenda Nomus do próprio título", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts,
        payables: [
          {
            view: {
              id: "p2",
              externalId: 100,
              installmentNumber: null,
              dueDate: "2026-08-30",
              nomusScheduleDate: "2026-08-28",
              originalAmount: "200.00",
              openBalance: "200.00",
              isCancelledOrRemovedFromSource: false,
            },
            complement: null,
          },
        ],
      })
    );
    assert.equal(out.payables[0]!.scheduledDate, "2026-08-28");
    assert.equal(out.payables[0]!.accountId, null);
  });
});

describe("assembleTreasuryProjectionEngineInput — camada manual", () => {
  const accounts: AssembleTreasuryProjectionEngineInput["accounts"] = [
    {
      account: {
        id: ACCOUNT_A,
        code: "CX01",
        name: "A",
        includeInConsolidated: true,
        allowNegativeBalance: false,
        minimumBalance: "0.00",
      },
      balance: null,
    },
    {
      account: {
        id: ACCOUNT_B,
        code: "CX02",
        name: "B",
        includeInConsolidated: true,
        allowNegativeBalance: false,
        minimumBalance: "0.00",
      },
      balance: null,
    },
  ];

  it("ledger fora das contas conhecidas é descartado; dentro é mantido", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts,
        ledgerEntries: [
          {
            id: "l-in",
            accountId: ACCOUNT_A,
            civilDate: "2026-08-12",
            amount: "80.00",
            direction: "DEBIT",
            status: "ACTIVE",
            transferGroupId: null,
          },
          {
            id: "l-out",
            accountId: OUTSIDE,
            civilDate: "2026-08-12",
            amount: "80.00",
            direction: "DEBIT",
            status: "ACTIVE",
            transferGroupId: null,
          },
        ],
      })
    );
    assert.equal(out.ledgerEntries.length, 1);
    assert.equal(out.ledgerEntries[0]!.id, "l-in");
  });

  it("transferência entre duas contas conhecidas mapeia as pernas", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts,
        transfers: [
          {
            id: "t1",
            transferGroupId: "grp-1",
            fromAccountId: ACCOUNT_A,
            toAccountId: ACCOUNT_B,
            civilDate: "2026-08-15",
            sentCivilDate: new Date(Date.UTC(2026, 7, 15)),
            receivedCivilDate: new Date(Date.UTC(2026, 7, 16)),
            amount: "500.00",
            status: "SENT",
            cancelledAt: null,
          },
        ],
      })
    );
    assert.equal(out.transfers.length, 1);
    const t = out.transfers[0]!;
    assert.equal(t.fromAccountId, ACCOUNT_A);
    assert.equal(t.toAccountId, ACCOUNT_B);
    assert.equal(t.outCivilDate, "2026-08-15");
    assert.equal(t.inCivilDate, "2026-08-16");
    assert.equal(t.status, "SENT");
    assert.equal(t.isCancelled, false);
  });

  it("transferência que não toca nenhuma conta conhecida é descartada", () => {
    const out = assembleTreasuryProjectionEngineInput(
      baseInput({
        accounts,
        transfers: [
          {
            id: "t2",
            transferGroupId: "grp-2",
            fromAccountId: OUTSIDE,
            toAccountId: OUTSIDE,
            civilDate: "2026-08-15",
            sentCivilDate: null,
            receivedCivilDate: null,
            amount: "500.00",
            status: "FORECAST",
            cancelledAt: null,
          },
        ],
      })
    );
    assert.equal(out.transfers.length, 0);
  });
});
