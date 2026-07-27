import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TREASURY_PROJECTION_ALGORITHM_VERSION } from "./domain/treasuryProjectionEngine.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import {
  createEmptyTreasuryProjectionRunMemoryStore,
  createMemoryTreasuryProjectionRunRepository,
} from "./repositories/treasuryProjectionRunRepository.memory.js";
import {
  executeTreasuryProjection,
  getLatestValidTreasuryProjection,
} from "./services/treasuryProjectionExecutionService.server.js";
import type { TreasuryProjectionEngineInput } from "./domain/treasuryProjectionEngine.js";

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function engineSeed(): Omit<
  TreasuryProjectionEngineInput,
  "scenario" | "periodFrom" | "periodTo" | "asOfCivilDate"
> {
  return {
    accounts: [
      {
        accountId: ACC,
        code: "CX",
        includeInConsolidated: true,
        minimumBalance: "0.00",
        openingBalance: "1000.00",
      },
    ],
    receivables: [
      {
        id: "r1",
        officialTitleId: "11111111-1111-4111-8111-111111111111",
        nomusExternalId: 1001,
        accountId: ACC,
        dueDate: "2026-07-28",
        originalAmount: "200.00",
        openBalance: "200.00",
      },
    ],
    payables: [],
    settlements: [],
    expectations: [],
    promises: [],
    programming: [],
    ledgerEntries: [],
    transfers: [],
    fallbackAccountId: ACC,
  };
}

describe("treasuryProjectionExecution — sucesso / falha / concorrência", () => {
  it("sucesso: cria run SUCCEEDED, persiste linhas e não apaga anterior", async () => {
    const store = createEmptyTreasuryProjectionRunMemoryStore();
    const repository = createMemoryTreasuryProjectionRunRepository(store);

    const first = await executeTreasuryProjection(
      {
        companyCode: "ACME",
        scenario: "CONTRACTUAL",
        periodFrom: "2026-07-27",
        periodTo: "2026-07-29",
        asOfCivilDate: "2026-07-27",
        actorUserId: USER,
        engineInput: engineSeed(),
      },
      { repository }
    );

    assert.equal(first.run.status, "SUCCEEDED");
    assert.equal(first.previousValidRunId, null);
    assert.equal(first.run.algorithmVersion, TREASURY_PROJECTION_ALGORITHM_VERSION);
    assert.ok(first.run.sourceVersion.length === 64);
    assert.ok((first.engine?.lineCount ?? 0) > 0);
    const lines1 = await repository.listDayLines(first.run.id);
    assert.equal(lines1.length, first.engine?.lineCount);

    const second = await executeTreasuryProjection(
      {
        companyCode: "ACME",
        scenario: "CONTRACTUAL",
        periodFrom: "2026-07-27",
        periodTo: "2026-07-29",
        asOfCivilDate: "2026-07-27",
        actorUserId: USER,
        engineInput: engineSeed(),
      },
      { repository }
    );

    assert.equal(second.run.status, "SUCCEEDED");
    assert.equal(second.previousValidRunId, first.run.id);
    assert.notEqual(second.run.id, first.run.id);
    // anterior permanece
    const stillFirst = await repository.findById(first.run.id);
    assert.equal(stillFirst?.status, "SUCCEEDED");
    const latest = await getLatestValidTreasuryProjection(
      "ACME",
      "CONTRACTUAL",
      { repository }
    );
    assert.equal(latest?.id, second.run.id);
  });

  it("falha: marca FAILED e mantém última projeção válida anterior", async () => {
    const store = createEmptyTreasuryProjectionRunMemoryStore();
    const repository = createMemoryTreasuryProjectionRunRepository(store);

    const ok = await executeTreasuryProjection(
      {
        companyCode: "ACME",
        scenario: "PROBABLE",
        periodFrom: "2026-07-27",
        periodTo: "2026-07-28",
        asOfCivilDate: "2026-07-27",
        actorUserId: USER,
        engineInput: engineSeed(),
      },
      { repository }
    );
    assert.equal(ok.run.status, "SUCCEEDED");

    await assert.rejects(
      () =>
        executeTreasuryProjection(
          {
            companyCode: "ACME",
            scenario: "PROBABLE",
            periodFrom: "2026-07-27",
            periodTo: "2026-07-28",
            asOfCivilDate: "2026-07-27",
            actorUserId: USER,
            engineInput: engineSeed(),
          },
          {
            repository,
            runEngine: () => {
              throw new Error("boom de cálculo");
            },
          }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        /boom de cálculo/.test(err.message)
    );

    const failed = store.runs.find((r) => r.status === "FAILED");
    assert.ok(failed);
    assert.match(failed!.failureMessage ?? "", /boom/);
    const latest = await getLatestValidTreasuryProjection("ACME", "PROBABLE", {
      repository,
    });
    assert.equal(latest?.id, ok.run.id);
  });

  it("concorrência: segunda execução para mesma empresa/cenário recebe CONFLICT", async () => {
    const store = createEmptyTreasuryProjectionRunMemoryStore();
    const repository = createMemoryTreasuryProjectionRunRepository(store);

    const locked = await repository.tryAcquireExecutionLock(
      "ACME",
      "CONFIRMED"
    );
    assert.equal(locked, true);

    await assert.rejects(
      () =>
        executeTreasuryProjection(
          {
            companyCode: "ACME",
            scenario: "CONFIRMED",
            periodFrom: "2026-07-27",
            periodTo: "2026-07-28",
            asOfCivilDate: "2026-07-27",
            actorUserId: USER,
            engineInput: engineSeed(),
          },
          { repository }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    await repository.releaseExecutionLock("ACME", "CONFIRMED");
    const after = await executeTreasuryProjection(
      {
        companyCode: "ACME",
        scenario: "CONFIRMED",
        periodFrom: "2026-07-27",
        periodTo: "2026-07-28",
        asOfCivilDate: "2026-07-27",
        actorUserId: USER,
        engineInput: {
          ...engineSeed(),
          receivables: [
            {
              ...engineSeed().receivables[0]!,
              confirmedDate: "2026-07-28",
            },
          ],
        },
      },
      { repository }
    );
    assert.equal(after.run.status, "SUCCEEDED");
  });
});
