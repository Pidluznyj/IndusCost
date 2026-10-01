import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import type { NormalizedCaseObservation, NormalizedSourceBatch } from "./legalExposureContracts.js";
import { createMemoryExposureRepository } from "./legalExposureRepository.server.js";
import { createLegalExposureService } from "./legalExposureService.server.js";
import { LEGAL_EXPOSURE_AUTOSYNC_OFF_MESSAGE, legalExposureAutosyncApplyAllowed, parseLegalExposureSyncArgs } from "./legalExposureSyncCli.js";
import { createEmptyExposureMemory, type LegalExposureMemory } from "./legalExposureStore.js";
import { searchDjen } from "./sources/djen/djenClient.server.js";
import { clampDjenMaxPages, djenHasNextPage } from "./sources/djen/djenContracts.js";
import { createDjenThrottle } from "./sources/djen/djenThrottle.js";

const USER = "00000000-0000-4000-8000-000000000099";
const PROCESS = "00002860620215090021";
const PROCESS_B = "00011111111111111111";
const G1 = "TRT9_G1_00002860620215090021";
const G2 = "TRT9_G2_00002860620215090021";

function sequentialIds() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function emptyBatch(source: NormalizedSourceBatch["source"], extra?: Partial<NormalizedSourceBatch>): NormalizedSourceBatch {
  return {
    source,
    outcome: "NO_RESULTS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
    ...extra,
  };
}

function observation(
  partial: Partial<NormalizedCaseObservation> & Pick<NormalizedCaseObservation, "processNumber" | "sourceIdentifier">
): NormalizedCaseObservation {
  return {
    tribunal: "TRT9",
    jurisdiction: null,
    degree: null,
    courtUnit: null,
    classCode: null,
    className: null,
    filedAt: null,
    currentStatus: null,
    entityPole: "UNKNOWN",
    sourceUpdatedAt: null,
    explicitCnpj: null,
    candidateName: null,
    officialIdentifier: partial.sourceIdentifier,
    parties: [],
    movements: [],
    rawMetadata: { id: partial.sourceIdentifier },
    ...partial,
  };
}

function seedGroupEntities(memory: LegalExposureMemory) {
  const timestamp = "2026-09-30T12:00:00.000Z";
  FINANCE_INTERNAL_GROUP_COMPANIES.forEach((company, index) => {
    memory.entities.push({
      id: `entity-${index}`,
      cnpj: company.cnpj,
      legalName: company.name,
      tradeName: null,
      active: true,
      state: null,
      city: null,
      monitorDomicilio: true,
      monitorDatajud: true,
      monitorDjen: true,
      monitorCertificates: true,
      domicilioTenantId: null,
      lastSuccessfulSyncAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
}

function seedKnownCase(memory: LegalExposureMemory, entityId: string, processNumber = PROCESS) {
  memory.cases.push({
    id: `case-${entityId}`,
    entityId,
    processNumber,
    processNumberNormalized: processNumber,
    tribunal: "TRT9",
    jurisdiction: null,
    degree: null,
    courtUnit: null,
    classCode: null,
    className: null,
    filedAt: null,
    currentStatus: null,
    entityPole: "UNKNOWN",
    systemName: null,
    area: null,
    claimValue: null,
    claimCurrency: null,
    archivedAt: null,
    secrecy: null,
    priority: null,
    firstSeenAt: "2026-09-29T12:00:00.000Z",
    lastSeenAt: "2026-09-29T12:00:00.000Z",
    primarySource: "DJEN",
    sourceUpdatedAt: null,
    createdAt: "2026-09-29T12:00:00.000Z",
    updatedAt: "2026-09-29T12:00:00.000Z",
  });
}

describe("djen pagination", () => {
  it("usa count do payload para continuar e para no limite", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      const pagina = Number(new URL(url).searchParams.get("pagina") ?? "1");
      return new Response(
        JSON.stringify({
          count: 40,
          items: [{ numeroProcesso: PROCESS, siglaTribunal: "TRT9", nomeParte: `pagina-${pagina}` }],
        }),
        { status: 200 }
      );
    };
    const batch = await searchDjen({
      env: { DJEN_BASE_URL: "https://fixture.invalid", DJEN_MAX_PAGES: "2" },
      fetchImpl,
      throttle: createDjenThrottle({ intervalMs: 500, sleep: async () => {} }),
      query: { nomeParte: "Lazarios Comercio de Plasticos LTDA" },
    });
    assert.equal(calls.length, 2);
    assert.equal(batch.cases.length, 2);
    assert.equal(batch.outcome, "SUCCESS");
  });

  it("RATE_LIMITED depois de página válida preserva resultados e PARTIAL", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
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
      return new Response("{}", { status: 429, headers: { "retry-after": "8" } });
    };
    const batch = await searchDjen({
      env: { DJEN_BASE_URL: "https://fixture.invalid", DJEN_MAX_PAGES: "5" },
      fetchImpl,
      throttle: createDjenThrottle({ intervalMs: 500, sleep: async () => {} }),
      query: { nomeParte: "Koppetel Comercio de Plasticos LTDA" },
    });
    assert.equal(calls, 3);
    assert.equal(batch.outcome, "PARTIAL");
    assert.equal(batch.errorCode, "RATE_LIMITED");
    assert.equal(batch.cases.length, 20);
    assert.equal(batch.retryAfterSeconds, 8);
  });

  it("clamp de páginas é defensivo", () => {
    assert.equal(clampDjenMaxPages("0"), 1);
    assert.equal(clampDjenMaxPages("99"), 99);
    assert.equal(clampDjenMaxPages("200"), 100);
    assert.equal(clampDjenMaxPages(undefined), 50);
    assert.equal(djenHasNextPage({ pagina: 1, itensPorPagina: 20, itemCount: 20, totalCount: 40 }), true);
    assert.equal(djenHasNextPage({ pagina: 2, itensPorPagina: 20, itemCount: 20, totalCount: 40 }), false);
  });
});

