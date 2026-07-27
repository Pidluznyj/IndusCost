import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { TreasuryAuditLog } from "@prisma/client";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryUpdatedAudit,
} from "./treasuryAuditHelpers.js";
import {
  auditTreasuryCreate,
  auditTreasuryUpdate,
  deleteTreasuryAuditLog,
  rejectTreasuryAuditLogMutation,
  updateTreasuryAuditLog,
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./services/treasuryAuditService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20260806120000_treasury_audit_log/migration.sql"
);

type Store = {
  accounts: Array<{ id: string; name: string }>;
  audits: TreasuryAuditLog[];
  committed: boolean;
};

function createTransactionalFakeDb(store: Store): {
  db: TreasuryAuditDb & {
    $transaction: <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) => Promise<T>;
    treasuryFinancialAccount: {
      create: (args: { data: { name: string } }) => Promise<{ id: string; name: string }>;
    };
  };
} {
  const makeClient = (buffer: Store, immutable = true): TreasuryAuditDb & {
    treasuryFinancialAccount: {
      create: (args: { data: { name: string } }) => Promise<{ id: string; name: string }>;
    };
  } =>
    ({
      treasuryFinancialAccount: {
        async create(args: { data: { name: string } }) {
          const row = { id: randomUUID(), name: args.data.name };
          buffer.accounts.push(row);
          return row;
        },
      },
      treasuryAuditLog: {
        async create(args: { data: Record<string, unknown> }) {
          const now = new Date();
          const row = {
            id: randomUUID(),
            entityType: String(args.data.entityType),
            entityId: String(args.data.entityId),
            action: String(args.data.action),
            beforeJson: (args.data.beforeJson as object | null) ?? null,
            afterJson: (args.data.afterJson as object | null) ?? null,
            metadataJson: (args.data.metadataJson as object | null) ?? null,
            justification: (args.data.justification as string | null) ?? null,
            requestId: (args.data.requestId as string | null) ?? null,
            sessionId: (args.data.sessionId as string | null) ?? null,
            userId: (args.data.userId as string | null) ?? null,
            userName: (args.data.userName as string | null) ?? null,
            occurredAt: (args.data.occurredAt as Date) ?? now,
            createdAt: now,
          } as TreasuryAuditLog;
          buffer.audits.push(row);
          return row;
        },
        async update() {
          if (immutable) {
            throw new Error(
              "TreasuryAuditLog is append-only and cannot be updated or deleted"
            );
          }
          return null;
        },
        async delete() {
          if (immutable) {
            throw new Error(
              "TreasuryAuditLog is append-only and cannot be updated or deleted"
            );
          }
          return null;
        },
      },
    }) as unknown as TreasuryAuditDb & {
      treasuryFinancialAccount: {
        create: (args: { data: { name: string } }) => Promise<{ id: string; name: string }>;
      };
    };

  const db = {
    ...makeClient(store),
    async $transaction<T>(fn: (tx: TreasuryAuditDb) => Promise<T>): Promise<T> {
      const draft: Store = {
        accounts: [...store.accounts],
        audits: [...store.audits],
        committed: false,
      };
      const tx = makeClient(draft);
      try {
        const result = await fn(tx);
        store.accounts = draft.accounts;
        store.audits = draft.audits;
        store.committed = true;
        return result;
      } catch (err) {
        // rollback conjunto — nada do draft é promovido
        store.committed = false;
        throw err;
      }
    },
  };

  return { db };
}

describe("treasuryAudit — helpers tipados", () => {
  it("monta evento de criação com before null", () => {
    const event = buildTreasuryCreatedAudit({
      entityType: "FINANCIAL_ACCOUNT",
      entityId: "acc-1",
      after: { name: "Caixa" },
      actor: {
        userId: "user-1",
        userName: "Ana",
        sessionId: "sess-1",
        requestId: "req-1",
      },
    });
    assert.equal(event.action, "CREATE");
    assert.equal(event.before, null);
    assert.deepEqual(event.after, { name: "Caixa" });
    assert.equal(event.requestId, "req-1");
    assert.equal(event.sessionId, "sess-1");
  });

  it("monta evento de alteração com before/after", () => {
    const event = buildTreasuryUpdatedAudit({
      entityType: "FINANCIAL_ACCOUNT",
      entityId: "acc-1",
      before: { name: "Caixa" },
      after: { name: "Caixa principal" },
      justification: "renomeação",
      actor: { userId: "user-1" },
    });
    assert.equal(event.action, "UPDATE");
    assert.deepEqual(event.before, { name: "Caixa" });
    assert.equal(event.justification, "renomeação");
  });
});

