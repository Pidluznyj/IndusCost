/**
 * DS-04.1 — Testes do parser de filtros/paginação/ordenação.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OutputDocumentsListQueryError,
  parseOutputDocumentsListQuery,
  resolveOutputDocumentsEmissionDateBounds,
  serializeOutputDocumentsListFilters,
} from "./outputDocumentsListQuery.js";

describe("parseOutputDocumentsListQuery", () => {
  it("aplica defaults de paginação (page=1, pageSize=50)", () => {
    const q = parseOutputDocumentsListQuery({});
    assert.equal(q.page, 1);
    assert.equal(q.pageSize, 50);
    assert.equal(q.skip, 0);
    assert.equal(q.sortBy, "dataDocumento");
    assert.equal(q.sortDir, "desc");
    assert.equal(q.cancelled, "all");
    assert.equal(q.hasReceivable, "all");
    assert.equal(q.financialStatus, null);
    assert.equal(q.year, null);
    assert.equal(q.month, null);
  });

  it("interpreta year/month no padrão Pedidos (emissão dataDocumento)", () => {
    const q = parseOutputDocumentsListQuery({ year: "2026", month: "7" });
    assert.equal(q.year, 2026);
    assert.equal(q.month, 7);
    const bounds = resolveOutputDocumentsEmissionDateBounds(q);
    assert.ok(bounds);
    assert.equal(bounds!.gte!.getFullYear(), 2026);
    assert.equal(bounds!.gte!.getMonth(), 6);
    assert.equal(bounds!.gte!.getDate(), 1);
    assert.equal(bounds!.lt!.getFullYear(), 2026);
    assert.equal(bounds!.lt!.getMonth(), 7);
    assert.equal(bounds!.lt!.getDate(), 1);
  });

  it("ano sozinho cobre o calendário inteiro", () => {
    const bounds = resolveOutputDocumentsEmissionDateBounds({
      from: null,
      to: null,
      year: 2026,
      month: null,
    });
    assert.ok(bounds);
    assert.equal(bounds!.gte!.getFullYear(), 2026);
    assert.equal(bounds!.gte!.getMonth(), 0);
    assert.equal(bounds!.lt!.getFullYear(), 2027);
    assert.equal(bounds!.lt!.getMonth(), 0);
  });

  it("clampa pageSize em 200 e calcula skip", () => {
    const q = parseOutputDocumentsListQuery({ page: "3", pageSize: "999" });
    assert.equal(q.page, 3);
    assert.equal(q.pageSize, 200);
    assert.equal(q.skip, 400);
  });

  it("interpreta from/to e aliases startDate/endDate", () => {
    const q = parseOutputDocumentsListQuery({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    assert.ok(q.from);
    assert.ok(q.to);
    assert.equal(q.from!.getFullYear(), 2026);
    assert.equal(q.from!.getMonth(), 0);
    assert.equal(q.from!.getDate(), 1);
    assert.equal(q.to!.getDate(), 31);
    assert.equal(q.to!.getHours(), 23);

    const q2 = parseOutputDocumentsListQuery({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    assert.equal(q2.from!.getMonth(), 1);
    assert.equal(q2.to!.getDate(), 28);
  });

  it("rejeita intervalo invertido", () => {
    assert.throws(
      () =>
        parseOutputDocumentsListQuery({
          from: "2026-03-01",
          to: "2026-01-01",
        }),
      OutputDocumentsListQueryError
    );
  });

  it("interpreta busca, empresa, cliente, status, pedido, NF-e", () => {
    const q = parseOutputDocumentsListQuery({
      search: "  PD02590  ",
      company: "Koppetel",
      customer: "Cliente X",
      customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      status: "Aberto",
      order: "PD02590",
      nfe: "12345",
      idNfe: "7208",
      companyExternalId: "10",
      personExternalId: "20",
    });
    assert.equal(q.search, "PD02590");
    assert.equal(q.company, "Koppetel");
    assert.equal(q.customer, "Cliente X");
    assert.equal(q.customerId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.equal(q.status, "Aberto");
    assert.equal(q.order, "PD02590");
    assert.equal(q.nfe, "12345");
    assert.equal(q.idNfe, 7208);
    assert.equal(q.companyExternalId, 10);
    assert.equal(q.personExternalId, 20);
  });

  it("ignora customerId que não é UUID", () => {
    const q = parseOutputDocumentsListQuery({ customerId: "20" });
    assert.equal(q.customerId, null);
  });

  it("interpreta cancelado e com/sem CR (tri-state)", () => {
    assert.equal(
      parseOutputDocumentsListQuery({ cancelled: "true" }).cancelled,
      "yes"
    );
    assert.equal(
      parseOutputDocumentsListQuery({ isCancelled: "nao" }).cancelled,
      "no"
    );
    assert.equal(
      parseOutputDocumentsListQuery({ hasReceivable: "com" }).hasReceivable,
      "yes"
    );
    assert.equal(
      parseOutputDocumentsListQuery({ comCr: "sem" }).hasReceivable,
      "no"
    );
  });

  it("interpreta situação financeira oficial", () => {
    const q = parseOutputDocumentsListQuery({
      financialStatus: "aguardando_cr",
    });
    assert.equal(q.financialStatus, "aguardando_cr");

    assert.throws(
      () => parseOutputDocumentsListQuery({ situacaoFinanceira: "inventado" }),
      OutputDocumentsListQueryError
    );
  });

  it("interpreta ordenação", () => {
    const q = parseOutputDocumentsListQuery({
      sortBy: "totalValue",
      sortDir: "asc",
    });
    assert.equal(q.sortBy, "totalValue");
    assert.equal(q.sortDir, "asc");

    assert.throws(
      () => parseOutputDocumentsListQuery({ orderBy: "foo" }),
      OutputDocumentsListQueryError
    );
  });

  it("serializa filtros com datas ISO", () => {
    const q = parseOutputDocumentsListQuery({
      from: "2026-01-01",
      page: "2",
      pageSize: "25",
    });
    const serialized = serializeOutputDocumentsListFilters(q);
    assert.equal(serialized.page, 2);
    assert.equal(serialized.pageSize, 25);
    assert.ok(serialized.from?.startsWith("2026-01-01"));
    assert.equal(serialized.to, null);
    assert.equal("skip" in serialized, false);
  });
});
