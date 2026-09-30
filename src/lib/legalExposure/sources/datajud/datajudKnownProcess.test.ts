import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LEGAL_EXPOSURE_HTTP_TIMEOUT_MS, legalExposureFetch } from "../../legalExposureHttp.js";
import { movementFingerprint } from "../../legalExposureNormalization.js";
import { searchDatajudByProcessNumber } from "./datajudClient.server.js";
import { DATAJUD_HTTP_TIMEOUT_MS, buildDatajudProcessQuery } from "./datajudContracts.js";
import { mapDatajudSearch, normalizeDatajudDateTime } from "./datajudMapper.js";
import { createDatajudThrottle } from "./datajudThrottle.js";

const PROCESS = "00002860620215090021";
const COURT = "02ª VARA DO TRABALHO DE MARINGÁ";
const COMPLEMENT = {
  codigo: 2,
  descricao: "tipo_de_distribuicao_redistribuicao",
  valor: 2,
  nome: "sorteio",
};

const realisticHit = {
  hits: {
    hits: [
      {
        _source: {
          id: "TRT9_G1_00002860620215090021",
          tribunal: "TRT9",
          grau: "G1",
          numeroProcesso: PROCESS,
          dataAjuizamento: "20210330114043",
          orgaoJulgador: {
            codigo: 20364,
            nome: COURT,
            codigoMunicipioIBGE: 4115200,
          },
          classe: {
            codigo: 985,
            nome: "Ação Trabalhista - Rito Ordinário",
          },
          dataHoraUltimaAtualizacao: "2026-09-21T18:21:04.960000Z",
          movimentos: [
            {
              codigo: 26,
              dataHora: "2021-03-30T11:40:44.000Z",
              nome: "Distribuição",
              complementosTabelados: [COMPLEMENT],
              orgaoJulgador: {
                codigo: "20364",
                nome: COURT,
              },
            },
          ],
        },
      },
    ],
  },
};

function captureTimeouts<T>(run: () => Promise<T>): Promise<{ value: T; delays: number[] }> {
  const delays: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    delays.push(ms ?? 0);
    return realSetTimeout(fn as (...rest: unknown[]) => void, ms, ...args);
  }) as typeof setTimeout;
  return run()
    .then((value) => ({ value, delays }))
    .finally(() => {
      globalThis.setTimeout = realSetTimeout;
    });
}

describe("datajud date normalization", () => {
  it("converte AAAAMMDDHHMMSS real em ISO determinístico UTC", () => {
    const iso = normalizeDatajudDateTime("20210330114043");
    assert.equal(iso, "2021-03-30T11:40:43.000Z");
    const date = new Date(iso ?? "");
    assert.equal(Number.isNaN(date.getTime()), false);
    assert.equal(date.toISOString(), "2021-03-30T11:40:43.000Z");
  });

  it("rejeita compacto inválido, curto ou não numérico", () => {
    assert.equal(normalizeDatajudDateTime(null), null);
    assert.equal(normalizeDatajudDateTime(undefined), null);
    assert.equal(normalizeDatajudDateTime("20211330114043"), null);
    assert.equal(normalizeDatajudDateTime("20210230114043"), null);
    assert.equal(normalizeDatajudDateTime("abc"), null);
    assert.equal(normalizeDatajudDateTime("123"), null);
  });

  it("preserva timestamp ISO válido", () => {
    assert.equal(normalizeDatajudDateTime("2021-03-30T11:40:44.000Z"), "2021-03-30T11:40:44.000Z");
    assert.equal(
      normalizeDatajudDateTime("2026-09-21T18:21:04.960000Z"),
      "2026-09-21T18:21:04.960000Z"
    );
  });
});

