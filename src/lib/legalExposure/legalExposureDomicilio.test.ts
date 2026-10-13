/**
 * Domicílio Judicial Eletrônico, multiempresa. Sem rede: o CNJ é um fetch falso
 * que segue o contrato oficial (token → /api/v1/eu → /api/v1/comunicacoes paginado).
 * Credenciais, tokens e CPFs são fictícios.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import { applyBatchToMemory } from "./legalExposureApply.js";
import { normalizeCommunicationStatus, type NormalizedSourceBatch } from "./legalExposureContracts.js";
import { buildExposureProcessDossier, listCanonicalCases } from "./legalExposureExecutive.js";
import { domicilioConfigured, publicSourceConfiguration } from "./legalExposureFeatureFlags.js";
import { createMemoryExposureRepository } from "./legalExposureRepository.server.js";
import { createLegalExposureService, type DomicilioRunnerInput } from "./legalExposureService.server.js";
import { buildDomicilioCompanyStates } from "./legalExposureSourceOperations.js";
import { sourceReadinessOf } from "./legalExposureSourceSchedule.js";
import { createEmptyExposureMemory, type LegalExposureMemory } from "./legalExposureStore.js";
import {
  isAllowedDomicilioUrl,
  loadDomicilioAccounts,
  publicDomicilioAccounts,
} from "./sources/domicilio/domicilioAccounts.js";
import { clearDomicilioTokenCacheForTests } from "./sources/domicilio/domicilioAuth.server.js";
import { DOMICILIO_ALLOWED_OPERATIONS, domicilioSyncWindows } from "./sources/domicilio/domicilioContracts.js";
import {
  assertDomicilioOperationAllowed,
  clearDomicilioThrottleForTests,
  DOMICILIO_FORBIDDEN_HOST,
  DOMICILIO_FORBIDDEN_OPERATION,
} from "./sources/domicilio/domicilioHttp.server.js";
import { mapDomicilioCommunicationPage } from "./sources/domicilio/domicilioMapper.js";
import { runDomicilioSync } from "./sources/domicilio/domicilioSyncRunner.server.js";

const LAZARIOS = FINANCE_INTERNAL_GROUP_COMPANIES[0]!;
const KOPPETEL = FINANCE_INTERNAL_GROUP_COMPANIES[1]!;
const BASE = "https://gateway.fixture.pje.jus.br/domicilio";
const TOKEN_URL = "https://sso.fixture.pje.jus.br/auth/token";
const TENANT = { LAZARIOS: "11111111-1111-4111-8111-111111111111", KOPPETEL: "22222222-2222-4222-8222-222222222222" };
const NOW = new Date("2026-10-13T12:00:00.000Z");
const USER = "00000000-0000-4000-8000-000000000099";
const PROCESS_A = "00002860620215090021";
const PROCESS_SHARED = "00011112220235090003";
const PROCESS_NEW = "00099998820245090004";

/** CNPJ válido de outro estabelecimento da mesma raiz (filial), com dígitos verificadores calculados. */
function branchCnpj(cnpj: string, branch: string): string {
  const base = `${cnpj.slice(0, 8)}${branch}`;
  const digit = (value: string) => {
    const weights = value.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = [...value].reduce((total, char, index) => total + Number(char) * weights[index]!, 0);
    const rest = sum % 11;
    return rest < 2 ? "0" : String(11 - rest);
  };
  const first = digit(base);
  return `${base}${first}${digit(base + first)}`;
}

const LAZARIOS_BRANCH = branchCnpj(FINANCE_INTERNAL_GROUP_COMPANIES[0]!.cnpj, "0002");

const ENV = {
  LEGAL_EXPOSURE_ENABLED: "1",
  PDPJ_DOMICILIO_ENABLED: "1",
  PDPJ_DOMICILIO_BASE_URL: BASE,
  PDPJ_DOMICILIO_TOKEN_URL: TOKEN_URL,
  PDPJ_DOMICILIO_ACCOUNTS: "LAZARIOS,KOPPETEL",
  PDPJ_DOMICILIO_LAZARIOS_CNPJ: LAZARIOS.cnpj,
  PDPJ_DOMICILIO_LAZARIOS_CLIENT_ID: "client-lazarios",
  PDPJ_DOMICILIO_LAZARIOS_CLIENT_SECRET: "segredo-lazarios-ficticio",
  PDPJ_DOMICILIO_LAZARIOS_ON_BEHALF_OF_CPF: "11144477735",
  PDPJ_DOMICILIO_KOPPETEL_CNPJ: KOPPETEL.cnpj,
  PDPJ_DOMICILIO_KOPPETEL_CLIENT_ID: "client-koppetel",
  PDPJ_DOMICILIO_KOPPETEL_CLIENT_SECRET: "segredo-koppetel-ficticio",
  PDPJ_DOMICILIO_KOPPETEL_ON_BEHALF_OF_CPF: "52998224725",
};

type Communication = Record<string, unknown> & {
  numeroComunicacao: string;
  numeroProcesso: string;
  documentoDestinatario: string;
  dataComunicacao: string;
  status: string;
};

function communication(partial: Partial<Communication> & Pick<Communication, "numeroComunicacao">): Communication {
  return {
    numeroProcesso: PROCESS_A,
    documentoDestinatario: LAZARIOS.cnpj,
    nomeDestinatario: LAZARIOS.name,
    tipoComunicacao: "INTIMACAO",
    assunto: "Reclamação trabalhista",
    tribunalOrigem: "TRT9",
    varaJudicial: "1ª Vara do Trabalho",
    classe: "Ação Trabalhista",
    dataComunicacao: "2026-10-12T10:00:00.000Z",
    dataFinalCiencia: "2026-10-22T10:00:00.000Z",
    status: "EM_CURSO",
    valorCausa: "999999.99",
    parteInteressada: "REU",
    servidor: { nome: "Servidor Fictício", cpf: "39053344705" },
    linksDocumentos: ["https://gateway.fixture.pje.jus.br/teor/abc"],
    ...partial,
  };
}

type FakeCnj = {
  fetchImpl: typeof fetch;
  requests: Array<{ method: string; url: URL; headers: Record<string, string>; account: string | null }>;
  data: Record<"LAZARIOS" | "KOPPETEL", Communication[]>;
  behavior: {
    rejectSecretOf?: "LAZARIOS" | "KOPPETEL";
    failListOf?: { account: "LAZARIOS" | "KOPPETEL"; status: number; fromPage?: number; retryAfter?: string };
    expireFirstTokenOf?: "LAZARIOS" | "KOPPETEL";
    timeoutListOf?: "LAZARIOS" | "KOPPETEL";
    invalidBodyOf?: "LAZARIOS" | "KOPPETEL";
    pageSize?: number;
    onList?: (account: "LAZARIOS" | "KOPPETEL") => Promise<void> | void;
    /** Perfis extras devolvidos em /api/v1/eu (ex.: a filial vinculada ao mesmo tenant). */
    extraProfilesOf?: { account: "LAZARIOS" | "KOPPETEL"; profiles: Array<{ tenantId: string; documento: string; tenantName: string }> };
  };
  tokensIssued: Record<string, number>;
};

