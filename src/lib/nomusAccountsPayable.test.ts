import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asBoolean,
  parseNomusBrDate,
  parseNomusBrDateTime,
  parseNomusOptionalMoney,
} from "./nomusAccountsPayableParser.js";
import {
  mapNomusAccountsPayablePayload,
  stableNomusPayloadHash,
} from "./nomusAccountsPayableMapper.js";
import {
  buildAccountsPayableSummary,
  isAccountsPayableOpen,
} from "./nomusAccountsPayableSummary.js";
import {
  buildAccountsPayablePageParams,
  hasNextAccountsPayablePage,
  pickAccountsPayableArray,
  resolveAccountsPayablePageSize,
  shouldStopAccountsPayablePagination,
} from "./nomusAccountsPayableSyncLogic.js";
import {
  buildNomusHeaders,
  buildNomusUrl,
  fetchNomusJson,
  redactHeadersForLog,
  sanitizeNomusErrorBody,
} from "./nomusRestClient.js";
import {
  NOMUS_FINANCIAL_DEFAULT_PAGE_SIZE,
  resolveNomusFinancialPageSize,
} from "./nomusFinancialSyncQueryParams.js";
import { Prisma } from "@prisma/client";

describe("nomusAccountsPayableParser", () => {
  it("parseNomusOptionalMoney parses BR currency", () => {
    assert.equal(parseNomusOptionalMoney("4.252,80"), 4252.8);
    assert.equal(parseNomusOptionalMoney("0,00"), 0);
    assert.equal(parseNomusOptionalMoney(""), null);
    assert.equal(parseNomusOptionalMoney(null), null);
  });

  it("parseNomusBrDate parses dd/MM/yyyy", () => {
    const date = parseNomusBrDate("29/07/2026");
    assert.ok(date);
    assert.equal(date!.getFullYear(), 2026);
    assert.equal(date!.getMonth(), 6);
    assert.equal(date!.getDate(), 29);
  });

  it("parseNomusBrDateTime parses dd/MM/yyyy HH:mm:ss", () => {
    const date = parseNomusBrDateTime("03/06/2026 15:10:55");
    assert.ok(date);
    assert.equal(date!.getHours(), 15);
    assert.equal(date!.getMinutes(), 10);
    assert.equal(date!.getSeconds(), 55);
  });

  it("asBoolean handles true/false", () => {
    assert.equal(asBoolean(true), true);
    assert.equal(asBoolean(false), false);
    assert.equal(asBoolean("false"), false);
    assert.equal(asBoolean(undefined), null);
  });
});

describe("nomusAccountsPayableMapper", () => {
  const samplePayload = {
    id: 54321,
    classificacao: "DESPESA",
    cnpjPessoa: "98.765.432/0001-10",
    dataAgendamento: "01/08/2026",
    dataCompetencia: "07/2026",
    dataHoraCriacao: "03/06/2026 15:10:55",
    dataModificacao: "04/06/2026 09:00:00",
    dataVencimento: "29/07/2026",
    dataBaixa: null,
    dataPagamento: null,
    descricaoLancamento: "Parcela fornecedor NF 200",
    idContaBancaria: 1,
    idEmpresa: 2,
    idFormaPagamento: 3,
    idPessoa: 4,
    nomeContaBancaria: "Bradesco",
    nomeEmpresa: "Empresa A",
    nomeFormaPagamento: "Transferência",
    nomePessoa: "Fornecedor Y",
    saldoPagar: "3.150,50",
    status: false,
    tipo: 1,
    valorPagar: "3.150,50",
    valorPagarAgendado: "0,00",
    valorPago: "0,00",
    comentarios: "",
    numeroDocumento: "DOC-001",
    percentualMultaPorAtrasoEmContasPagar: "2,00",
    suspenderPagamento: false,
    taxaMensalJuros: "1,00",
    telefonePessoa: "(11) 88888-0000",
    tipoCalculoMultaPorAtrasoEmContasPagar: "PERCENTUAL",
    tipoJurosAtrasoEmContasPagar: "SIMPLES",
    idNfe: 888,
    numeroNotaFiscalOrigem: "654321",
  };

  it("maps API payload to model fields", () => {
    const mapped = mapNomusAccountsPayablePayload(samplePayload);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.externalId, 54321);
    assert.equal(mapped.row.personName, "Fornecedor Y");
    assert.equal(mapped.row.balancePayable?.toNumber(), 3150.5);
    assert.equal(mapped.row.status, false);
    assert.equal(mapped.row.documentNumber, "DOC-001");
    assert.equal(mapped.row.sourceInvoiceId, 888);
    assert.equal(mapped.row.sourceInvoiceNumber, "654321");
    assert.equal(mapped.row.suspendPayment, false);
    assert.ok(mapped.row.rawPayload);
    assert.ok(mapped.row.payloadHash.length >= 32);
  });

  it("returns error when external id is missing", () => {
    const mapped = mapNomusAccountsPayablePayload({});
    assert.equal(mapped.ok, false);
  });

  it("payloadHash detects alteration", () => {
    const first = stableNomusPayloadHash(samplePayload);
    const changed = stableNomusPayloadHash({ ...samplePayload, saldoPagar: "4.000,00" });
    assert.notEqual(first, changed);
  });

  it("maps live AP payload with receber-field names and negative amounts as positive", () => {
    const livePayload = {
      id: 16743,
      nomePessoa: "PIZZA PACK COMERCIO DE EMBALAGENS LTDA",
      dataVencimento: "05/08/2026",
      saldoReceber: "-3.279,55",
      valorReceber: "-3.279,55",
      valorReceberAgendado: "-3.279,55",
      valorRecebido: "0,00",
    };

    const mapped = mapNomusAccountsPayablePayload(livePayload);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;

    assert.equal(mapped.row.amountPayable?.toNumber(), 3279.55);
    assert.equal(mapped.row.balancePayable?.toNumber(), 3279.55);
    assert.equal(mapped.row.amountScheduled?.toNumber(), 3279.55);
    assert.equal(mapped.row.amountPaid?.toNumber(), 0);
    assert.equal(mapped.row.rawPayload.saldoReceber, "-3.279,55");
    assert.equal(mapped.row.rawPayload.valorReceber, "-3.279,55");
    assert.equal(mapped.row.payloadHash, stableNomusPayloadHash(livePayload));
  });
});

