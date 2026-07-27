import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyTreasuryExceptionMemoryStore,
  createMemoryTreasuryExceptionRepository,
} from "./repositories/treasuryExceptionRepository.memory.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  createTreasuryExceptionService,
  type TreasuryExceptionActor,
} from "./services/treasuryExceptionService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import { parseTreasuryExceptionUpsertInput } from "./contracts/treasurySchemas.js";

const actor: TreasuryExceptionActor = {
  userId: "user-exc-1",
  userName: "Tesoureiro",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewExceptions: true,
  canManageExceptions: true,
  sessionId: "sess-e",
  requestId: "req-e-1",
};

function createHarness() {
  const store = createEmptyTreasuryExceptionMemoryStore();
  const audits: Array<Record<string, unknown>> = [];
  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        const row = { id: `audit-${audits.length + 1}`, ...args.data };
        audits.push(row);
        return row;
      },
    },
  } as unknown as TreasuryAuditDb;

  const service = createTreasuryExceptionService({
    prisma: {} as PrismaClient,
    repository: createMemoryTreasuryExceptionRepository(store),
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { service, store, audits };
}

const baseBody = {
  companyCode: "EMP1",
  uniqueKey: "BALANCE_DIVERGENCE|acc-1|2026-08-13",
  type: "BALANCE_DIVERGENCE",
  severity: "CRITICAL",
  entityKind: "ACCOUNT",
  entityId: "acc-1",
  accountId: "acc-1",
  nomusExternalId: null,
  title: "Divergência de saldo",
  description: "Observado ≠ APURADO",
  amount: "150.00",
  dueAt: "2026-08-14",
  responsibleUserId: "user-r",
  metadata: { source: "position-engine" },
};

describe("treasuryException — integração", () => {
  it("cria exceção na primeira detecção", async () => {
    const { service, audits } = createHarness();
    const input = parseTreasuryExceptionUpsertInput(baseBody);
    const result = await service.upsertByUniqueKey(actor, input);
    assert.equal(result.created, true);
    assert.equal(result.exception.recurrenceCount, 1);
    assert.equal(result.exception.status, "OPEN");
    assert.equal(result.exception.amount, "150.00");
    assert.equal(result.exception.uniqueKey, baseBody.uniqueKey);
    assert.equal(audits[0]?.entityType, "EXCEPTION");
    assert.equal(audits[0]?.action, "CREATE");
  });

  it("mesma causa aberta não duplica — atualiza valor e incrementa recorrência", async () => {
    const { service, store } = createHarness();
    const input = parseTreasuryExceptionUpsertInput(baseBody);
    const first = await service.upsertByUniqueKey(actor, input);
    const second = await service.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput({
        ...baseBody,
        amount: "175.50",
        title: "Divergência de saldo (atualizada)",
        severity: "CRITICAL",
        metadata: { source: "position-engine", wave: 2 },
      })
    );

    assert.equal(second.created, false);
    assert.equal(second.recurrenceIncremented, true);
    assert.equal(second.exception.id, first.exception.id);
    assert.equal(second.exception.amount, "175.50");
    assert.equal(second.exception.title, "Divergência de saldo (atualizada)");
    assert.equal(second.exception.recurrenceCount, 2);
    assert.equal(store.rows.length, 1);
    assert.equal(second.exception.metadata?.wave, 2);
  });

  it("preserva status IN_ANALYSIS ao re-detectar e incrementa recorrência", async () => {
    const { service } = createHarness();
    const created = await service.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput(baseBody)
    );
    const ack = await service.acknowledge(actor, created.exception.id, {
      expectedVersion: created.exception.version,
      justification: "Em análise",
    });
    assert.equal(ack.status, "IN_ANALYSIS");

    const again = await service.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput({
        ...baseBody,
        amount: "200.00",
      })
    );
    assert.equal(again.exception.status, "IN_ANALYSIS");
    assert.equal(again.exception.recurrenceCount, 2);
    assert.equal(again.exception.amount, "200.00");
  });

  it("reabre causa resolvida sem criar duplicata e preserva recorrência", async () => {
    const { service, store } = createHarness();
    const created = await service.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput(baseBody)
    );
    await service.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput({ ...baseBody, amount: "160.00" })
    );
    const resolved = await service.resolve(actor, created.exception.id, {
      expectedVersion: 2,
      resolution: "Ajuste de snapshot aplicado.",
    });
    assert.equal(resolved.status, "RESOLVED");
    assert.equal(resolved.recurrenceCount, 2);

    const reopened = await service.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput({
        ...baseBody,
        amount: "10.00",
      })
    );
    assert.equal(store.rows.length, 1);
    assert.equal(reopened.exception.status, "OPEN");
    assert.equal(reopened.exception.recurrenceCount, 3);
    assert.equal(reopened.exception.resolution, null);
    assert.equal(reopened.exception.amount, "10.00");
  });

  it("ignorar exige justificativa e marca IGNORED", async () => {
    const { service, audits } = createHarness();
    const created = await service.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput(baseBody)
    );
    await assert.rejects(
      () =>
        service.ignore(actor, created.exception.id, {
          expectedVersion: created.exception.version,
          ignoreJustification: "   ",
        }),
      TreasuryDomainError
    );
    const ignored = await service.ignore(actor, created.exception.id, {
      expectedVersion: created.exception.version,
      ignoreJustification: "Ruído conhecido da conta investimento.",
    });
    assert.equal(ignored.status, "IGNORED");
    assert.equal(
      ignored.ignoreJustification,
      "Ruído conhecido da conta investimento."
    );
    assert.ok(
      audits.some(
        (a) =>
          a.action === "UPDATE" &&
          (a.metadataJson as { ignored?: boolean })?.ignored === true
      )
    );
  });

  it("atribui, registra prazo e altera status operacional", async () => {
    const { service } = createHarness();
    const created = await service.upsertByUniqueKey(
      actor,
      parseTreasuryExceptionUpsertInput(baseBody)
    );
    const assigned = await service.assign(actor, created.exception.id, {
      expectedVersion: created.exception.version,
      responsibleUserId: "user-resp-9",
    });
    assert.equal(assigned.responsibleUserId, "user-resp-9");
    const withDue = await service.setDueAt(actor, assigned.id, {
      expectedVersion: assigned.version,
      dueAt: "2026-08-20",
    });
    assert.equal(withDue.dueAt, "2026-08-20");
    const waiting = await service.setStatus(actor, withDue.id, {
      expectedVersion: withDue.version,
      status: "WAITING_THIRD_PARTY",
    });
    assert.equal(waiting.status, "WAITING_THIRD_PARTY");
  });

  it("nega manage sem permissão", async () => {
    const { service } = createHarness();
    const viewer: TreasuryExceptionActor = {
      ...actor,
      canManageExceptions: false,
    };
    await assert.rejects(
      () =>
        service.upsertByUniqueKey(
          viewer,
          parseTreasuryExceptionUpsertInput(baseBody)
        ),
      TreasuryDomainError
    );
  });
});
