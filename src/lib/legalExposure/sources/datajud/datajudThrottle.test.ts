import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchDatajudByProcessNumber } from "./datajudClient.server.js";
import {
  clampDatajudMinRequestIntervalMs,
  datajudRateLimitWaitMs,
} from "./datajudContracts.js";
import {
  createDatajudThrottle,
  getSharedDatajudThrottle,
  resetSharedDatajudThrottleForTests,
  setSharedDatajudThrottleForTests,
} from "./datajudThrottle.js";

const PROCESS_A = "00002860620215090021";
const PROCESS_B = "00012345620245090001";
const PROCESS_C = "00098765420245090002";
const ENV = {
  DATAJUD_BASE_URL: "https://fixture.invalid",
  DATAJUD_API_KEY: "super-secret-value",
  DATAJUD_MIN_REQUEST_INTERVAL_MS: "1500",
};

function recordingThrottle(intervalMs = 1500) {
  const sleeps: number[] = [];
  let clock = 10_000;
  const throttle = createDatajudThrottle({
    intervalMs,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { throttle, sleeps };
}

function emptyHits() {
  return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 });
}

describe("datajud request interval", () => {
  it("clamp é defensivo", () => {
    assert.equal(clampDatajudMinRequestIntervalMs(undefined), 1500);
    assert.equal(clampDatajudMinRequestIntervalMs("100"), 500);
    assert.equal(clampDatajudMinRequestIntervalMs("99999"), 10000);
    assert.equal(datajudRateLimitWaitMs(1, 1500), 1500);
    assert.equal(datajudRateLimitWaitMs(0, 1500), 1500);
    assert.equal(datajudRateLimitWaitMs(3, 1500), 3000);
  });

  it("duas chamadas sequenciais respeitam o intervalo", async () => {
    const { throttle, sleeps } = recordingThrottle(1500);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return emptyHits();
    };
    await searchDatajudByProcessNumber({
      env: ENV,
      fetchImpl,
      throttle,
      tribunalAlias: "trt9",
      processNumber: PROCESS_A,
    });
    await searchDatajudByProcessNumber({
      env: ENV,
      fetchImpl,
      throttle,
      tribunalAlias: "trt9",
      processNumber: PROCESS_B,
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1500]);
  });

  it("throttle compartilhado vale entre processos A, B e C", async () => {
    resetSharedDatajudThrottleForTests();
    const sleeps: number[] = [];
    let clock = 50_000;
    setSharedDatajudThrottleForTests(
      createDatajudThrottle({
        intervalMs: 1500,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
      })
    );
    const fetchImpl: typeof fetch = async () => emptyHits();
    await searchDatajudByProcessNumber({ env: ENV, fetchImpl, tribunalAlias: "trt9", processNumber: PROCESS_A });
    await searchDatajudByProcessNumber({ env: ENV, fetchImpl, tribunalAlias: "trt9", processNumber: PROCESS_B });
    await searchDatajudByProcessNumber({ env: ENV, fetchImpl, tribunalAlias: "trt9", processNumber: PROCESS_C });
    assert.deepEqual(sleeps, [1500, 1500]);
    resetSharedDatajudThrottleForTests();
  });

  it("reutiliza a instância do processo", () => {
    resetSharedDatajudThrottleForTests();
    const first = getSharedDatajudThrottle(1500);
    const second = getSharedDatajudThrottle(1500);
    assert.equal(first, second);
    resetSharedDatajudThrottleForTests();
  });
});

describe("datajud 429 retry", () => {
  it("primeiro 429 e depois 200 faz exatamente duas chamadas", async () => {
    const { throttle, sleeps } = recordingThrottle(1500);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
      return emptyHits();
    };
    const batch = await searchDatajudByProcessNumber({
      env: ENV,
      fetchImpl,
      throttle,
      tribunalAlias: "trt9",
      processNumber: PROCESS_A,
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1500]);
    assert.equal(batch.outcome, "NO_RESULTS");
  });

  it("segundo 429 não faz terceira chamada", async () => {
    const { throttle, sleeps } = recordingThrottle(1500);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    };
    const batch = await searchDatajudByProcessNumber({
      env: ENV,
      fetchImpl,
      throttle,
      tribunalAlias: "trt9",
      processNumber: PROCESS_A,
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1500]);
    assert.equal(batch.outcome, "RATE_LIMITED");
    assert.equal(batch.cases.length, 0);
  });
});
