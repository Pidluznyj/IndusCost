import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryDailyClosingPreviewDto } from "./contracts/treasuryDto.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import {
  createEmptyTreasuryDailyClosingMemoryStore,
  createMemoryTreasuryDailyClosingRepository,
} from "./repositories/treasuryDailyClosingRepository.memory.js";
import {
  createTreasuryDailyClosingService,
  type TreasuryDailyClosingActor,
} from "./services/treasuryDailyClosingService.server.js";
import { clearTreasuryProjectionRecalcRequests } from "./services/treasuryProjectionRecalc.server.js";

const actorClose: TreasuryDailyClosingActor = {
  userId: "user-1",
  userName: "Tesoureiro",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewClosing: true,
  canCloseDay: true,
  canReopenDay: true,
  sessionId: "s1",
  requestId: "req-1",
};

function cleanPreview(
  overrides: Partial<TreasuryDailyClosingPreviewDto> = {}
): TreasuryDailyClosingPreviewDto {
  return {
    ok: true,
    civilDate: "2026-08-17",
    companyCode: "EMP1",
    sourceHash: "a".repeat(64),
    generatedAt: "2026-08-17T18:00:00.000-03:00",
    summary: {
      openingBalance: "100.00",
      realizedInflows: "0.00",
      realizedOutflows: "0.00",
      pendenciesAmount: "0.00",
      closingBalance: "100.00",
      observedBalance: "100.00",
      reconciledBalance: "100.00",
      differenceAmount: "0.00",
      accountCount: 1,
      pendingReceivablesCount: 0,
      pendingPayablesCount: 0,
      absoluteBlockCount: 0,
      warningCount: 0,
      caveatRequiredCount: 0,
    },
    accounts: [
      {
        accountId: "acc-1",
        code: "CX",
        name: "Caixa",
        openingBalance: "100.00",
        realizedInflows: "0.00",
        realizedOutflows: "0.00",
        pendenciesAmount: "0.00",
        closingBalance: "100.00",
        observedBalance: "100.00",
        reconciledBalance: "100.00",
        differenceAmount: "0.00",
        minimumBalance: "0.00",
        allowNegativeBalance: true,
        balanceStale: false,
        lastBalanceAt: "2026-08-17T12:00:00.000-03:00",
      },
    ],
    absoluteBlocks: [],
    warnings: [],
    pendingReceivables: [],
    pendingPayables: [],
    unreconciledMovements: [],
    staleBalances: [],
    expiredPromises: [],
    transfersInTransit: [],
    canCloseWithoutCaveats: true,
    canCloseWithCaveats: true,
    requiredCaveatCodes: [],
    ...overrides,
  };
}

function createHarness(preview: TreasuryDailyClosingPreviewDto) {
  const store = createEmptyTreasuryDailyClosingMemoryStore();
  const repository = createMemoryTreasuryDailyClosingRepository(store);
  const audits: Array<Record<string, unknown>> = [];
  const service = createTreasuryDailyClosingService({
    repository,
    recalcJobRepository: null,
    loadPreview: async () => preview,
    runTransaction: async (fn) =>
      fn({
        treasuryAuditLog: {
          async create(args: { data: Record<string, unknown> }) {
            const row = { id: `audit-${audits.length + 1}`, ...args.data };
            audits.push(row);
            return row;
          },
        },
      } as never),
  });
  return { service, store, audits, repository };
}