describe("datajud mapper against real TRT9 payload", () => {
  it("mapeia processo conhecido, órgão, classe, data e complementos tabelados", () => {
    const mapped = mapDatajudSearch(realisticHit);
    assert.equal(mapped.outcome, "SUCCESS");
    assert.equal(mapped.externalCall, true);
    assert.equal(mapped.cases.length, 1);
    const row = mapped.cases[0];
    assert.ok(row);
    assert.equal(row.processNumber, PROCESS);
    assert.equal(row.sourceIdentifier, "TRT9_G1_00002860620215090021");
    assert.equal(row.officialIdentifier, "TRT9_G1_00002860620215090021");
    assert.equal(row.tribunal, "TRT9");
    assert.equal(row.degree, "G1");
    assert.equal(row.courtUnit, COURT);
    assert.equal(row.classCode, "985");
    assert.equal(row.className, "Ação Trabalhista - Rito Ordinário");
    assert.equal(row.filedAt, "2021-03-30T11:40:43.000Z");
    assert.equal(Number.isNaN(new Date(row.filedAt ?? "").getTime()), false);
    assert.equal(row.sourceUpdatedAt, "2026-09-21T18:21:04.960000Z");
    assert.equal(row.entityPole, "UNKNOWN");
    assert.equal(row.explicitCnpj, null);
    assert.equal(row.candidateName, null);
    assert.deepEqual(row.parties, []);
    assert.equal(row.movements.length, 1);
    const movement = row.movements[0];
    assert.ok(movement);
    assert.equal(movement.sourceCode, "26");
    assert.equal(movement.name, "Distribuição");
    assert.equal(movement.occurredAt, "2021-03-30T11:40:44.000Z");
    assert.equal(movement.courtUnit, COURT);
    assert.deepEqual(movement.complements, [COMPLEMENT]);
    const fingerprint = movementFingerprint({
      processNumberNormalized: PROCESS,
      sourceCode: movement.sourceCode,
      name: movement.name,
      occurredAt: movement.occurredAt,
      courtUnit: movement.courtUnit,
      complements: movement.complements,
    });
    assert.equal(
      fingerprint,
      movementFingerprint({
        processNumberNormalized: PROCESS,
        sourceCode: "26",
        name: "Distribuição",
        occurredAt: "2021-03-30T11:40:44.000Z",
        courtUnit: COURT,
        complements: [COMPLEMENT],
      })
    );
  });

  it("data compacta inválida não vira filedAt", () => {
    const mapped = mapDatajudSearch({
      hits: {
        hits: [
          {
            _source: {
              numeroProcesso: PROCESS,
              tribunal: "TRT9",
              dataAjuizamento: "20211330114043",
            },
          },
        ],
      },
    });
    assert.equal(mapped.cases[0]?.filedAt, null);
  });

  it("orgaoJulgador string e complementos legado continuam válidos", () => {
    const mapped = mapDatajudSearch({
      hits: {
        hits: [
          {
            _source: {
              numeroProcesso: PROCESS,
              tribunal: "TRT9",
              orgaoJulgador: COURT,
              movimentos: [
                {
                  codigo: 26,
                  nome: "Distribuição",
                  dataHora: "2021-03-30T11:40:44.000Z",
                  orgaoJulgador: COURT,
                  complementos: [COMPLEMENT],
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(mapped.cases[0]?.courtUnit, COURT);
    assert.equal(mapped.cases[0]?.movements[0]?.courtUnit, COURT);
    assert.deepEqual(mapped.cases[0]?.movements[0]?.complements, [COMPLEMENT]);
  });

  it("G1 e G2 do mesmo CNJ viram duas observações com IDs DataJud distintos", () => {
    const mapped = mapDatajudSearch({
      hits: {
        hits: [
          {
            _source: {
              id: "TRT9_G1_00002860620215090021",
              tribunal: "TRT9",
              grau: "G1",
              numeroProcesso: PROCESS,
              dataAjuizamento: "20210330114043",
              orgaoJulgador: {
                codigo: 20364,
                nome: COURT,
              },
              classe: {
                codigo: 985,
                nome: "Ação Trabalhista - Rito Ordinário",
              },
              movimentos: [],
            },
          },
          {
            _source: {
              id: "TRT9_G2_00002860620215090021",
              tribunal: "TRT9",
              grau: "G2",
              numeroProcesso: PROCESS,
              dataAjuizamento: "20230215150349",
              orgaoJulgador: {
                nome: "GAB. DES. MARLENE TERESINHA FUVERKI SUGUIMATSU",
              },
              classe: {
                codigo: 1004,
                nome: "Agravo de Petição",
              },
              movimentos: [],
            },
          },
        ],
      },
    });
    assert.equal(mapped.outcome, "SUCCESS");
    assert.equal(mapped.cases.length, 2);
    assert.equal(mapped.cases[0]?.processNumber, PROCESS);
    assert.equal(mapped.cases[1]?.processNumber, PROCESS);
    assert.equal(mapped.cases[0]?.sourceIdentifier, "TRT9_G1_00002860620215090021");
    assert.equal(mapped.cases[1]?.sourceIdentifier, "TRT9_G2_00002860620215090021");
    assert.equal(mapped.cases[0]?.officialIdentifier, "TRT9_G1_00002860620215090021");
    assert.equal(mapped.cases[1]?.officialIdentifier, "TRT9_G2_00002860620215090021");
    assert.notEqual(mapped.cases[0]?.sourceIdentifier, mapped.cases[1]?.sourceIdentifier);
    assert.equal(mapped.cases[0]?.entityPole, "UNKNOWN");
    assert.deepEqual(mapped.cases[0]?.parties, []);
    assert.equal(mapped.cases[0]?.explicitCnpj, null);
    assert.equal(mapped.cases[0]?.candidateName, null);
  });

  it("sem id DataJud o identificador cai no número do processo", () => {
    const mapped = mapDatajudSearch({
      hits: {
        hits: [
          {
            _source: {
              numeroProcesso: PROCESS,
              tribunal: "TRT9",
            },
          },
        ],
      },
    });
    assert.equal(mapped.cases[0]?.sourceIdentifier, PROCESS);
    assert.equal(mapped.cases[0]?.officialIdentifier, PROCESS);
  });

  it("sem movimentos não falha", () => {
    const mapped = mapDatajudSearch({
      hits: {
        hits: [{ _source: { numeroProcesso: PROCESS, tribunal: "TRT9" } }],
      },
    });
    assert.equal(mapped.outcome, "SUCCESS");
    assert.deepEqual(mapped.cases[0]?.movements, []);
  });

  it("hits vazio continua NO_RESULTS e payload sem hits continua INVALID_RESPONSE", () => {
    assert.equal(mapDatajudSearch({ hits: { hits: [] } }).outcome, "NO_RESULTS");
    assert.equal(mapDatajudSearch({}).outcome, "INVALID_RESPONSE");
  });
});

describe("datajud known-process client timeout", () => {
  it("DataJud pede 90s e o default compartilhado permanece 15s", async () => {
    assert.equal(LEGAL_EXPOSURE_HTTP_TIMEOUT_MS, 15_000);
    assert.equal(DATAJUD_HTTP_TIMEOUT_MS, 90_000);

    const defaultCall = await captureTimeouts(() =>
      legalExposureFetch({
        fetchImpl: async () => new Response("{}", { status: 200 }),
        url: "https://fixture.invalid/default",
        path: "/default",
      })
    );
    assert.equal(defaultCall.delays.includes(15_000), true);
    assert.equal(defaultCall.delays.includes(90_000), false);

    let calls = 0;
    const datajudCall = await captureTimeouts(() =>
      searchDatajudByProcessNumber({
        env: {
          DATAJUD_BASE_URL: "https://fixture.invalid",
          DATAJUD_API_KEY: "super-secret-value",
        },
        fetchImpl: async (_url, init) => {
          calls += 1;
          const body = JSON.parse(String(init?.body ?? "{}")) as ReturnType<typeof buildDatajudProcessQuery>;
          assert.deepEqual(body.query, { match: { numeroProcesso: PROCESS } });
          assert.equal(body.track_total_hits, false);
          return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 });
        },
        tribunalAlias: "trt9",
        processNumber: PROCESS,
        throttle: createDatajudThrottle({ intervalMs: 1500, sleep: async () => {} }),
      })
    );
    assert.equal(calls, 1);
    assert.equal(datajudCall.delays.includes(90_000), true);
    assert.equal(datajudCall.delays.includes(15_000), false);
    assert.equal(datajudCall.value.outcome, "NO_RESULTS");
    assert.equal(JSON.stringify(datajudCall.value).includes("super-secret-value"), false);

    const clientSrc = readFileSync(join(process.cwd(), "src/lib/legalExposure/sources/datajud/datajudClient.server.ts"), "utf8");
    assert.match(clientSrc, /timeoutMs:\s*DATAJUD_HTTP_TIMEOUT_MS/);
    const httpSrc = readFileSync(join(process.cwd(), "src/lib/legalExposure/legalExposureHttp.ts"), "utf8");
    assert.match(httpSrc, /LEGAL_EXPOSURE_HTTP_TIMEOUT_MS\s*=\s*15_000/);
    const djenSrc = readFileSync(join(process.cwd(), "src/lib/legalExposure/sources/djen/djenClient.server.ts"), "utf8");
    assert.equal(djenSrc.includes("timeoutMs"), false);
    const domicilioSrc = readFileSync(
      join(process.cwd(), "src/lib/legalExposure/sources/domicilio/domicilioMonitoringClient.server.ts"),
      "utf8"
    );
    assert.equal(domicilioSrc.includes("timeoutMs"), false);
  });
});