describe("treasuryAudit — gravação e imutabilidade", () => {
  it("audita criação com campos obrigatórios", async () => {
    const store: Store = { accounts: [], audits: [], committed: false };
    const { db } = createTransactionalFakeDb(store);
    const occurredAt = new Date("2026-07-27T15:00:00.000Z");

    const row = await auditTreasuryCreate(db, {
      entityType: "FINANCIAL_ACCOUNT",
      entityId: "acc-create-1",
      after: { code: "CX01", name: "Caixa" },
      metadata: { companyCode: "LAZARIOS" },
      actor: {
        userId: "11111111-1111-4111-8111-111111111111",
        userName: "Ana",
        sessionId: "sess-create",
        requestId: "req-create",
      },
    });

    // occurredAt defaulted inside writer — force via writeTreasuryAuditLog for clock
    assert.equal(row.entityType, "FINANCIAL_ACCOUNT");
    assert.equal(row.action, "CREATE");
    assert.equal(row.beforeJson, null);
    assert.deepEqual(row.afterJson, { code: "CX01", name: "Caixa" });
    assert.deepEqual(row.metadataJson, { companyCode: "LAZARIOS" });
    assert.equal(row.requestId, "req-create");
    assert.equal(row.sessionId, "sess-create");
    assert.equal(row.userId, "11111111-1111-4111-8111-111111111111");
    assert.equal(store.audits.length, 1);

    const explicit = await writeTreasuryAuditLog(db, {
      ...buildTreasuryCreatedAudit({
        entityType: "BALANCE_SNAPSHOT",
        entityId: "snap-1",
        after: { availableBalance: "10.00" },
      }),
      occurredAt,
    });
    assert.equal(explicit.occurredAt.toISOString(), occurredAt.toISOString());
  });

  it("audita alteração preservando before/after", async () => {
    const store: Store = { accounts: [], audits: [], committed: false };
    const { db } = createTransactionalFakeDb(store);

    const row = await auditTreasuryUpdate(db, {
      entityType: "FINANCIAL_ACCOUNT",
      entityId: "acc-upd-1",
      before: { name: "A" },
      after: { name: "B" },
      justification: "ajuste cadastral",
      actor: {
        userId: "22222222-2222-4222-8222-222222222222",
        sessionId: "sess-upd",
        requestId: "req-upd",
      },
    });

    assert.equal(row.action, "UPDATE");
    assert.deepEqual(row.beforeJson, { name: "A" });
    assert.deepEqual(row.afterJson, { name: "B" });
    assert.equal(row.justification, "ajuste cadastral");
  });

  it("faz rollback conjunto se a operação principal falhar", async () => {
    const store: Store = { accounts: [], audits: [], committed: false };
    const { db } = createTransactionalFakeDb(store);

    await assert.rejects(
      () =>
        db.$transaction(async (tx) => {
          const account = await (
            tx as typeof db
          ).treasuryFinancialAccount.create({
            data: { name: "Conta temp" },
          });
          await auditTreasuryCreate(tx, {
            entityType: "FINANCIAL_ACCOUNT",
            entityId: account.id,
            after: account,
            actor: { userId: "user-tx", requestId: "req-tx", sessionId: "sess-tx" },
          });
          throw new Error("falha na operação principal");
        }),
      /falha na operação principal/
    );

    assert.equal(store.accounts.length, 0);
    assert.equal(store.audits.length, 0);
    assert.equal(store.committed, false);
  });

  it("impede alteração comum dos eventos (API + trigger SQL)", async () => {
    await assert.rejects(
      () => updateTreasuryAuditLog(),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
    await assert.rejects(
      () => deleteTreasuryAuditLog(),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
    assert.throws(
      () => rejectTreasuryAuditLogMutation("update"),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        /imutáveis/.test((err as Error).message)
    );

    const store: Store = { accounts: [], audits: [], committed: false };
    const { db } = createTransactionalFakeDb(store);
    await auditTreasuryCreate(db, {
      entityType: "FINANCIAL_ACCOUNT",
      entityId: "acc-imm",
      after: { name: "X" },
    });
    await assert.rejects(
      () =>
        (
          db as unknown as {
            treasuryAuditLog: { update: () => Promise<unknown> };
          }
        ).treasuryAuditLog.update(),
      /append-only/
    );

    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryAuditLog"/);
    assert.match(sql, /treasury_audit_log_immutable_trg/);
    assert.match(sql, /BEFORE UPDATE OR DELETE/);
    assert.match(sql, /append-only/);
  });
});