describe("exposure monitoring pipeline", () => {
  it("3 discovery terms com o mesmo CNJ chamam DataJud uma vez", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    memory.entities[0]!.tradeName = "Lazarios";
    memory.aliases.push({
      id: "alias-a",
      entityId: "entity-0",
      type: "OLD_LEGAL_NAME",
      value: "Lazarios Plasticos",
      normalizedValue: "LAZARIOS PLASTICOS",
      active: true,
      createdAt: "2026-09-30T12:00:00.000Z",
    });
    const inner = createMemoryExposureRepository(memory);
    const djenCalls: string[] = [];
    const datajudCalls: Array<{ processNumber?: string; tribunalAlias?: string }> = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async (input) => {
          djenCalls.push(input?.nomeParte ?? input?.numeroProcesso ?? "");
          return emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" })],
          });
        },
        datajud: async (input) => {
          datajudCalls.push(input ?? {});
          return emptyBatch("DATAJUD", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    assert.equal(djenCalls.filter((row) => row && !/^\d{20}$/.test(row)).length, 3);
    assert.equal(djenCalls.filter((row) => row === PROCESS).length, 1);
    assert.equal(datajudCalls.length, 1);
    assert.equal(datajudCalls[0]?.processNumber, PROCESS);
  });

  it("dois CNJs diferentes geram uma chamada DataJud cada", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const datajudCalls: string[] = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async () =>
          emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [
              observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" }),
              observation({ processNumber: PROCESS_B, sourceIdentifier: PROCESS_B, tribunal: "TRT9" }),
            ],
          }),
        datajud: async (input) => {
          datajudCalls.push(input?.processNumber ?? "");
          return emptyBatch("DATAJUD", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    assert.deepEqual(datajudCalls.sort(), [PROCESS, PROCESS_B].sort());
  });

  it("processo existente é atualizado pelo DataJud mesmo com DJEN NO_RESULTS", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    seedKnownCase(memory, "entity-0");
    const inner = createMemoryExposureRepository(memory);
    let datajudCalls = 0;
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T15:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async () => emptyBatch("DJEN", { outcome: "NO_RESULTS", externalCall: true }),
        datajud: async () => {
          datajudCalls += 1;
          return emptyBatch("DATAJUD", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [
              observation({
                processNumber: PROCESS,
                sourceIdentifier: G1,
                officialIdentifier: G1,
                currentStatus: "ATIVO",
                rawMetadata: { id: G1 },
              }),
            ],
          });
        },
      },
    });
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    assert.equal(datajudCalls, 1);
    assert.equal(inner.snapshot().cases.length, 1);
    assert.equal(inner.snapshot().cases[0]?.currentStatus, "ATIVO");
    assert.equal(inner.snapshot().evidences.some((row) => row.sourceIdentifier === G1), true);
  });

  it("processo de Lazarios nunca é consultado no sync de Koppetel", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    seedKnownCase(memory, "entity-0");
    const inner = createMemoryExposureRepository(memory);
    const datajudCalls: string[] = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async () => emptyBatch("DJEN", { outcome: "NO_RESULTS", externalCall: true }),
        datajud: async (input) => {
          datajudCalls.push(input?.processNumber ?? "");
          return emptyBatch("DATAJUD", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-1" }, USER);
    assert.equal(datajudCalls.includes(PROCESS), false);
    assert.equal(inner.snapshot().cases.filter((row) => row.entityId === "entity-1").length, 0);
    assert.equal(inner.snapshot().cases[0]?.entityId, "entity-0");
  });

  it("CNJ descoberto só no alias A2 fica só na Lazarios", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    memory.aliases.push(
      {
        id: "a1",
        entityId: "entity-0",
        type: "TRADE_NAME",
        value: "Lazarios",
        normalizedValue: "LAZARIOS",
        active: true,
        createdAt: "2026-09-30T12:00:00.000Z",
      },
      {
        id: "a2",
        entityId: "entity-0",
        type: "OLD_LEGAL_NAME",
        value: "Lazarios Plasticos",
        normalizedValue: "LAZARIOS PLASTICOS",
        active: true,
        createdAt: "2026-09-30T12:00:00.000Z",
      },
      {
        id: "b1",
        entityId: "entity-1",
        type: "TRADE_NAME",
        value: "Koppetel",
        normalizedValue: "KOPPETEL",
        active: true,
        createdAt: "2026-09-30T12:00:00.000Z",
      }
    );
    const inner = createMemoryExposureRepository(memory);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T15:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async (input) => {
          if (input?.nomeParte === "Lazarios Plasticos") {
            return emptyBatch("DJEN", {
              outcome: "SUCCESS",
              externalCall: true,
              cases: [observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" })],
            });
          }
          return emptyBatch("DJEN", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    await service.sync({ mode: "apply", source: "DJEN" }, USER);
    const snapshot = inner.snapshot();
    assert.equal(snapshot.cases.length, 1);
    assert.equal(snapshot.cases[0]?.entityId, "entity-0");
    assert.equal(snapshot.cases.filter((row) => row.entityId === "entity-1").length, 0);
    assert.equal(snapshot.cases.filter((row) => row.entityId === "entity-2").length, 0);
  });

  it("RATE_LIMITED DJEN não apaga cases nem vira NO_RESULTS", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    seedKnownCase(memory, "entity-0");
    const inner = createMemoryExposureRepository(memory);
    let datajudCalls = 0;
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async () =>
          emptyBatch("DJEN", {
            outcome: "RATE_LIMITED",
            errorCode: "RATE_LIMITED",
            errorMessageSanitized: "Fonte limitou a taxa de consultas.",
            externalCall: true,
          }),
        datajud: async () => {
          datajudCalls += 1;
          return emptyBatch("DATAJUD", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    const result = await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    assert.equal(inner.snapshot().cases.length, 1);
    assert.equal(result.batches.some((batch) => batch.outcome === "RATE_LIMITED" || batch.outcome === "PARTIAL"), true);
    assert.equal(result.batches.some((batch) => batch.source === "DJEN" && batch.outcome === "NO_RESULTS"), false);
    assert.equal(datajudCalls, 1);
  });

  it("NO_RESULTS preserva cases", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    seedKnownCase(memory, "entity-0");
    const inner = createMemoryExposureRepository(memory);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async () => emptyBatch("DJEN", { outcome: "NO_RESULTS", externalCall: true }),
      },
    });
    await service.sync({ mode: "apply", source: "DJEN", entityId: "entity-0" }, USER);
    assert.equal(inner.snapshot().cases.length, 1);
  });

  it("ABBREVIATION genérico não autoassocia sem evidência extra", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    memory.aliases.push({
      id: "sm",
      entityId: "entity-2",
      type: "ABBREVIATION",
      value: "SM",
      normalizedValue: "SM",
      active: true,
      createdAt: "2026-09-30T12:00:00.000Z",
    });
    const inner = createMemoryExposureRepository(memory);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T15:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async (input) => {
          if (input?.nomeParte === "SM") {
            return emptyBatch("DJEN", {
              outcome: "SUCCESS",
              externalCall: true,
              cases: [
                observation({
                  processNumber: PROCESS,
                  sourceIdentifier: PROCESS,
                  tribunal: "TRT9",
                  candidateName: "Empresa Qualquer LTDA",
                }),
              ],
            });
          }
          return emptyBatch("DJEN", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    await service.sync({ mode: "apply", source: "DJEN", entityId: "entity-2" }, USER);
    assert.equal(inner.snapshot().cases.length, 0);
    assert.equal(inner.snapshot().alerts.some((row) => row.title.includes("revisão")), true);
  });

  it("G1/G2 continuam 1 case e 2 evidências", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T15:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async () =>
          emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" })],
          }),
        datajud: async () =>
          emptyBatch("DATAJUD", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [
              observation({ processNumber: PROCESS, sourceIdentifier: G1, officialIdentifier: G1, rawMetadata: { id: G1 } }),
              observation({ processNumber: PROCESS, sourceIdentifier: G2, officialIdentifier: G2, rawMetadata: { id: G2 } }),
            ],
          }),
      },
    });
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    const snapshot = inner.snapshot();
    assert.equal(snapshot.cases.length, 1);
    assert.equal(snapshot.evidences.filter((row) => row.source === "DATAJUD").length, 2);
  });

  it("alias CRUD cria, lista, atualiza, desativa e bloqueia duplicata", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T15:00:00.000Z"),
    });
    const created = await service.createAlias("entity-0", { value: "Lazarios Plasticos", type: "OLD_LEGAL_NAME" }, USER);
    const listed = await service.listAliases("entity-0");
    assert.equal(listed.some((row) => row.id === created.id && row.active), true);
    const updated = await service.updateAlias(created.id, { value: "Lazarios Comércio" }, USER);
    assert.equal(updated.value, "Lazarios Comércio");
    const disabled = await service.updateAlias(created.id, { active: false }, USER);
    assert.equal(disabled.active, false);
    const auditOps = inner.snapshot().audits.map((row) => (row.metadata as { operation?: string }).operation);
    assert.equal(auditOps.includes("ALIAS_CREATED"), true);
    assert.equal(auditOps.includes("ALIAS_UPDATED"), true);
    assert.equal(auditOps.includes("ALIAS_DISABLED"), true);
    await service.createAlias("entity-0", { value: "Lazarios Norte", type: "OTHER" }, USER);
    await assert.rejects(
      () => service.createAlias("entity-0", { value: "lazarios norte", type: "ABBREVIATION" }, USER),
      /já cadastrado/
    );
  });

  it("scheduled sync aceita userId null e recusa string não-UUID", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T15:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async () => emptyBatch("DJEN", { outcome: "NO_RESULTS", externalCall: true }),
      },
    });
    await service.sync({ mode: "preview", source: "DJEN", entityId: "entity-0", trigger: "SCHEDULED" }, null);
    assert.equal(inner.snapshot().audits.at(-1)?.userId, null);
    await service.sync(
      { mode: "preview", source: "DJEN", entityId: "entity-0", trigger: "SCHEDULED" },
      "system-legal-exposure-initial-apply"
    );
    assert.equal(inner.snapshot().audits.at(-1)?.userId, null);
    assert.equal((inner.snapshot().audits.at(-1)?.metadata as { trigger?: string }).trigger, "SCHEDULED");
  });

  it("CLI default preview não altera cases/evidences", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async () =>
          emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" })],
          }),
      },
    });
    const parsed = parseLegalExposureSyncArgs([]);
    assert.equal(parsed.mode, "preview");
    await service.sync({ mode: parsed.mode, source: parsed.source, trigger: "SCHEDULED" }, null);
    assert.equal(inner.snapshot().cases.length, 0);
    assert.equal(inner.snapshot().evidences.length, 0);
  });

  it("CLI apply global exige LEGAL_EXPOSURE_AUTOSYNC_ENABLED=1", () => {
    const parsed = parseLegalExposureSyncArgs(["--mode=apply"]);
    const blocked = legalExposureAutosyncApplyAllowed(parsed, {});
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.exitCode, 2);
      assert.equal(blocked.message, LEGAL_EXPOSURE_AUTOSYNC_OFF_MESSAGE);
    }
    const allowed = legalExposureAutosyncApplyAllowed(parsed, { LEGAL_EXPOSURE_AUTOSYNC_ENABLED: "1" });
    assert.equal(allowed.ok, true);
    const entityApply = legalExposureAutosyncApplyAllowed(
      parseLegalExposureSyncArgs(["--mode=apply", "--entity=entity-0"]),
      {}
    );
    assert.equal(entityApply.ok, true);
  });

  it("script CLI não grava userId fake e o testConnection DJEN não consulta vazio", async () => {
    const src = readFileSync(join(process.cwd(), "scripts/legalExposureSync.ts"), "utf8");
    assert.equal(src.includes('"cli"'), false);
    assert.equal(src.includes("system-legal-exposure"), false);
    assert.match(src, /null/);
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const djenCalls: Array<{ nomeParte?: string }> = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async (input) => {
          djenCalls.push(input ?? {});
          return emptyBatch("DJEN", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    const tested = await service.testConnection("DJEN");
    assert.equal(djenCalls.length, 1);
    assert.equal(djenCalls[0]?.nomeParte, FINANCE_INTERNAL_GROUP_COMPANIES[0]?.name);
    assert.equal(tested.connectivityTest, "RUN");
    const datajud = await service.testConnection("DATAJUD");
    assert.equal(datajud.connectivityTest, "NOT_RUN_NO_KNOWN_PROCESS");
    assert.equal(datajud.success, true);
    assert.equal(datajud.externalCall, false);
  });
});