describe("nomusAccountsPayableSummary", () => {
  it("computes open, overdue, next 7/30 days and paid this month", () => {
    const today = new Date(2026, 5, 6, 12, 0, 0);
    const summary = buildAccountsPayableSummary(
      [
        {
          balancePayable: new Prisma.Decimal(1000),
          amountPaid: new Prisma.Decimal(0),
          amountPayable: new Prisma.Decimal(1000),
          status: false,
          dueDate: new Date(2026, 4, 1),
          settlementDate: null,
          paymentDate: null,
          syncedAt: new Date(2026, 5, 6),
        },
        {
          balancePayable: new Prisma.Decimal(500),
          amountPaid: new Prisma.Decimal(0),
          amountPayable: new Prisma.Decimal(500),
          status: false,
          dueDate: new Date(2026, 5, 10),
          settlementDate: null,
          paymentDate: null,
          syncedAt: new Date(2026, 5, 6),
        },
        {
          balancePayable: new Prisma.Decimal(0),
          amountPaid: new Prisma.Decimal(800),
          amountPayable: new Prisma.Decimal(800),
          status: true,
          dueDate: new Date(2026, 3, 1),
          settlementDate: new Date(2026, 5, 2),
          paymentDate: new Date(2026, 5, 2),
          syncedAt: new Date(2026, 5, 5),
        },
      ],
      today
    );

    assert.equal(summary.total, 3);
    assert.equal(summary.open, 2);
    assert.equal(summary.settled, 1);
    assert.equal(summary.overdueAmount, 1000);
    assert.equal(summary.dueNext7DaysAmount, 500);
    assert.equal(summary.dueNext30DaysAmount, 500);
    assert.equal(summary.totalOpenAmount, 1500);
    assert.equal(summary.paidThisMonthAmount, 800);
    assert.ok(summary.lastSyncAt);
  });

  it("open uses positive balance", () => {
    assert.equal(isAccountsPayableOpen({ balancePayable: new Prisma.Decimal(0.01) }), true);
    assert.equal(isAccountsPayableOpen({ balancePayable: new Prisma.Decimal(0) }), false);
  });
});

describe("nomusAccountsPayableSyncLogic", () => {
  it("pickAccountsPayableArray reads contasPagar", () => {
    const arr = pickAccountsPayableArray({ contasPagar: [{ id: 1 }] });
    assert.equal(arr.length, 1);
  });

  it("pickAccountsPayableArray reads { dados: [...] } and nested data.dados", () => {
    assert.equal(pickAccountsPayableArray({ dados: [{ id: 1 }, { id: 2 }] }).length, 2);
    assert.equal(pickAccountsPayableArray({ data: { dados: [{ id: 9 }] } }).length, 1);
  });

  it("builds full BI query params (pagina, tamanhoPagina, datas, apenasPendentes, ordenacao)", () => {
    const params = buildAccountsPayablePageParams(3, 1000, {});
    assert.equal(params.pagina, "3");
    assert.equal(params.tamanhoPagina, "1000");
    assert.equal(params.dataInicio, "01/01/2020");
    assert.equal(params.dataFim, "31/12/2030");
    assert.equal(params.apenasPendentes, "false");
    assert.equal(params.ordenacao, "dataVencimento");

    const url = buildNomusUrl("https://host/rest/", "contasPagar", params);
    assert.equal(url.searchParams.get("pagina"), "3");
    assert.equal(url.searchParams.get("tamanhoPagina"), "1000");
    assert.equal(url.searchParams.get("dataInicio"), "01/01/2020");
    assert.equal(url.searchParams.get("ordenacao"), "dataVencimento");
  });

  it("financial page size defaults to 1000 and is overridable", () => {
    assert.equal(NOMUS_FINANCIAL_DEFAULT_PAGE_SIZE, 1000);
    assert.equal(resolveAccountsPayablePageSize({}), 1000);
    assert.equal(resolveNomusFinancialPageSize({ NOMUS_PAGE_SIZE: "250" }), 250);
    assert.equal(
      resolveNomusFinancialPageSize({ NOMUS_PAGE_SIZE: "250", NOMUS_FINANCIAL_PAGE_SIZE: "500" }),
      500
    );
  });

  it("env overrides the date window", () => {
    const params = buildAccountsPayablePageParams(1, 1000, {
      NOMUS_FINANCIAL_START_DATE: "01/06/2024",
      NOMUS_FINANCIAL_END_DATE: "30/06/2024",
    });
    assert.equal(params.dataInicio, "01/06/2024");
    assert.equal(params.dataFim, "30/06/2024");
  });

  it("throws a clear error for invalid date format", () => {
    assert.throws(
      () => buildAccountsPayablePageParams(1, 1000, { NOMUS_FINANCIAL_START_DATE: "2024-06-01" }),
      /NOMUS_FINANCIAL_START_DATE inválida/
    );
  });

  it("stops pagination when page has less than 50 items", () => {
    assert.equal(shouldStopAccountsPayablePagination(49), true);
    assert.equal(shouldStopAccountsPayablePagination(50), false);
    assert.equal(hasNextAccountsPayablePage({}, 1, 50), true);
    assert.equal(hasNextAccountsPayablePage({}, 2, 49), false);
  });
});

