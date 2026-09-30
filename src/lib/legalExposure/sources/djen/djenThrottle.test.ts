import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchDjen } from "./djenClient.server.js";
import {
  clampDjenMinRequestIntervalMs,
  djenRateLimitWaitMs,
} from "./djenContracts.js";
import {
  createDjenThrottle,
  getSharedDjenThrottle,
  resetSharedDjenThrottleForTests,
  setSharedDjenThrottleForTests,
} from "./djenThrottle.js";

const PROCESS = "00002860620215090021";
const ENV = { DJEN_BASE_URL: "https://fixture.invalid", DJEN_MAX_PAGES: "5" };

function recordingThrottle(intervalMs = 1500) {
  const sleeps: number[] = [];
  let clock = 10_000;
  const throttle = createDjenThrottle({
    intervalMs,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { throttle, sleeps };
}

function okPage(pagina: number) {
  return new Response(
    JSON.stringify({
      count: 1,
      items: [{ numeroProcesso: PROCESS, siglaTribunal: "TRT9", nomeParte: `p${pagina}` }],
    }),
    { status: 200 }
  );
}

function fullPage() {
  return new Response(
    JSON.stringify({
      count: 40,
      items: Array.from({ length: 20 }, (_, index) => ({
        numeroProcesso: PROCESS,
        siglaTribunal: "TRT9",
        nomeParte: `item-${index}`,
      })),
    }),
    { status: 200 }
  );
}

describe("djen request interval", () => {
  it("clamp é defensivo", () => {
    assert.equal(clampDjenMinRequestIntervalMs(undefined), 1500);
    assert.equal(clampDjenMinRequestIntervalMs("100"), 500);
    assert.equal(clampDjenMinRequestIntervalMs("99999"), 10000);
    assert.equal(djenRateLimitWaitMs(1, 1500), 1500);
    assert.equal(djenRateLimitWaitMs(0, 1500), 1500);
    assert.equal(djenRateLimitWaitMs(3, 1500), 3000);
  });

  it("duas chamadas DJEN respeitam o intervalo mínimo", async () => {
    const { throttle, sleeps } = recordingThrottle(1500);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return okPage(1);
    };
    await searchDjen({
      env: ENV,
      fetchImpl,
      throttle,
      query: { nomeParte: "Lazarios Comercio de Plasticos LTDA" },
    });
    await searchDjen({
      env: ENV,
      fetchImpl,
      throttle,
      query: { nomeParte: "Koppetel Comercio de Plasticos LTDA" },
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1500]);
  });

  it("páginas respeitam intervalo", async () => {
    const { throttle, sleeps } = recordingThrottle(1500);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return fullPage();
    };
    await searchDjen({
      env: { ...ENV, DJEN_MAX_PAGES: "2" },
      fetchImpl,
      throttle,
      query: { nomeParte: "Lazarios Comercio de Plasticos LTDA" },
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1500]);
  });

  it("termos respeitam intervalo", async () => {
    const { throttle, sleeps } = recordingThrottle(2000);
    const fetchImpl: typeof fetch = async () => okPage(1);
    await searchDjen({
      env: ENV,
      fetchImpl,
      throttle,
      query: { nomeParte: "Sm Comercio de Plasticos LTDA - SM" },
    });
    await searchDjen({
      env: ENV,
      fetchImpl,
      throttle,
      query: { nomeParte: "SM" },
    });
    assert.deepEqual(sleeps, [2000]);
  });

  it("entidades respeitam intervalo via throttle compartilhado", async () => {
    resetSharedDjenThrottleForTests();
    const sleeps: number[] = [];
    let clock = 50_000;
    setSharedDjenThrottleForTests(
      createDjenThrottle({
        intervalMs: 1500,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
      })
    );
    const fetchImpl: typeof fetch = async () => okPage(1);
    await searchDjen({ env: ENV, fetchImpl, query: { nomeParte: "Empresa A" } });
    await searchDjen({ env: ENV, fetchImpl, query: { nomeParte: "Empresa B" } });
    await searchDjen({ env: ENV, fetchImpl, query: { nomeParte: "Empresa C" } });
    assert.deepEqual(sleeps, [1500, 1500]);
    resetSharedDjenThrottleForTests();
  });
});

describe("djen 429 retry", () => {
  it("429 + Retry-After 1 aguarda o intervalo e tenta uma vez", async () => {
    const { throttle, sleeps } = recordingThrottle(1500);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
      return okPage(1);
    };
    const batch = await searchDjen({
      env: ENV,
      fetchImpl,
      throttle,
      query: { nomeParte: "Lazarios Comercio de Plasticos LTDA" },
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1500]);
    assert.equal(batch.outcome, "SUCCESS");
    assert.equal(batch.cases.length, 1);
  });

  it("segundo 429 retorna RATE_LIMITED sem terceiro request", async () => {
    const { throttle, sleeps } = recordingThrottle(1500);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    };
    const batch = await searchDjen({
      env: ENV,
      fetchImpl,
      throttle,
      query: { nomeParte: "Koppetel Comercio de Plasticos LTDA" },
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1500]);
    assert.equal(batch.outcome, "RATE_LIMITED");
    assert.equal(batch.cases.length, 0);
  });

  it("página com dados + 429 no retry permanece PARTIAL", async () => {
    const { throttle } = recordingThrottle(500);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return fullPage();
      return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    };
    const batch = await searchDjen({
      env: { ...ENV, DJEN_MAX_PAGES: "5" },
      fetchImpl,
      throttle,
      query: { nomeParte: "Sm Comercio de Plasticos LTDA - SM" },
    });
    assert.equal(calls, 3);
    assert.equal(batch.outcome, "PARTIAL");
    assert.equal(batch.errorCode, "RATE_LIMITED");
    assert.equal(batch.cases.length, 20);
  });
});

describe("shared throttle factory", () => {
  it("reutiliza a instância do processo", () => {
    resetSharedDjenThrottleForTests();
    const first = getSharedDjenThrottle(1500);
    const second = getSharedDjenThrottle(1500);
    assert.equal(first, second);
    resetSharedDjenThrottleForTests();
  });
});