function createFakeCnj(): FakeCnj {
  const state: FakeCnj = {
    fetchImpl: undefined as unknown as typeof fetch,
    requests: [],
    data: { LAZARIOS: [], KOPPETEL: [] },
    behavior: {},
    tokensIssued: {},
  };
  const accountOfToken = new Map<string, "LAZARIOS" | "KOPPETEL">();
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  state.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value])
    );
    assert.equal(init?.redirect, "error", "toda chamada recusa redirecionamento");

    if (url.href === TOKEN_URL) {
      const body = init?.body as URLSearchParams;
      const account = body.get("client_id") === "client-lazarios" ? "LAZARIOS" : "KOPPETEL";
      state.requests.push({ method, url, headers, account });
      if (state.behavior.rejectSecretOf === account) return json({ error: "invalid_client" }, 401);
      state.tokensIssued[account] = (state.tokensIssued[account] ?? 0) + 1;
      const token = `tok-${account}-${state.tokensIssued[account]}`;
      accountOfToken.set(token, account);
      return json({ access_token: token, expires_in: 300 });
    }

    const token = (headers.authorization ?? "").replace(/^Bearer /, "");
    const account = accountOfToken.get(token) ?? null;
    state.requests.push({ method, url, headers, account });
    if (!account) return json({}, 401);
    if (state.behavior.expireFirstTokenOf === account && token.endsWith("-1")) return json({}, 401);

    if (url.pathname.endsWith("/api/v1/eu")) {
      const company = account === "LAZARIOS" ? LAZARIOS : KOPPETEL;
      return json({
        pessoa: { cpfCnpj: headers["on-behalf-of"] },
        perfis: [
          { tenantId: TENANT[account], documento: company.cnpj, tenantName: company.name },
          ...(state.behavior.extraProfilesOf?.account === account ? state.behavior.extraProfilesOf.profiles : []),
        ],
      });
    }

    if (url.pathname.endsWith("/api/v1/comunicacoes")) {
      assert.equal(headers.tenantid, TENANT[account], "tenant da própria conta");
      assert.equal(url.searchParams.get("statusCiente"), "A");
      await state.behavior.onList?.(account);
      if (state.behavior.timeoutListOf === account) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      const page = Number(url.searchParams.get("page") ?? "0");
      const fail = state.behavior.failListOf;
      if (fail && fail.account === account && page >= (fail.fromPage ?? 0)) {
        return json({}, fail.status, fail.retryAfter ? { "retry-after": fail.retryAfter } : {});
      }
      if (state.behavior.invalidBodyOf === account) return json({ inesperado: true });
      const numeroProcesso = url.searchParams.get("numeroProcesso");
      const from = Date.parse(url.searchParams.get("dataInicio") ?? "");
      const to = Date.parse(url.searchParams.get("dataFim") ?? "");
      if (!numeroProcesso) {
        assert.ok(Number.isFinite(from) && Number.isFinite(to), "período obrigatório");
        assert.ok(to - from <= 7 * 24 * 60 * 60 * 1000, "janela de até 7 dias");
      }
      const matching = state.data[account].filter((row) =>
        numeroProcesso
          ? row.numeroProcesso === numeroProcesso
          : Date.parse(row.dataComunicacao) >= from && Date.parse(row.dataComunicacao) <= to
      );
      const size = state.behavior.pageSize ?? Number(url.searchParams.get("size") ?? "20");
      return json({
        page: { count: matching.length, pageNumber: page, pageSize: size, totalPages: Math.ceil(matching.length / size) },
        data: matching.slice(page * size, page * size + size),
      });
    }
    return json({}, 404);
  }) as typeof fetch;
  return state;
}