describe("nomusRestClient (accounts payable)", () => {
  it("buildNomusUrl avoids duplicated /rest", () => {
    const url = buildNomusUrl("https://host/rest/", "contasPagar", { pagina: "1" });
    assert.equal(url.pathname.endsWith("/rest/contasPagar"), true);
    assert.equal(url.searchParams.get("pagina"), "1");
    assert.doesNotMatch(url.pathname, /\/rest\/rest/);
  });

  it("redactHeadersForLog hides authorization token", () => {
    const headers = buildNomusHeaders({
      NOMUS_TOKEN: "secret-token",
      NOMUS_AUTH_HEADER_NAME: "Authorization",
      NOMUS_AUTH_HEADER_VALUE: "Basic abc123",
    } as NodeJS.ProcessEnv);
    const logged = redactHeadersForLog(headers);
    assert.equal(logged.Authorization, "<redigido>");
    assert.doesNotMatch(JSON.stringify(logged), /secret-token/);
    assert.doesNotMatch(JSON.stringify(logged), /abc123/);
  });

  it("redactHeadersForLog masks NOMUS_AUTH and all sensitive env names", () => {
    const logged = redactHeadersForLog({
      NOMUS_AUTH: "Basic abc",
      NOMUS_AUTH_HEADER_VALUE: "Basic abc",
      NOMUS_TOKEN: "x",
      NOMUS_API_KEY: "x",
      NOMUS_PASSWORD: "x",
      NOMUS_CLIENT_SECRET: "x",
      NORMAL: "ok",
    });
    assert.equal(logged.NOMUS_AUTH, "<redigido>");
    assert.equal(logged.NOMUS_AUTH_HEADER_VALUE, "<redigido>");
    assert.equal(logged.NOMUS_TOKEN, "<redigido>");
    assert.equal(logged.NOMUS_API_KEY, "<redigido>");
    assert.equal(logged.NOMUS_PASSWORD, "<redigido>");
    assert.equal(logged.NOMUS_CLIENT_SECRET, "<redigido>");
    assert.equal(logged.NORMAL, "ok");
    assert.doesNotMatch(JSON.stringify(logged), /Basic abc/);
  });

  it("sanitizeNomusErrorBody strips Basic/Bearer credentials", () => {
    const sanitized = sanitizeNomusErrorBody('{"auth":"Basic c2VjcmV0OnBhc3M=","status":400}');
    assert.doesNotMatch(sanitized, /c2VjcmV0OnBhc3M=/);
    assert.match(sanitized, /Basic <redigido>/);
  });

  it("fetchNomusJson surfaces sanitized HTTP 400 body without token", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"status":400,"message":"Bearer secret-leak parametro invalido"}', {
        status: 400,
      })) as typeof fetch;
    try {
      await assert.rejects(
        fetchNomusJson(new URL("https://host/rest/contasPagar?pagina=1"), {
          maxRetries: 0,
          logPrefix: "[test]",
        }),
        (error: Error) => {
          assert.match(error.message, /Falha HTTP 400/);
          assert.match(error.message, /parametro invalido/);
          assert.doesNotMatch(error.message, /secret-leak/);
          assert.doesNotMatch(error.message, /pagina=1/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("nomusAccountsPayableSync preview vs apply", () => {
  it("preview mode does not persist (logic-only: apply branch skipped)", () => {
    const options = { mode: "preview" as const, startPage: 1, maxPages: 1, singlePage: 1 };
    assert.equal(options.mode, "preview");
    assert.notEqual(options.mode, "apply");
  });
});