describe("treasuryDailyClosing — integração close/reopen", () => {
  it("fecha com lock, congela posição, audita e dispara recálculo", async () => {
    clearTreasuryProjectionRecalcRequests();
    const preview = cleanPreview();
    const { service, store, audits } = createHarness(preview);
    const result = await service.close(actorClose, {
      companyCode: "EMP1",
      date: "2026-08-17",
      sourceHash: preview.sourceHash,
      accountIds: null,
      notes: null,
      caveats: [],
    });
    assert.equal(result.closing.status, "CLOSED");
    assert.equal(result.closing.version, 1);
    assert.equal(result.closing.sourceHash, preview.sourceHash);
    assert.equal(store.positions.length, 1);
    assert.equal(audits.some((a) => a.action === "CLOSE"), true);
    assert.equal(result.projectionRecalc.accepted, true);
  });

  it("409 CONFLICT quando hash do preview mudou", async () => {
    const { service } = createHarness(cleanPreview());
    await assert.rejects(
      () =>
        service.close(actorClose, {
          companyCode: "EMP1",
          date: "2026-08-17",
          sourceHash: "b".repeat(64),
          accountIds: null,
          notes: null,
          caveats: [],
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        err.code === "CONFLICT" &&
        err.field === "sourceHash"
    );
  });

  it("exige ressalva quando há pendências; permissão close/reopen", async () => {
    const preview = cleanPreview({
      canCloseWithoutCaveats: false,
      canCloseWithCaveats: true,
      requiredCaveatCodes: ["EXPIRED_PROMISE"],
      caveatRequiredCount: 1,
    });
    const { service } = createHarness(preview);
    await assert.rejects(
      () =>
        service.close(actorClose, {
          companyCode: "EMP1",
          date: "2026-08-17",
          sourceHash: preview.sourceHash,
          accountIds: null,
          notes: null,
          caveats: [],
        }),
      /EXPIRED_PROMISE/
    );

    const closed = await service.close(actorClose, {
      companyCode: "EMP1",
      date: "2026-08-17",
      sourceHash: preview.sourceHash,
      accountIds: null,
      notes: "ok",
      caveats: [
        {
          code: "EXPIRED_PROMISE",
          message: "Promessa acompanhada",
          severity: "WARNING",
        },
      ],
    });
    assert.equal(closed.closing.caveatsCount, 1);

    await assert.rejects(
      () =>
        service.close(
          { ...actorClose, canCloseDay: false },
          {
            companyCode: "EMP1",
            date: "2026-08-18",
            sourceHash: preview.sourceHash,
            accountIds: null,
            notes: null,
            caveats: [
              {
                code: "EXPIRED_PROMISE",
                message: "x",
                severity: "WARNING",
              },
            ],
          }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );

    await assert.rejects(
      () =>
        service.reopen(
          { ...actorClose, canReopenDay: false },
          closed.closing.id,
          { reason: "ajuste" }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });

  it("reabertura preserva versão anterior e cria nova OPEN", async () => {
    const preview = cleanPreview();
    const { service, store, audits } = createHarness(preview);
    const closed = await service.close(actorClose, {
      companyCode: "EMP1",
      date: "2026-08-17",
      sourceHash: preview.sourceHash,
      accountIds: null,
      notes: null,
      caveats: [],
    });
    const reopened = await service.reopen(actorClose, closed.closing.id, {
      reason: "Baixa Nomus atrasada",
    });
    assert.equal(reopened.previous.status, "REOPENED");
    assert.equal(reopened.previous.version, 1);
    assert.equal(reopened.next.status, "OPEN");
    assert.equal(reopened.next.version, 2);
    assert.equal(reopened.next.previousClosingId, reopened.previous.id);
    assert.equal(
      reopened.previous.supersededByClosingId,
      reopened.next.id
    );
    assert.equal(store.reopenings.length, 1);
    assert.ok(audits.some((a) => a.action === "REOPEN"));
    assert.equal(store.closings.filter((c) => c.version === 1).length, 1);
  });

  it("concorrência: segundo close falha enquanto lock está ativo", async () => {
    const preview = cleanPreview();
    const store = createEmptyTreasuryDailyClosingMemoryStore();
    const repository = createMemoryTreasuryDailyClosingRepository(store);
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let entered = 0;

    const slowLoadPreview = async () => {
      entered += 1;
      if (entered === 1) await gate;
      return preview;
    };

    const service = createTreasuryDailyClosingService({
      repository,
      recalcJobRepository: null,
      loadPreview: slowLoadPreview,
      runTransaction: async (fn) =>
        fn({
          treasuryAuditLog: {
            async create(args: { data: Record<string, unknown> }) {
              return { id: "a", ...args.data };
            },
          },
        } as never),
    });

    const first = service.close(actorClose, {
      companyCode: "EMP1",
      date: "2026-08-17",
      sourceHash: preview.sourceHash,
      accountIds: null,
      notes: null,
      caveats: [],
    });

    // Aguarda o primeiro adquirir o lock.
    for (let i = 0; i < 100 && store.locks.size === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(store.locks.size > 0, "lock deveria estar ativo");

    await assert.rejects(
      () =>
        service.close(actorClose, {
          companyCode: "EMP1",
          date: "2026-08-17",
          sourceHash: preview.sourceHash,
          accountIds: null,
          notes: null,
          caveats: [],
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        err.code === "CONFLICT" &&
        err.field === "lock"
    );

    releaseGate();
    const done = await first;
    assert.equal(done.closing.status, "CLOSED");
  });

  it("segundo close após fechamento retorna DAY_CLOSED", async () => {
    const preview = cleanPreview();
    const { service } = createHarness(preview);
    await service.close(actorClose, {
      companyCode: "EMP1",
      date: "2026-08-17",
      sourceHash: preview.sourceHash,
      accountIds: null,
      notes: null,
      caveats: [],
    });
    await assert.rejects(
      () =>
        service.close(actorClose, {
          companyCode: "EMP1",
          date: "2026-08-17",
          sourceHash: preview.sourceHash,
          accountIds: null,
          notes: null,
          caveats: [],
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "DAY_CLOSED"
    );
  });
});