function seedMemory(): LegalExposureMemory {
  const memory = createEmptyExposureMemory();
  const timestamp = "2026-10-01T12:00:00.000Z";
  [LAZARIOS, KOPPETEL].forEach((company, index) => {
    memory.entities.push({
      id: index === 0 ? "entity-lazarios" : "entity-koppetel",
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
  return memory;
}

/** Processo já conhecido pelo DataJud, com valor e polo homologados. */
function seedDatajudCase(memory: LegalExposureMemory, entityId: string, processNumber: string): void {
  applyBatchToMemory(memory, {
    entityId,
    now: "2026-10-02T12:00:00.000Z",
    createId: sequentialIds("seed"),
    batch: {
      source: "DATAJUD",
      outcome: "SUCCESS",
      errorCode: null,
      errorMessageSanitized: null,
      retryAfterSeconds: null,
      externalCall: true,
      communications: [],
      candidates: [],
      cases: [
        {
          processNumber,
          tribunal: "TRT9",
          jurisdiction: null,
          degree: "G1",
          courtUnit: "1ª Vara do Trabalho de Curitiba",
          classCode: "985",
          className: "Ação Trabalhista - Rito Ordinário",
          filedAt: "2021-03-01T00:00:00.000Z",
          currentStatus: "Em andamento",
          entityPole: "PASSIVE",
          sourceIdentifier: `datajud-${processNumber}`,
          sourceUpdatedAt: null,
          explicitCnpj: memory.entities.find((row) => row.id === entityId)!.cnpj,
          candidateName: null,
          officialIdentifier: null,
          parties: [],
          movements: [],
          claimValue: "50000.00",
          claimCurrency: "BRL",
          rawMetadata: {},
        },
      ],
    },
  });
}

function sequentialIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(6, "0")}`;
}

function emptyBatch(source: NormalizedSourceBatch["source"]): NormalizedSourceBatch {
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
  };
}

function createService(memory: LegalExposureMemory, cnj: FakeCnj, env: Record<string, string> = ENV, now = NOW) {
  const repository = createMemoryExposureRepository(memory);
  const runs: Array<{ target: string; status: string; summary: unknown }> = [];
  const domicilioInputs: DomicilioRunnerInput[] = [];
  const service = createLegalExposureService({
    repository,
    createId: sequentialIds(),
    now: () => now,
    recordIntegrationRun: async (input) => {
      runs.push({ target: input.target, status: input.status, summary: input.summary });
    },
    runners: {
      domicilio: async (input) => {
        if (input) domicilioInputs.push(input);
        return runDomicilioSync({ ...(input ?? {}), env, fetchImpl: cnj.fetchImpl, now, sleep: async () => {} });
      },
      datajud: async () => emptyBatch("DATAJUD"),
      djen: async () => emptyBatch("DJEN"),
    },
  });
  return { service, repository, runs, domicilioInputs };
}

beforeEach(() => {
  clearDomicilioTokenCacheForTests();
  clearDomicilioThrottleForTests();
});

describe("domicílio — contas e configuração", () => {
  it("feature flag desligada: nenhuma chamada, mesmo com credenciais presentes", async () => {
    const cnj = createFakeCnj();
    const batch = await runDomicilioSync({
      env: { ...ENV, PDPJ_DOMICILIO_ENABLED: "0" },
      fetchImpl: cnj.fetchImpl,
      entity: { cnpj: LAZARIOS.cnpj },
    });
    assert.equal(batch.externalCall, false);
    assert.equal(batch.outcome, "CONFIGURATION_ERROR");
    assert.equal(cnj.requests.length, 0);
  });

  it("sem configuração ou sem conta para o CNPJ: nenhuma chamada", async () => {
    const cnj = createFakeCnj();
    const noEnv = await runDomicilioSync({ env: {}, fetchImpl: cnj.fetchImpl, entity: { cnpj: LAZARIOS.cnpj } });
    const onlyLazarios = { ...ENV, PDPJ_DOMICILIO_ACCOUNTS: "LAZARIOS" };
    const noAccount = await runDomicilioSync({ env: onlyLazarios, fetchImpl: cnj.fetchImpl, entity: { cnpj: KOPPETEL.cnpj } });
    const noEntity = await runDomicilioSync({ env: ENV, fetchImpl: cnj.fetchImpl });
    for (const batch of [noEnv, noAccount, noEntity]) {
      assert.equal(batch.externalCall, false);
      assert.equal(batch.outcome, "CONFIGURATION_ERROR");
    }
    assert.equal(cnj.requests.length, 0);
  });

  it("cada conta é lida das próprias variáveis; conta incompleta ou CNPJ duplicado não entra", () => {
    const { accounts, problems } = loadDomicilioAccounts(ENV);
    assert.deepEqual(accounts.map((row) => [row.key, row.cnpj]), [
      ["LAZARIOS", LAZARIOS.cnpj],
      ["KOPPETEL", KOPPETEL.cnpj],
    ]);
    assert.notEqual(accounts[0]!.clientSecret, accounts[1]!.clientSecret);
    assert.equal(problems.length, 0);

    const broken = loadDomicilioAccounts({
      ...ENV,
      PDPJ_DOMICILIO_KOPPETEL_CLIENT_SECRET: "",
      PDPJ_DOMICILIO_ACCOUNTS: "LAZARIOS,KOPPETEL,DUPLICADA",
      PDPJ_DOMICILIO_DUPLICADA_CNPJ: LAZARIOS.cnpj,
      PDPJ_DOMICILIO_DUPLICADA_CLIENT_ID: "x",
      PDPJ_DOMICILIO_DUPLICADA_CLIENT_SECRET: "y",
      PDPJ_DOMICILIO_DUPLICADA_ON_BEHALF_OF_CPF: "11144477735",
    });
    assert.deepEqual(broken.accounts.map((row) => row.key), ["LAZARIOS"]);
    assert.deepEqual(broken.problems.map((row) => row.key), ["KOPPETEL", "DUPLICADA"]);
    assert.deepEqual(broken.problems[0]!.missing, ["PDPJ_DOMICILIO_KOPPETEL_CLIENT_SECRET"]);
  });

  it("endereço fora dos domínios oficiais ou sem https é recusado (SSRF)", async () => {
    for (const url of ["http://gateway.stg.cloud.pje.jus.br/x", "https://evil.example.com/x", "https://pje.jus.br.evil.com/x", "https://user:pw@gateway.cloud.pje.jus.br/x", "nada"]) {
      assert.equal(isAllowedDomicilioUrl(url), false, url);
    }
    assert.equal(isAllowedDomicilioUrl("https://gateway.stg.cloud.pje.jus.br/domicilio-eletronico-hml"), true);
    const cnj = createFakeCnj();
    const env = { ...ENV, PDPJ_DOMICILIO_BASE_URL: "https://evil.example.com/domicilio" };
    assert.equal(domicilioConfigured(env), false);
    const batch = await runDomicilioSync({ env, fetchImpl: cnj.fetchImpl, entity: { cnpj: LAZARIOS.cnpj } });
    assert.equal(batch.externalCall, false);
    assert.equal(cnj.requests.length, 0);
  });

  it("configuração pública e prontidão informam presença, nunca valores", () => {
    const serialized = JSON.stringify([
      publicSourceConfiguration(ENV),
      publicDomicilioAccounts(ENV),
      sourceReadinessOf("DOMICILIO", ENV),
      sourceReadinessOf("DOMICILIO", { ...ENV, PDPJ_DOMICILIO_KOPPETEL_CLIENT_SECRET: "" }),
    ]);
    for (const secret of ["segredo-lazarios-ficticio", "segredo-koppetel-ficticio", "client-lazarios", "11144477735", "52998224725"]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
    assert.equal(sourceReadinessOf("DOMICILIO", ENV).readiness, "READY");
    assert.deepEqual(
      sourceReadinessOf("DOMICILIO", { ...ENV, PDPJ_DOMICILIO_ENABLED: "0" }).readiness,
      "DISABLED_BY_POLICY"
    );
  });
});

describe("domicílio — proibição de ciência e operações permitidas", () => {
  it("só token, identificação e listagem existem; inteiro teor e qualquer outro caminho são recusados antes do fetch", () => {
    assert.deepEqual(DOMICILIO_ALLOWED_OPERATIONS.map((row) => `${row.method} ${row.path ?? "<token>"}`), [
      "POST <token>",
      "GET /api/v1/eu",
      "GET /api/v1/comunicacoes",
    ]);
    const base = { tokenUrl: TOKEN_URL, baseUrl: BASE };
    assert.doesNotThrow(() =>
      assertDomicilioOperationAllowed({ ...base, operation: "listCommunications", method: "GET", url: `${BASE}/api/v1/comunicacoes?page=0` })
    );
    const forbidden: Array<[string, string]> = [
      ["PUT", `${BASE}/api/v1/comunicacoes`],
      ["GET", `${BASE}/api/v1/processos/${PROCESS_A}/comunicacoes/abc`],
      ["GET", `${BASE}/api/v1/comunicacoes/abc`],
      ["GET", `${BASE}/api/v1/processo/${PROCESS_A}/comunicacao/abc/ticket`],
      ["POST", `${BASE}/api/v1/comunicacoes`],
    ];
    for (const [method, url] of forbidden) {
      assert.throws(
        () => assertDomicilioOperationAllowed({ ...base, operation: "listCommunications", method, url }),
        new RegExp(DOMICILIO_FORBIDDEN_OPERATION),
        `${method} ${url}`
      );
    }
    assert.throws(
      () => assertDomicilioOperationAllowed({ ...base, operation: "listCommunications", method: "GET", url: "https://evil.example.com/api/v1/comunicacoes" }),
      new RegExp(DOMICILIO_FORBIDDEN_HOST)
    );
  });

  it("o adaptador não tem PUT/PATCH/DELETE nem segue link devolvido no payload", async () => {
    const dir = join(process.cwd(), "src/lib/legalExposure/sources/domicilio");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
      const text = readFileSync(join(dir, file), "utf8");
      assert.equal(/method:\s*"(PUT|PATCH|DELETE)"/.test(text), false, file);
    }
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1" }));
    const batch = await runDomicilioSync({ env: ENV, fetchImpl: cnj.fetchImpl, now: NOW, entity: { cnpj: LAZARIOS.cnpj }, sleep: async () => {} });
    assert.equal(batch.outcome, "SUCCESS");
    assert.equal(cnj.requests.every((row) => row.method === "GET" || row.url.href === TOKEN_URL), true);
    assert.equal(cnj.requests.some((row) => row.url.pathname.includes("/teor/")), false);
    // O link do teor não é guardado: abrir o documento é o que gera ciência.
    const serialized = JSON.stringify(batch);
    assert.equal(serialized.includes("/teor/abc"), false);
    assert.equal(batch.communications[0]!.officialLink ?? null, null);
    assert.equal((batch.communications[0]!.rawMetadata as { documentosDisponiveis: number }).documentosDisponiveis, 1);
  });
});

describe("domicílio — mapper do contrato oficial", () => {
  it("normaliza campos, situação oficial e descarta destinatário de outra empresa", () => {
    const mapped = mapDomicilioCommunicationPage(
      {
        page: { count: 4, pageNumber: 0, pageSize: 50, totalPages: 1 },
        data: [
          communication({ numeroComunicacao: "c-1", status: "CIENTE", dataCiente: "2026-10-12T15:00:00.000Z" }),
          communication({ numeroComunicacao: "c-2", documentoDestinatario: KOPPETEL.cnpj }),
          communication({ numeroComunicacao: "c-3", documentoDestinatario: LAZARIOS_BRANCH }),
          { numeroProcesso: PROCESS_A },
        ],
      },
      { accountCnpj: LAZARIOS.cnpj, tenantId: TENANT.LAZARIOS }
    );
    // Filial (mesma raiz) e outra empresa são recusadas; só o CNPJ completo da conta entra.
    assert.deepEqual(mapped.communications.map((row) => row.sourceCommunicationId), ["c-1"]);
    assert.equal(mapped.rejectedRecipient, 2);
    assert.equal(mapped.invalid, 1);
    const first = mapped.communications[0]!;
    assert.equal(first.tenantId, TENANT.LAZARIOS);
    assert.equal(first.sourceStatus, "CIENTE");
    assert.equal(first.sourceScienceAt, "2026-10-12T15:00:00.000Z");
    assert.equal(first.scienceDeadlineAt, "2026-10-22T10:00:00.000Z");
    assert.equal(first.tribunal, "TRT9");
    // Sem CPF de servidor, sem valor da causa e sem polo: esses dados não vêm desta fonte.
    const serialized = JSON.stringify(mapped);
    assert.equal(serialized.includes("39053344705"), false);
    assert.equal(serialized.includes("999999.99"), false);
    assert.equal(mapped.cases.length, 1);
    assert.equal(mapped.cases[0]!.entityPole, "UNKNOWN");
    assert.equal(mapped.cases[0]!.claimValue ?? null, null);
    assert.equal(mapped.cases[0]!.explicitCnpj, LAZARIOS.cnpj);
  });

  it("situações oficiais do Domicílio viram a situação normalizada do Exposure", () => {
    assert.equal(normalizeCommunicationStatus("EM_CURSO"), "PENDING");
    assert.equal(normalizeCommunicationStatus("CIENTE"), "ACKNOWLEDGED");
    assert.equal(normalizeCommunicationStatus("CIENCIA_AUTOMATICA"), "ACKNOWLEDGED");
    assert.equal(normalizeCommunicationStatus("INTEIRO_TEOR_OBTIDO"), "ACKNOWLEDGED");
    assert.equal(normalizeCommunicationStatus("CANCELADA"), "CANCELED");
    assert.equal(normalizeCommunicationStatus("QUALQUER_OUTRA"), "UNKNOWN");
  });

  it("corpo fora do contrato não vira lista vazia", () => {
    const mapped = mapDomicilioCommunicationPage({ content: [] }, { accountCnpj: LAZARIOS.cnpj, tenantId: "t" });
    assert.equal(mapped.page, null);
  });

  it("janelas de até 7 dias: carga inicial pelo backfill, depois checkpoint com sobreposição de 2 dias", () => {
    const initial = domicilioSyncWindows({ now: NOW, checkpoint: null, backfillDays: 30 });
    assert.equal(initial.length, 5);
    assert.equal(initial[0]!.dataInicio, "2026-09-13T12:00:00.000Z");
    assert.equal(initial.at(-1)!.dataFim, NOW.toISOString());
    for (const window of initial) {
      assert.ok(Date.parse(window.dataFim) - Date.parse(window.dataInicio) <= 7 * 24 * 60 * 60 * 1000);
    }
    const incremental = domicilioSyncWindows({ now: NOW, checkpoint: "2026-10-13T11:00:00.000Z", backfillDays: 30 });
    assert.deepEqual(incremental, [{ dataInicio: "2026-10-11T11:00:00.000Z", dataFim: NOW.toISOString() }]);
  });
});

describe("domicílio — autenticação e HTTP por conta", () => {
  it("token é isolado por conta, reaproveitado e renovado uma vez quando a API o recusa", async () => {
    const cnj = createFakeCnj();
    cnj.behavior.expireFirstTokenOf = "LAZARIOS";
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1" }));
    const options = { env: ENV, fetchImpl: cnj.fetchImpl, now: NOW, sleep: async () => {} };
    const [lazarios, koppetel] = await Promise.all([
      runDomicilioSync({ ...options, entity: { cnpj: LAZARIOS.cnpj } }),
      runDomicilioSync({ ...options, entity: { cnpj: KOPPETEL.cnpj } }),
    ]);
    assert.equal(lazarios.outcome, "SUCCESS");
    assert.equal(koppetel.outcome, "NO_RESULTS");
    // Lazários: token 1 recusado → token 2. Koppetel: um único token para todas as páginas.
    assert.deepEqual(cnj.tokensIssued, { LAZARIOS: 2, KOPPETEL: 1 });
    for (const request of cnj.requests.filter((row) => row.url.href !== TOKEN_URL)) {
      const cpf = request.account === "LAZARIOS" ? "11144477735" : "52998224725";
      assert.equal(request.headers["on-behalf-of"], cpf, "On-behalf-Of da própria conta");
    }
  });

  it("credencial inválida: AUTH_ERROR sem listar e sem vazar o segredo", async () => {
    const cnj = createFakeCnj();
    cnj.behavior.rejectSecretOf = "KOPPETEL";
    const batch = await runDomicilioSync({ env: ENV, fetchImpl: cnj.fetchImpl, now: NOW, entity: { cnpj: KOPPETEL.cnpj }, sleep: async () => {} });
    assert.equal(batch.outcome, "AUTH_ERROR");
    assert.equal(batch.communications.length, 0);
    assert.equal(cnj.requests.some((row) => row.url.pathname.endsWith("/comunicacoes")), false);
    assert.equal(JSON.stringify(batch).includes("segredo-koppetel-ficticio"), false);
  });

  it("credencial de um CNPJ diferente do configurado não é usada para listar", async () => {
    const cnj = createFakeCnj();
    // A chave LAZARIOS aponta para o CNPJ da Koppetel: o perfil devolvido pelo CNJ não confere.
    const env = { ...ENV, PDPJ_DOMICILIO_ACCOUNTS: "LAZARIOS", PDPJ_DOMICILIO_LAZARIOS_CNPJ: KOPPETEL.cnpj };
    const batch = await runDomicilioSync({ env, fetchImpl: cnj.fetchImpl, now: NOW, entity: { cnpj: KOPPETEL.cnpj }, sleep: async () => {} });
    assert.equal(batch.outcome, "AUTH_ERROR");
    assert.equal(cnj.requests.some((row) => row.url.pathname.endsWith("/comunicacoes")), false);

    clearDomicilioTokenCacheForTests();
    const wrongTenant = { ...ENV, PDPJ_DOMICILIO_LAZARIOS_TENANT_ID: TENANT.KOPPETEL };
    const second = await runDomicilioSync({ env: wrongTenant, fetchImpl: cnj.fetchImpl, now: NOW, entity: { cnpj: LAZARIOS.cnpj }, sleep: async () => {} });
    assert.equal(second.outcome, "AUTH_ERROR");
  });

  it("timeout: novas tentativas limitadas com backoff, depois falha sem avançar nada", async () => {
    const cnj = createFakeCnj();
    cnj.behavior.timeoutListOf = "LAZARIOS";
    const waits: number[] = [];
    const batch = await runDomicilioSync({
      env: ENV,
      fetchImpl: cnj.fetchImpl,
      now: NOW,
      entity: { cnpj: LAZARIOS.cnpj },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    assert.equal(batch.outcome, "TIMEOUT");
    assert.equal(batch.coverage, undefined);
    assert.equal(cnj.requests.filter((row) => row.url.pathname.endsWith("/comunicacoes")).length, 3);
    // Houve espera (backoff) entre as tentativas, e nunca uma quarta chamada.
    assert.ok(waits.length >= 2);
  });

  it("rate limit com Retry-After longo devolve RATE_LIMITED sem insistir", async () => {
    const cnj = createFakeCnj();
    cnj.behavior.failListOf = { account: "LAZARIOS", status: 429, retryAfter: "120" };
    const batch = await runDomicilioSync({ env: ENV, fetchImpl: cnj.fetchImpl, now: NOW, entity: { cnpj: LAZARIOS.cnpj }, sleep: async () => {} });
    assert.equal(batch.outcome, "RATE_LIMITED");
    assert.equal(batch.retryAfterSeconds, 120);
    assert.equal(cnj.requests.filter((row) => row.url.pathname.endsWith("/comunicacoes")).length, 1);
  });

  it("payload inválido vira INVALID_RESPONSE, não 'sem comunicações'", async () => {
    const cnj = createFakeCnj();
    cnj.behavior.invalidBodyOf = "LAZARIOS";
    const batch = await runDomicilioSync({ env: ENV, fetchImpl: cnj.fetchImpl, now: NOW, entity: { cnpj: LAZARIOS.cnpj }, sleep: async () => {} });
    assert.equal(batch.outcome, "INVALID_RESPONSE");
    assert.equal(batch.coverage, undefined);
  });
});

describe("domicílio — coleta multiempresa pelo orquestrador do Exposure", () => {
  it("comunicação nova entra no processo existente da empresa certa, com proveniência e sem tocar valor/polo", async () => {
    const memory = seedMemory();
    seedDatajudCase(memory, "entity-lazarios", PROCESS_A);
    const before = structuredClone(memory.cases[0]!);
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1" }));
    const { service, repository } = createService(memory, cnj);

    const result = await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const snapshot = repository.snapshot();
    assert.equal(result.batches.filter((row) => row.source === "DOMICILIO").length, 2);
    assert.equal(snapshot.cases.length, 1, "não cria segundo processo");
    assert.equal(snapshot.communications.length, 1);
    const row = snapshot.communications[0]!;
    assert.equal(row.entityId, "entity-lazarios");
    assert.equal(row.caseId, snapshot.cases[0]!.id);
    assert.equal(row.source, "DOMICILIO");
    assert.equal(row.idempotencyKey, `DOMICILIO:${TENANT.LAZARIOS}:c-1`);
    assert.equal(row.normalizedStatus, "PENDING");
    assert.equal(row.officialContentOpenedAt, null);

    // Classificação e valores homologados permanecem como o DataJud deixou.
    const after = snapshot.cases[0]!;
    for (const field of ["claimValue", "claimCurrency", "entityPole", "currentStatus", "className", "classCode", "courtUnit", "tribunal", "degree", "filedAt", "primarySource"] as const) {
      assert.equal(after[field], before[field], field);
    }
    // Evidência do DataJud preservada e a do Domicílio acrescentada.
    assert.deepEqual(snapshot.evidences.map((evidence) => evidence.source).sort(), ["DATAJUD", "DOMICILIO"]);
    assert.equal(snapshot.entities.find((entity) => entity.id === "entity-lazarios")!.domicilioTenantId, TENANT.LAZARIOS);

    // Comunicação não é processo novo: a lista de processos continua com um só.
    assert.equal(listCanonicalCases(snapshot, {}).length, 1);
  });

  it("reprocessar o mesmo lote não duplica comunicação, evento nem alerta (idempotência)", async () => {
    const memory = seedMemory();
    seedDatajudCase(memory, "entity-lazarios", PROCESS_A);
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1" }), communication({ numeroComunicacao: "c-2", tipoComunicacao: "CITACAO" }));
    const { service, repository } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const first = repository.snapshot();
    const counts = (snapshot: LegalExposureMemory) => ({
      communications: snapshot.communications.length,
      events: snapshot.events.length,
      alerts: snapshot.alerts.length,
      evidences: snapshot.evidences.length,
      cases: snapshot.cases.length,
      links: snapshot.entityLinks.length,
    });
    const expected = counts(first);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    assert.deepEqual(counts(repository.snapshot()), expected);
    assert.equal(expected.communications, 2);
  });

  it("mudança oficial de situação atualiza a comunicação e registra histórico, preservando a detecção", async () => {
    const memory = seedMemory();
    seedDatajudCase(memory, "entity-lazarios", PROCESS_A);
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1" }));
    const { service, repository, domicilioInputs } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const detectedAt = repository.snapshot().communications[0]!.detectedAt;

    // A comunicação sai da janela de datas; a releitura por processo pendente capta a ciência.
    cnj.data.LAZARIOS[0] = communication({
      numeroComunicacao: "c-1",
      dataComunicacao: "2026-08-01T10:00:00.000Z",
      status: "CIENCIA_AUTOMATICA",
      dataCiente: "2026-10-13T09:00:00.000Z",
    });
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const snapshot = repository.snapshot();
    assert.deepEqual(domicilioInputs.at(-2)!.reconcileProcessNumbers, [PROCESS_A]);
    assert.equal(snapshot.communications.length, 1);
    const row = snapshot.communications[0]!;
    assert.equal(row.normalizedStatus, "ACKNOWLEDGED");
    assert.equal(row.sourceStatus, "CIENCIA_AUTOMATICA");
    assert.equal(row.sourceScienceAt, "2026-10-13T09:00:00.000Z");
    assert.equal(row.detectedAt, detectedAt);
    // A ciência veio do CNJ: nada no IndusCost a registrou.
    assert.equal(row.officialContentOpenedAt, null);
    assert.equal(row.officialContentOpenedByUserId, null);
    assert.deepEqual(
      snapshot.events.filter((event) => event.communicationId === row.id).map((event) => event.eventType),
      ["NEW_COMMUNICATION", "NEW_INTIMATION", "COMMUNICATION_ACKNOWLEDGED"]
    );
    const dossier = buildExposureProcessDossier(snapshot, snapshot.cases[0]!.id, NOW);
    const shown = dossier!.communications[0]!;
    assert.equal(shown.recipient!.legalName, LAZARIOS.name);
    assert.equal(shown.sourceScienceAt, "2026-10-13T09:00:00.000Z");
    assert.equal(shown.officialReference, "c-1");
    assert.equal(shown.history.length, 3);
  });

  it("evidência histórica não é apagada quando a fonte deixa de devolver a comunicação", async () => {
    const memory = seedMemory();
    seedDatajudCase(memory, "entity-lazarios", PROCESS_A);
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1" }));
    const { service, repository } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    cnj.data.LAZARIOS = [];
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const snapshot = repository.snapshot();
    assert.equal(snapshot.communications.length, 1);
    assert.equal(snapshot.evidences.filter((row) => row.source === "DOMICILIO").length, 1);
  });

  it("processo desconhecido segue a descoberta existente; sem número CNJ válido fica pendente de conciliação", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(
      communication({ numeroComunicacao: "c-novo", numeroProcesso: PROCESS_NEW }),
      communication({ numeroComunicacao: "c-sem-processo", numeroProcesso: "sem-numero" })
    );
    const { service, repository, runs } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const snapshot = repository.snapshot();
    assert.equal(snapshot.cases.length, 1);
    const created = snapshot.cases[0]!;
    assert.equal(created.processNumberNormalized, PROCESS_NEW);
    assert.equal(created.entityId, "entity-lazarios");
    assert.equal(created.primarySource, "DOMICILIO");
    assert.equal(created.claimValue, null);
    assert.equal(created.entityPole, "UNKNOWN");
    assert.equal(snapshot.events.filter((row) => row.eventType === "NEW_CASE").length, 1);
    const byId = new Map(snapshot.communications.map((row) => [row.sourceCommunicationId, row]));
    assert.equal(byId.get("c-novo")!.caseId, created.id);
    assert.equal(byId.get("c-sem-processo")!.caseId, null);
    const summary = runs.find((row) => row.target === "LEGAL_EXPOSURE_DOMICILIO")!.summary as {
      domicilioEntities: Array<{ entityId: string; pendingReconciliation: number; newCommunications: number }>;
    };
    const lazarios = summary.domicilioEntities.find((row) => row.entityId === "entity-lazarios")!;
    assert.equal(lazarios.pendingReconciliation, 1);
    assert.equal(lazarios.newCommunications, 2);
  });

  it("processo compartilhado: um processo lógico, vínculo das duas empresas e comunicações separadas por destinatária", async () => {
    const memory = seedMemory();
    seedDatajudCase(memory, "entity-lazarios", PROCESS_SHARED);
    const cnj = createFakeCnj();
    // O CNJ usa o mesmo número de comunicação nos dois tenants: a identidade inclui o tenant.
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-9", numeroProcesso: PROCESS_SHARED, status: "CIENTE", dataCiente: "2026-10-12T15:00:00.000Z" }));
    cnj.data.KOPPETEL.push(
      communication({ numeroComunicacao: "c-9", numeroProcesso: PROCESS_SHARED, documentoDestinatario: KOPPETEL.cnpj, nomeDestinatario: KOPPETEL.name })
    );
    const { service, repository } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const snapshot = repository.snapshot();
    assert.equal(snapshot.cases.length, 1);
    assert.equal(listCanonicalCases(snapshot, {}).length, 1);
    assert.deepEqual(snapshot.entityLinks.map((row) => row.entityId).sort(), ["entity-koppetel", "entity-lazarios"]);
    assert.equal(snapshot.communications.length, 2);
    const byEntity = new Map(snapshot.communications.map((row) => [row.entityId, row]));
    // Ciência de uma empresa não vale para a outra.
    assert.equal(byEntity.get("entity-lazarios")!.normalizedStatus, "ACKNOWLEDGED");
    assert.equal(byEntity.get("entity-koppetel")!.normalizedStatus, "PENDING");
    assert.notEqual(byEntity.get("entity-lazarios")!.idempotencyKey, byEntity.get("entity-koppetel")!.idempotencyKey);
    const dossier = buildExposureProcessDossier(snapshot, snapshot.cases[0]!.id, NOW);
    assert.deepEqual(dossier!.communications.map((row) => row.recipient!.legalName).sort(), [KOPPETEL.name, LAZARIOS.name].sort());
  });

  it("nenhum vazamento entre CNPJs: cada consulta usa o token e o tenant da própria conta", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "l-1", numeroProcesso: PROCESS_A }));
    cnj.data.KOPPETEL.push(
      communication({ numeroComunicacao: "k-1", numeroProcesso: PROCESS_NEW, documentoDestinatario: KOPPETEL.cnpj }),
      // Item que o CNJ devolveria por engano: destinatária é a outra empresa.
      communication({ numeroComunicacao: "k-vazado", numeroProcesso: PROCESS_A, documentoDestinatario: LAZARIOS.cnpj })
    );
    const { service, repository, runs } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const snapshot = repository.snapshot();
    assert.deepEqual(
      snapshot.communications.map((row) => [row.entityId, row.sourceCommunicationId]).sort(),
      [["entity-koppetel", "k-1"], ["entity-lazarios", "l-1"]]
    );
    for (const request of cnj.requests.filter((row) => row.url.pathname.endsWith("/comunicacoes"))) {
      assert.equal(request.headers.tenantid, TENANT[request.account as "LAZARIOS" | "KOPPETEL"]);
    }
    const summary = runs.find((row) => row.target === "LEGAL_EXPOSURE_DOMICILIO")!.summary as {
      domicilioEntities: Array<{ entityId: string; rejectedRecipient: number; account: string }>;
    };
    const koppetel = summary.domicilioEntities.find((row) => row.entityId === "entity-koppetel")!;
    assert.equal(koppetel.rejectedRecipient, 1);
    assert.equal(koppetel.account, "KOPPETEL");
    assert.equal(JSON.stringify(runs).includes("segredo-"), false);
    assert.equal(JSON.stringify(snapshot).includes("tok-"), false);
  });

  it("as duas empresas são consultadas em paralelo, com concorrência limitada", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    let active = 0;
    let peak = 0;
    cnj.behavior.onList = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };
    const { service } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    assert.equal(peak, 2);

    clearDomicilioTokenCacheForTests();
    peak = 0;
    const previous = process.env.PDPJ_DOMICILIO_MAX_CONCURRENCY;
    process.env.PDPJ_DOMICILIO_MAX_CONCURRENCY = "1";
    try {
      await createService(seedMemory(), cnj).service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    } finally {
      if (previous == null) delete process.env.PDPJ_DOMICILIO_MAX_CONCURRENCY;
      else process.env.PDPJ_DOMICILIO_MAX_CONCURRENCY = previous;
    }
    assert.equal(peak, 1);
  });

  it("falha de uma empresa não interrompe a outra e cada uma tem status e checkpoint próprios", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    cnj.behavior.rejectSecretOf = "LAZARIOS";
    cnj.data.KOPPETEL.push(communication({ numeroComunicacao: "k-1", numeroProcesso: PROCESS_NEW, documentoDestinatario: KOPPETEL.cnpj }));
    const { service, repository, runs } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const snapshot = repository.snapshot();
    const connection = (entityId: string) =>
      snapshot.connections.find((row) => row.entityId === entityId && row.source === "DOMICILIO")!;
    assert.equal(connection("entity-lazarios").status, "AUTH_ERROR");
    assert.equal(connection("entity-lazarios").lastFullSyncAt, null);
    assert.equal(connection("entity-koppetel").status, "HEALTHY");
    assert.equal(connection("entity-koppetel").lastFullSyncAt, NOW.toISOString());
    assert.equal(snapshot.communications.length, 1);
    assert.equal(snapshot.communications[0]!.entityId, "entity-koppetel");
    // A falha aparece: alerta de fonte e execução não é dada como sucesso.
    assert.equal(snapshot.events.some((row) => row.eventType === "SOURCE_FAILED" && row.entityId === "entity-lazarios"), true);
    assert.notEqual(runs.find((row) => row.target === "LEGAL_EXPOSURE_DOMICILIO")!.status, "SUCCESS");

    const states = buildDomicilioCompanyStates({ memory: snapshot, now: NOW, env: ENV });
    const lazarios = states.find((row) => row.entityId === "entity-lazarios")!;
    const koppetel = states.find((row) => row.entityId === "entity-koppetel")!;
    assert.equal(lazarios.stale, true);
    assert.equal(lazarios.lastErrorCode, "AUTH_ERROR");
    assert.equal(koppetel.stale, false);
    assert.equal(koppetel.communications, 1);
  });

  it("paginação interrompida: grava o que chegou, não avança o checkpoint e a retomada completa sem duplicar", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    cnj.behavior.pageSize = 2;
    for (let index = 1; index <= 5; index += 1) {
      cnj.data.LAZARIOS.push(communication({ numeroComunicacao: `c-${index}`, numeroProcesso: PROCESS_NEW }));
    }
    cnj.behavior.failListOf = { account: "LAZARIOS", status: 500, fromPage: 1 };
    const { service, repository, domicilioInputs } = createService(memory, cnj);
    const first = await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const partial = repository.snapshot();
    const connection = () =>
      repository.snapshot().connections.find((row) => row.entityId === "entity-lazarios" && row.source === "DOMICILIO")!;
    assert.equal(first.batches.find((row) => row.source === "DOMICILIO" && row.communications > 0)!.outcome, "PARTIAL");
    assert.equal(partial.communications.length, 2);
    assert.equal(connection().lastFullSyncAt, null, "checkpoint não avança com página faltando");
    assert.equal(connection().status, "DEGRADED");
    assert.equal(buildDomicilioCompanyStates({ memory: partial, now: NOW, env: ENV })[1]!.stale, true);

    cnj.behavior.failListOf = undefined;
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    // A retomada parte do mesmo ponto (sem checkpoint) e completa o lote.
    assert.equal(domicilioInputs.filter((row) => row.entity.cnpj === LAZARIOS.cnpj).at(-1)!.checkpoint, null);
    assert.equal(repository.snapshot().communications.length, 5);
    assert.equal(connection().lastFullSyncAt, NOW.toISOString());
    assert.equal(connection().status, "HEALTHY");

    // Execução seguinte usa o checkpoint gravado.
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    assert.equal(domicilioInputs.filter((row) => row.entity.cnpj === LAZARIOS.cnpj).at(-1)!.checkpoint, NOW.toISOString());
    assert.equal(repository.snapshot().communications.length, 5);
  });

  it("limite de páginas: coleta truncada é PARTIAL e não avança o checkpoint", async () => {
    const cnj = createFakeCnj();
    cnj.behavior.pageSize = 1;
    for (let index = 1; index <= 4; index += 1) cnj.data.LAZARIOS.push(communication({ numeroComunicacao: `c-${index}` }));
    const batch = await runDomicilioSync({
      env: { ...ENV, PDPJ_DOMICILIO_MAX_PAGES: "2" },
      fetchImpl: cnj.fetchImpl,
      now: NOW,
      checkpoint: "2026-10-13T11:00:00.000Z",
      entity: { cnpj: LAZARIOS.cnpj },
      sleep: async () => {},
    });
    assert.equal(batch.outcome, "PARTIAL");
    assert.equal(batch.errorCode, "TRUNCATED");
    assert.equal(batch.coverage!.complete, false);
    assert.equal(batch.communications.length, 2);
  });

  it("preview consulta mas não grava nada", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1", numeroProcesso: PROCESS_NEW }));
    const { service, repository } = createService(memory, cnj);
    const result = await service.sync({ mode: "preview", source: "DOMICILIO" }, USER);
    assert.equal(result.batches.some((row) => row.source === "DOMICILIO" && row.communications === 1), true);
    assert.equal(repository.snapshot().communications.length, 0);
    assert.equal(repository.snapshot().cases.length, 0);
  });

  it("empresa com monitoramento do Domicílio desligado não é consultada", async () => {
    const memory = seedMemory();
    memory.entities.find((row) => row.id === "entity-koppetel")!.monitorDomicilio = false;
    const cnj = createFakeCnj();
    const { service } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    assert.equal(cnj.requests.some((row) => row.account === "KOPPETEL"), false);
    assert.equal(cnj.requests.some((row) => row.account === "LAZARIOS"), true);
  });

  it("DJEN e DataJud seguem funcionando no mesmo ciclo e não recebem dados do Domicílio", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1", numeroProcesso: PROCESS_NEW }));
    const repository = createMemoryExposureRepository(memory);
    const calls = { djen: 0, datajud: 0, escavador: 0 };
    const service = createLegalExposureService({
      repository,
      createId: sequentialIds(),
      now: () => NOW,
      runners: {
        domicilio: (input) => runDomicilioSync({ ...(input ?? {}), env: ENV, fetchImpl: cnj.fetchImpl, now: NOW, sleep: async () => {} }),
        djen: async () => {
          calls.djen += 1;
          return emptyBatch("DJEN");
        },
        datajud: async () => {
          calls.datajud += 1;
          return emptyBatch("DATAJUD");
        },
        escavador: async () => {
          calls.escavador += 1;
          return emptyBatch("ESCAVADOR");
        },
      },
    });
    const result = await service.sync({ mode: "apply", source: "ALL" }, USER);
    assert.ok(calls.djen > 0);
    assert.deepEqual(new Set(result.batches.map((row) => row.source)).has("DOMICILIO"), true);
    assert.equal(repository.snapshot().communications.filter((row) => row.source === "DOMICILIO").length, 1);
    // Sincronizar só o DJEN não toca o Domicílio.
    const requestsBefore = cnj.requests.length;
    await service.sync({ mode: "apply", source: "DJEN" }, USER);
    assert.equal(cnj.requests.length, requestsBefore);
  });
});

describe("domicílio — segregação por CNPJ completo", () => {
  const context = { accountCnpj: LAZARIOS.cnpj, tenantId: TENANT.LAZARIOS };
  const page = (rows: unknown[]) => ({ page: { count: rows.length, pageNumber: 0, pageSize: 50, totalPages: 1 }, data: rows });

  it("CNPJ exato da conta é aceito, com ou sem máscara", () => {
    const mapped = mapDomicilioCommunicationPage(
      page([
        communication({ numeroComunicacao: "ok-1" }),
        communication({ numeroComunicacao: "ok-2", documentoDestinatario: LAZARIOS.displayCnpj }),
      ]),
      context
    );
    assert.deepEqual(mapped.communications.map((row) => row.sourceCommunicationId), ["ok-1", "ok-2"]);
    assert.equal(mapped.rejections.length, 0);
    assert.equal(mapped.cases[0]!.explicitCnpj, LAZARIOS.cnpj);
  });

  it("filial e qualquer CNPJ de mesma raiz não são atribuídos à empresa consultada", () => {
    assert.equal(LAZARIOS_BRANCH.slice(0, 8), LAZARIOS.cnpj.slice(0, 8));
    assert.notEqual(LAZARIOS_BRANCH, LAZARIOS.cnpj);
    const mapped = mapDomicilioCommunicationPage(
      page([
        communication({ numeroComunicacao: "filial-1", documentoDestinatario: LAZARIOS_BRANCH }),
        communication({ numeroComunicacao: "filial-2", documentoDestinatario: branchCnpj(LAZARIOS.cnpj, "0003"), numeroProcesso: PROCESS_NEW }),
      ]),
      context
    );
    assert.equal(mapped.communications.length, 0);
    assert.equal(mapped.cases.length, 0, "filial não alimenta a descoberta de processo");
    assert.equal(mapped.rejectedRecipient, 2);
    assert.equal(mapped.invalid, 0);
    assert.deepEqual(mapped.rejections, [
      { reason: "RECIPIENT_MISMATCH", recipientKind: "CNPJ", sameRoot: true, communicationRef: "filial-1" },
      { reason: "RECIPIENT_MISMATCH", recipientKind: "CNPJ", sameRoot: true, communicationRef: "filial-2" },
    ]);
  });

  it("empresa de raiz diferente e pessoa física são recusadas", () => {
    const mapped = mapDomicilioCommunicationPage(
      page([
        communication({ numeroComunicacao: "outra-1", documentoDestinatario: KOPPETEL.cnpj }),
        communication({ numeroComunicacao: "pf-1", documentoDestinatario: "11144477735" }),
      ]),
      context
    );
    assert.equal(mapped.communications.length, 0);
    assert.deepEqual(mapped.rejections.map((row) => [row.reason, row.recipientKind, row.sameRoot]), [
      ["RECIPIENT_MISMATCH", "CNPJ", false],
      ["RECIPIENT_MISMATCH", "CPF", false],
    ]);
    // A ocorrência é sanitizada: nenhum documento do destinatário recusado é guardado.
    const serialized = JSON.stringify(mapped);
    assert.equal(serialized.includes(KOPPETEL.cnpj), false);
    assert.equal(serialized.includes("11144477735"), false);
  });

  it("destinatário ausente ou malformado é registro inválido, nunca aproximado", () => {
    const malformed = [
      undefined,
      null,
      "",
      "   ",
      "abc",
      `${LAZARIOS.cnpj}x`,
      LAZARIOS.cnpj.slice(0, 13),
      `${LAZARIOS.cnpj.slice(0, 12)}00`,
      `0${LAZARIOS.cnpj}`,
      { documento: LAZARIOS.cnpj },
    ];
    const mapped = mapDomicilioCommunicationPage(
      page(malformed.map((documentoDestinatario, index) => ({ ...communication({ numeroComunicacao: `m-${index}` }), documentoDestinatario }))),
      context
    );
    assert.equal(mapped.communications.length, 0);
    assert.equal(mapped.cases.length, 0);
    assert.equal(mapped.invalid, malformed.length);
    assert.equal(mapped.rejectedRecipient, 0);
    assert.deepEqual(
      [...new Set(mapped.rejections.map((row) => row.reason))].sort(),
      ["RECIPIENT_MALFORMED", "RECIPIENT_MISSING"]
    );
    assert.equal(mapped.rejections.filter((row) => row.reason === "RECIPIENT_MISSING").length, 4);
  });

  it("a única representação comprovada é o perfil que o CNJ devolve para o CNPJ da conta; perfil da filial no mesmo tenant não abre exceção", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    // O CNJ também lista a filial como perfil do mesmo tenant: isso não autoriza atribuir a ela.
    cnj.behavior.extraProfilesOf = {
      account: "LAZARIOS",
      profiles: [{ tenantId: TENANT.LAZARIOS, documento: LAZARIOS_BRANCH, tenantName: "Filial" }],
    };
    cnj.data.LAZARIOS.push(
      communication({ numeroComunicacao: "matriz-1" }),
      communication({ numeroComunicacao: "filial-1", documentoDestinatario: LAZARIOS_BRANCH, numeroProcesso: PROCESS_NEW })
    );
    const { service, repository, runs } = createService(memory, cnj);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const snapshot = repository.snapshot();
    assert.deepEqual(snapshot.communications.map((row) => row.sourceCommunicationId), ["matriz-1"]);
    assert.equal(snapshot.cases.some((row) => row.processNumberNormalized === PROCESS_NEW), false);
    assert.equal(JSON.stringify(snapshot).includes(LAZARIOS_BRANCH), false, "nada da filial é persistido");

    // A ocorrência fica registrada, sanitizada, na execução; recusa por destinatário não trava o checkpoint.
    const summary = runs.find((row) => row.target === "LEGAL_EXPOSURE_DOMICILIO")!.summary as {
      domicilioEntities: Array<{ entityId: string; rejectedRecipient: number; rejections: unknown[]; windowComplete: boolean }>;
    };
    const lazarios = summary.domicilioEntities.find((row) => row.entityId === "entity-lazarios")!;
    assert.equal(lazarios.rejectedRecipient, 1);
    assert.deepEqual(lazarios.rejections, [
      { reason: "RECIPIENT_MISMATCH", recipientKind: "CNPJ", sameRoot: true, communicationRef: "filial-1" },
    ]);
    assert.equal(lazarios.windowComplete, true);
    assert.equal(JSON.stringify(runs).includes(LAZARIOS_BRANCH), false);
    const connection = snapshot.connections.find((row) => row.entityId === "entity-lazarios" && row.source === "DOMICILIO")!;
    assert.equal(connection.lastFullSyncAt, NOW.toISOString());
  });

  it("credencial cujo perfil no CNJ é só o da filial não é aceita para a matriz", async () => {
    const cnj = createFakeCnj();
    // A conta diz ser a filial, mas o CNJ só devolve o perfil da matriz para essa credencial.
    const env = { ...ENV, PDPJ_DOMICILIO_ACCOUNTS: "LAZARIOS", PDPJ_DOMICILIO_LAZARIOS_CNPJ: LAZARIOS_BRANCH };
    const batch = await runDomicilioSync({ env, fetchImpl: cnj.fetchImpl, now: NOW, entity: { cnpj: LAZARIOS_BRANCH }, sleep: async () => {} });
    assert.equal(batch.outcome, "AUTH_ERROR");
    assert.equal(cnj.requests.some((row) => row.url.pathname.endsWith("/comunicacoes")), false);
  });
});

describe("domicílio — segurança jurídica das requisições", () => {
  it("o SSO recebe só client_credentials; On-behalf-Of e tenantId vão apenas para a API, e só GET", async () => {
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1" }));
    await runDomicilioSync({ env: ENV, fetchImpl: cnj.fetchImpl, now: NOW, entity: { cnpj: LAZARIOS.cnpj }, sleep: async () => {} });
    const token = cnj.requests.filter((row) => row.url.href === TOKEN_URL);
    const api = cnj.requests.filter((row) => row.url.href !== TOKEN_URL);
    assert.equal(token.length, 1);
    assert.equal(token[0]!.method, "POST");
    assert.equal("on-behalf-of" in token[0]!.headers, false);
    assert.equal("tenantid" in token[0]!.headers, false);
    assert.equal(token[0]!.url.search, "");
    assert.ok(api.length >= 2);
    assert.deepEqual([...new Set(api.map((row) => row.method))], ["GET"]);
    assert.deepEqual(
      [...new Set(api.map((row) => row.url.pathname.replace("/domicilio", "")))].sort(),
      ["/api/v1/comunicacoes", "/api/v1/eu"]
    );
    for (const request of api) assert.equal(request.headers["on-behalf-of"], "11144477735");
    assert.equal("tenantid" in api.find((row) => row.url.pathname.endsWith("/eu"))!.headers, false);
    // A listagem só leva filtros de leitura; nada que identifique ou altere uma comunicação.
    for (const request of api.filter((row) => row.url.pathname.endsWith("/comunicacoes"))) {
      assert.deepEqual([...request.url.searchParams.keys()].sort(), ["dataFim", "dataInicio", "page", "size", "statusCiente"]);
    }
  });
});

describe("domicílio — checkpoint e consistência", () => {
  it("registro fora do contrato não é gravado e não deixa o checkpoint avançar", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(
      communication({ numeroComunicacao: "c-1", numeroProcesso: PROCESS_NEW }),
      { ...communication({ numeroComunicacao: "c-sem-destinatario", numeroProcesso: PROCESS_NEW }), documentoDestinatario: "" }
    );
    const { service, repository, runs } = createService(memory, cnj);
    const result = await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    const connection = () =>
      repository.snapshot().connections.find((row) => row.entityId === "entity-lazarios" && row.source === "DOMICILIO")!;
    const batch = result.batches.find((row) => row.source === "DOMICILIO" && row.communications > 0)!;
    assert.equal(batch.outcome, "PARTIAL");
    assert.equal(batch.errorCode, "INVALID_RECORDS");
    assert.equal(repository.snapshot().communications.length, 1, "o registro válido é gravado");
    assert.equal(connection().lastFullSyncAt, null);
    assert.equal(connection().status, "DEGRADED");
    const summary = runs.find((row) => row.target === "LEGAL_EXPOSURE_DOMICILIO")!.summary as {
      domicilioEntities: Array<{ entityId: string; invalid: number; windowComplete: boolean; rejections: Array<{ reason: string }> }>;
    };
    const lazarios = summary.domicilioEntities.find((row) => row.entityId === "entity-lazarios")!;
    assert.equal(lazarios.invalid, 1);
    assert.equal(lazarios.windowComplete, false);
    assert.equal(lazarios.rejections[0]!.reason, "RECIPIENT_MISSING");

    // Corrigido na fonte, a releitura completa a janela sem duplicar.
    cnj.data.LAZARIOS[1] = communication({ numeroComunicacao: "c-sem-destinatario", numeroProcesso: PROCESS_NEW });
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    assert.equal(repository.snapshot().communications.length, 2);
    assert.equal(connection().lastFullSyncAt, NOW.toISOString());
  });

  it("falha de persistência: nada é gravado, o checkpoint não anda e a nova execução repete a janela sem duplicar", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    cnj.data.LAZARIOS.push(communication({ numeroComunicacao: "c-1", numeroProcesso: PROCESS_NEW }));
    const inner = createMemoryExposureRepository(memory);
    const timeline: string[] = [];
    let failNextPersist = true;
    const repository = {
      ...inner,
      snapshot: inner.snapshot,
      async load() {
        timeline.push("load");
        return structuredClone(await inner.load());
      },
      async persist(next: LegalExposureMemory) {
        timeline.push("persist");
        if (failNextPersist) {
          failNextPersist = false;
          throw new Error("falha simulada de banco");
        }
        await inner.persist(next);
      },
    };
    const inputs: DomicilioRunnerInput[] = [];
    const service = createLegalExposureService({
      repository,
      createId: sequentialIds(),
      now: () => NOW,
      runners: {
        domicilio: async (input) => {
          if (input) inputs.push(input);
          const batch = await runDomicilioSync({ ...(input ?? {}), env: ENV, fetchImpl: cnj.fetchImpl, now: NOW, sleep: async () => {} });
          timeline.push("http-done");
          return batch;
        },
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async () => emptyBatch("DJEN"),
      },
    });

    await assert.rejects(() => service.sync({ mode: "apply", source: "DOMICILIO" }, USER), /falha simulada de banco/);
    assert.equal(inner.snapshot().communications.length, 0);
    assert.equal(inner.snapshot().connections.length, 0);
    // Toda a rede termina antes de a gravação começar: não há HTTP dentro da transação.
    assert.deepEqual(timeline, ["load", "http-done", "http-done", "persist"]);

    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    assert.equal(inputs.filter((row) => row.entity.cnpj === LAZARIOS.cnpj).at(-1)!.checkpoint, null, "repete a mesma janela");
    assert.equal(inner.snapshot().communications.length, 1);
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    assert.equal(inner.snapshot().communications.length, 1);
    assert.equal(inner.snapshot().events.filter((row) => row.eventType === "NEW_COMMUNICATION").length, 1);
  });

  it("coletas do Domicílio não correm juntas: DOMICILIO recusa durante o ALL e o ALL não repete a coleta em andamento", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    cnj.behavior.onList = async () => {
      entered();
      await gate;
    };
    const { service } = createService(memory, cnj);
    const all = service.sync({ mode: "apply", source: "ALL" }, USER);
    await started;
    await assert.rejects(
      () => service.sync({ mode: "apply", source: "DOMICILIO" }, USER),
      (error: Error) => error.message === "Execução já em andamento."
    );
    release();
    await all;

    // Sentido inverso: com o job DOMICILIO em andamento, o DJEN isolado roda e não chama o Domicílio.
    let release2!: () => void;
    const gate2 = new Promise<void>((resolve) => {
      release2 = resolve;
    });
    let entered2!: () => void;
    const started2 = new Promise<void>((resolve) => {
      entered2 = resolve;
    });
    cnj.behavior.onList = async () => {
      entered2();
      await gate2;
    };
    const domicilio = service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    await started2;
    const before = cnj.requests.length;
    await service.sync({ mode: "apply", source: "DJEN" }, USER);
    assert.equal(cnj.requests.length, before);
    release2();
    await domicilio;
    // Depois de liberado, a coleta volta a ser aceita.
    cnj.behavior.onList = undefined;
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
  });

  it("releitura de pendências percorre todos os processos em rodízio, mesmo acima do teto por execução", async () => {
    const memory = seedMemory();
    const cnj = createFakeCnj();
    const processes = ["00000010120245090001", "00000020220245090002", "00000030320245090003"];
    processes.forEach((numeroProcesso, index) =>
      cnj.data.LAZARIOS.push(communication({ numeroComunicacao: `p-${index}`, numeroProcesso }))
    );
    const env = { ...ENV, PDPJ_DOMICILIO_RECONCILE_MAX_PROCESSES: "1" };
    let current = NOW;
    const repository = createMemoryExposureRepository(memory);
    const service = createLegalExposureService({
      repository,
      createId: sequentialIds(),
      now: () => current,
      runners: {
        domicilio: (input) => runDomicilioSync({ ...(input ?? {}), env, fetchImpl: cnj.fetchImpl, now: current, sleep: async () => {} }),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async () => emptyBatch("DJEN"),
      },
    });
    await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
    // As comunicações saem da janela de datas: só a releitura por processo as alcança.
    cnj.data.LAZARIOS.forEach((row) => {
      row.dataComunicacao = "2026-06-01T10:00:00.000Z";
    });
    const reread: string[] = [];
    for (let run = 1; run <= 3; run += 1) {
      current = new Date(NOW.getTime() + run * 60 * 60 * 1000);
      const before = cnj.requests.length;
      await service.sync({ mode: "apply", source: "DOMICILIO" }, USER);
      reread.push(
        ...cnj.requests
          .slice(before)
          .filter((row) => row.account === "LAZARIOS" && row.url.searchParams.has("numeroProcesso"))
          .map((row) => row.url.searchParams.get("numeroProcesso")!)
      );
    }
    assert.deepEqual([...reread].sort(), [...processes].sort(), "um processo por execução, sem repetir até dar a volta");
  });

  it("sobreposição e carga inicial são configuração, não constante", () => {
    const checkpoint = "2026-10-13T11:00:00.000Z";
    const noOverlap = domicilioSyncWindows({ now: NOW, checkpoint, backfillDays: 30, overlapMs: 0 });
    assert.deepEqual(noOverlap, [{ dataInicio: checkpoint, dataFim: NOW.toISOString() }]);
    const wide = domicilioSyncWindows({ now: NOW, checkpoint, backfillDays: 30, overlapMs: 10 * 24 * 60 * 60 * 1000 });
    assert.equal(wide[0]!.dataInicio, "2026-10-03T11:00:00.000Z");
    assert.equal(wide.length, 2);
    assert.equal(domicilioSyncWindows({ now: NOW, checkpoint: null, backfillDays: 90 }).length, 13);
  });
});

describe("domicílio — estado por empresa na central de fontes", () => {
  it("sem comunicações e coleta em dia: não é defasada; sem coleta completa: defasada", () => {
    const memory = seedMemory();
    const fresh = buildDomicilioCompanyStates({ memory, now: NOW, env: ENV });
    assert.deepEqual(fresh.map((row) => [row.accountConfigured, row.stale, row.communications]), [
      [true, true, 0],
      [true, true, 0],
    ]);
    memory.connections.push({
      id: "conn-1",
      entityId: "entity-lazarios",
      source: "DOMICILIO",
      environment: "production",
      enabled: true,
      status: "HEALTHY",
      lastAttemptAt: NOW.toISOString(),
      lastSuccessfulAt: NOW.toISOString(),
      lastFullSyncAt: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(),
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessageSanitized: null,
      sourceUpdatedAt: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const states = buildDomicilioCompanyStates({ memory, now: NOW, env: { ...ENV, PDPJ_DOMICILIO_ACCOUNTS: "LAZARIOS" } });
    const lazarios = states.find((row) => row.entityId === "entity-lazarios")!;
    const koppetel = states.find((row) => row.entityId === "entity-koppetel")!;
    assert.equal(lazarios.stale, false);
    assert.equal(lazarios.communications, 0);
    assert.equal(koppetel.accountConfigured, false);
    assert.equal(koppetel.stale, true);
    // Duas horas depois, sem nova coleta completa, volta a ser defasada.
    const later = buildDomicilioCompanyStates({ memory, now: new Date(NOW.getTime() + 2 * 60 * 60 * 1000), env: ENV });
    assert.equal(later.find((row) => row.entityId === "entity-lazarios")!.stale, true);
    assert.equal(JSON.stringify(states).includes("segredo-"), false);
  });
});
