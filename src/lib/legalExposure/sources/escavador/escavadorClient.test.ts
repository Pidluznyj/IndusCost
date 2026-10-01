import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEscavadorEnabled } from "../../legalExposureFeatureFlags.js";
import { fetchEscavadorProcess } from "./escavadorClient.server.js";
import { mapEscavadorProcess, notConfiguredEscavadorBatch } from "./escavadorMapper.js";
import { createEscavadorThrottle } from "./escavadorThrottle.js";

describe("escavador complementary source", () => {
  it("desligado por default", () => {
    assert.equal(isEscavadorEnabled({ LEGAL_EXPOSURE_ENABLED: "1" }), false);
    assert.equal(notConfiguredEscavadorBatch().errorCode, "NOT_CONFIGURED");
  });

  it("sem token não chama rede", async () => {
    let calls = 0;
    const batch = await fetchEscavadorProcess({
      env: { LEGAL_EXPOSURE_ENABLED: "1", ESCAVADOR_ENABLED: "1" },
      processNumber: "00012345620245090001",
      fetchImpl: (async () => {
        calls += 1;
        return new Response("{}");
      }) as typeof fetch,
    });
    assert.equal(calls, 0);
    assert.equal(batch.externalCall, false);
    assert.equal(batch.errorCode, "NOT_CONFIGURED");
  });

  it("429 faz um único retry e para", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    };
    const batch = await fetchEscavadorProcess({
      env: {
        LEGAL_EXPOSURE_ENABLED: "1",
        ESCAVADOR_ENABLED: "1",
        ESCAVADOR_API_KEY: "token",
        ESCAVADOR_BASE_URL: "https://api.escavador.com",
      },
      processNumber: "00012345620245090001",
      fetchImpl,
      throttle: createEscavadorThrottle({ intervalMs: 1, sleep: async () => {} }),
    });
    assert.equal(calls, 2);
    assert.equal(batch.outcome, "RATE_LIMITED");
  });

  it("mapeia capa e não inventa ausências", () => {
    const mapped = mapEscavadorProcess(
      {
        numero_cnj: "0001234-56.2024.5.09.0001",
        classe: "Reclamação Trabalhista",
        valor_causa: "168127.48",
        envolvidos: [{ nome: "Maria", polo: "ativo", cpf: "12345678909" }],
      },
      { items: [] }
    );
    assert.equal(mapped.cases[0]?.className, "Reclamação Trabalhista");
    assert.equal(mapped.cases[0]?.claimValue, "168127.48");
    assert.equal(mapped.cases[0]?.parties[0]?.name, "Maria");
    assert.equal(mapped.cases[0]?.attorneys?.length ?? 0, 0);
  });
});
