import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asBoolean,
  parseNomusBrDate,
  parseNomusBrDateTime,
  parseNomusOptionalMoney,
} from "./nomusAccountsReceivableParser.js";
import {
  mapNomusAccountsReceivablePayload,
  stableNomusPayloadHash,
} from "./nomusAccountsReceivableMapper.js";
import {
  buildAccountsReceivableSummary,
  isAccountsReceivableOpen,
} from "./nomusAccountsReceivableSummary.js";
import {
  buildAccountsReceivablePageParams,
  hasNextAccountsReceivablePage,
  pickAccountsReceivableArray,
  resolveAccountsReceivablePageSize,
  shouldStopAccountsReceivablePagination,
} from "./nomusAccountsReceivableSyncLogic.js";
import { buildNomusHeaders, buildNomusUrl, redactHeadersForLog } from "./nomusRestClient.js";
import { Prisma } from "@prisma/client";

describe("nomusAccountsReceivableParser", () => {
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

describe("nomusAccountsReceivableMapper", () => {
  const samplePayload = {
    id: 12345,
    classificacao: "RECEITA",
    cnpjPessoa: "12.345.678/0001-90",
    dataAgendamento: "01/08/2026",
    dataCompetencia: "07/2026",
    dataHoraCriacao: "03/06/2026 15:10:55",
    dataModificacao: "04/06/2026 09:00:00",
    dataVencimento: "29/07/2026",
    descricaoLancamento: "Parcela NF 100",
    idContaBancaria: 1,
    idEmpresa: 2,
    idFormaPagamento: 3,
    idPessoa: 4,
    nomeContaBancaria: "Bradesco",
    nomeEmpresa: "Empresa A",
    nomeFormaPagamento: "Boleto",
    nomePessoa: "Cliente X",
    saldoReceber: "4.252,80",
    status: false,
    tipo: 1,
    valorReceber: "4.252,80",
    valorReceberAgendado: "0,00",
    valorRecebido: "0,00",
    comentarios: "",
    percentualMultaPorAtrasoEmContasReceber: "2,00",
    suspenderCobranca: false,
    taxaMensalJuros: "1,00",
    telefonePessoa: "(11) 99999-0000",
    tipoCalculoMultaPorAtrasoEmContasReceber: "PERCENTUAL",
    tipoJurosAtrasoEmContasReceber: "SIMPLES",
    idNfe: 999,
    numeroNotaFiscalOrigem: "123456",
  };

  it("maps API payload to model fields", () => {
    const mapped = mapNomusAccountsReceivablePayload(samplePayload);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.externalId, 12345);
    assert.equal(mapped.row.personName, "Cliente X");
    assert.equal(mapped.row.balanceReceivable?.toNumber(), 4252.8);
    assert.equal(mapped.row.status, false);
    assert.equal(mapped.row.sourceInvoiceId, 999);
    assert.equal(mapped.row.sourceInvoiceNumber, "123456");
    assert.ok(mapped.row.rawPayload);
    assert.ok(mapped.row.payloadHash.length >= 32);
  });

  it("returns error when external id is missing", () => {
    const mapped = mapNomusAccountsReceivablePayload({});
    assert.equal(mapped.ok, false);
  });

  it("payloadHash detects alteration", () => {
    const first = stableNomusPayloadHash(samplePayload);
    const changed = stableNomusPayloadHash({ ...samplePayload, saldoReceber: "5.000,00" });
    assert.notEqual(first, changed);
  });
});

describe("nomusAccountsReceivableSummary", () => {
  it("computes open, overdue and next 30 days", () => {
    const today = new Date(2026, 5, 6, 12, 0, 0);
    const summary = buildAccountsReceivableSummary(
      [
        {
          balanceReceivable: new Prisma.Decimal(1000),
          amountReceived: new Prisma.Decimal(0),
          amountReceivable: new Prisma.Decimal(1000),
          status: false,
          dueDate: new Date(2026, 4, 1),
          syncedAt: new Date(2026, 5, 6),
        },
        {
          balanceReceivable: new Prisma.Decimal(500),
          amountReceived: new Prisma.Decimal(0),
          amountReceivable: new Prisma.Decimal(500),
          status: false,
          dueDate: new Date(2026, 5, 20),
          syncedAt: new Date(2026, 5, 6),
        },
        {
          balanceReceivable: new Prisma.Decimal(0),
          amountReceived: new Prisma.Decimal(800),
          amountReceivable: new Prisma.Decimal(800),
          status: true,
          dueDate: new Date(2026, 3, 1),
          syncedAt: new Date(2026, 5, 5),
        },
      ],
      today
    );

    assert.equal(summary.totalRecords, 3);
    assert.equal(summary.openCount, 2);
    assert.equal(summary.settledCount, 1);
    assert.equal(summary.overdueCount, 1);
    assert.equal(summary.dueNext30DaysCount, 1);
    assert.equal(summary.totalBalanceReceivable, 1500);
    assert.ok(summary.lastSyncedAt);
  });

  it("open uses positive balance", () => {
    assert.equal(isAccountsReceivableOpen({ balanceReceivable: new Prisma.Decimal(0.01) }), true);
    assert.equal(isAccountsReceivableOpen({ balanceReceivable: new Prisma.Decimal(0) }), false);
  });
});

describe("nomusAccountsReceivableSyncLogic", () => {
  it("pickAccountsReceivableArray reads contasReceber", () => {
    const arr = pickAccountsReceivableArray({ contasReceber: [{ id: 1 }] });
    assert.equal(arr.length, 1);
  });

  it("pickAccountsReceivableArray reads { dados: [...] } and nested data.dados", () => {
    assert.equal(pickAccountsReceivableArray({ dados: [{ id: 1 }, { id: 2 }] }).length, 2);
    assert.equal(pickAccountsReceivableArray({ data: { dados: [{ id: 9 }] } }).length, 1);
  });

  it("builds the same full BI query params as AP", () => {
    const params = buildAccountsReceivablePageParams(2, 1000, {});
    assert.equal(params.pagina, "2");
    assert.equal(params.tamanhoPagina, "1000");
    assert.equal(params.dataInicio, "01/01/2020");
    assert.equal(params.dataFim, "31/12/2030");
    assert.equal(params.apenasPendentes, "false");
    assert.equal(params.ordenacao, "dataVencimento");
  });

  it("financial page size defaults to 1000 and respects env overrides", () => {
    assert.equal(resolveAccountsReceivablePageSize({}), 1000);
    assert.equal(resolveAccountsReceivablePageSize({ NOMUS_FINANCIAL_PAGE_SIZE: "750" }), 750);
  });

  it("stops pagination when page has less than 50 items", () => {
    assert.equal(shouldStopAccountsReceivablePagination(49), true);
    assert.equal(shouldStopAccountsReceivablePagination(50), false);
    assert.equal(hasNextAccountsReceivablePage({}, 1, 50), true);
    assert.equal(hasNextAccountsReceivablePage({}, 2, 49), false);
  });
});

describe("nomusRestClient", () => {
  it("buildNomusUrl avoids duplicated /rest", () => {
    const url = buildNomusUrl("https://host/rest/", "contasReceber", { pagina: "1" });
    assert.equal(url.pathname.endsWith("/rest/contasReceber"), true);
    assert.equal(url.searchParams.get("pagina"), "1");
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
});
