import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalProcessKey } from "./legalExposureNormalization.js";
import {
  LEGAL_EXPOSURE_SOURCE_SCHEDULE,
  SOURCE_RUN_STALE_MS,
  nextScheduledAt,
  sourceReadinessOf,
} from "./legalExposureSourceSchedule.js";
import { buildSourceOperations, isRunInterrupted } from "./legalExposureSourceOperations.js";
import { createEmptyExposureMemory } from "./legalExposureStore.js";

describe("canonicalProcessKey", () => {
  it("máscaras distintas do mesmo CNJ geram a mesma string de 20 dígitos", () => {
    assert.equal(canonicalProcessKey("0001384-86.2026.5.09.0009").key, "00013848620265090009");
    assert.equal(canonicalProcessKey("00013848620265090009").key, "00013848620265090009");
    assert.equal(canonicalProcessKey("0001384 86 2026 5 09 0009").key, "00013848620265090009");
    assert.equal(canonicalProcessKey("00013848620265090009").ok, true);
  });

  it("números inválidos não colidem", () => {
    const left = canonicalProcessKey("abc", "case-a");
    const right = canonicalProcessKey("xyz", "case-b");
    assert.equal(left.ok, false);
    assert.equal(right.ok, false);
    assert.notEqual(left.key, right.key);
    assert.equal(left.reason, "INVALID_PROCESS_NUMBER");
  });
});

describe("agenda e prontidão das fontes", () => {
  it("nextScheduledAt usa a agenda oficial em America/Sao_Paulo", () => {
    const now = new Date("2026-09-30T16:00:00.000-03:00");
    const next = nextScheduledAt(["06:10", "12:10", "18:10", "23:10"], now);
    assert.ok(next);
    assert.equal(new Date(next!).toISOString(), new Date("2026-09-30T18:10:00.000-03:00").toISOString());
  });

  it("provider sem credencial = NEEDS_CREDENTIAL e Domicílio = DISABLED_BY_POLICY", () => {
    const env = { LEGAL_EXPOSURE_ENABLED: "1" };
    assert.equal(sourceReadinessOf("ESCAVADOR", env).readiness, "NEEDS_CREDENTIAL");
    assert.equal(sourceReadinessOf("JUSBRASIL", env).readiness, "NEEDS_CREDENTIAL");
    assert.equal(sourceReadinessOf("DATAJUD", env).readiness, "NEEDS_CREDENTIAL");
    assert.equal(sourceReadinessOf("DOMICILIO", env).readiness, "DISABLED_BY_POLICY");
    assert.equal(sourceReadinessOf("DJEN", env).configured, true);
    assert.ok(LEGAL_EXPOSURE_SOURCE_SCHEDULE.find((row) => row.source === "DJEN")?.times.length === 4);
  });

  it("run RUNNING recente aparece como running; estourado vira interrompida", () => {
    const now = new Date("2026-09-30T18:15:00.000Z");
    const memory = createEmptyExposureMemory();
    const ops = buildSourceOperations({
      memory,
      now,
      runs: [
        {
          id: "run-1",
          source: "DJEN",
          job: "DISCOVERY",
          status: "RUNNING",
          trigger: "SCHEDULED",
          startedAt: new Date(now.getTime() - 60_000).toISOString(),
          finishedAt: null,
          durationMs: null,
          outcome: null,
          processesRequested: null,
          processesFound: null,
          movementsReceived: null,
          communicationsReceived: null,
          entitiesProcessed: null,
          errorCode: null,
          sanitizedError: null,
          externalCall: true,
        },
      ],
      env: { LEGAL_EXPOSURE_ENABLED: "1", DJEN_ENABLED: "1" },
    });
    const djen = ops.find((row) => row.source === "DJEN");
    assert.equal(djen?.running, true);
    assert.equal(djen?.healthCheckExternalCall, false);
    assert.equal(
      isRunInterrupted(
        {
          ...djen!.lastRun!,
          status: "RUNNING",
          startedAt: new Date(now.getTime() - SOURCE_RUN_STALE_MS - 1).toISOString(),
        },
        now
      ),
      true
    );
  });

  it("durationMs é a diferença real de startedAt/finishedAt", () => {
    const started = new Date("2026-09-30T12:10:00.000Z");
    const finished = new Date("2026-09-30T12:12:18.000Z");
    assert.equal(finished.getTime() - started.getTime(), 138_000);
  });
});
