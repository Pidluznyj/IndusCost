/**
 * Consulta CR Tesouraria: filtros, paginação, cancelados e valores parciais.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialNomusReceivableRow } from "./mappers/treasuryOfficialTitleMappers.js";
import type { TreasuryTitleOperationalComplementRow } from "./mappers/treasuryTitleOperationalComplementMappers.js";
import {
  createEmptyTreasuryReceivableQueryMemoryStore,
  createMemoryTreasuryReceivableQueryRepository,
} from "./repositories/treasuryReceivableQueryRepository.memory.js";
import { createTreasuryReceivableQueryService } from "./services/treasuryReceivableQueryService.server.js";
import { parseTreasuryReceivablesListQuery } from "./contracts/treasurySchemas.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";

function decimalLike(value: string): { toFixed(digits: number): string } {
  return {
    toFixed(digits: number) {
      return Number(value).toFixed(digits);
    },
  };
}

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

const REF = new Date(Date.UTC(2026, 6, 27)); // 2026-07-27

function ar(partial: Partial<OfficialNomusReceivableRow> & Pick<
  OfficialNomusReceivableRow,
  "id" | "externalId"
>): OfficialNomusReceivableRow {
  return {
    status: false,
    personId: 1,
    personName: "Cliente A",
    personCnpj: "12345678000199",
    description: "NF 100",
    competenceDate: utcDate(2026, 6, 1),
    dueDate: utcDate(2026, 7, 20),
    amountReceivable: decimalLike("1000.00"),
    balanceReceivable: decimalLike("1000.00"),
    amountReceived: decimalLike("0.00"),
    settlementDate: null,
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "100",
    sourcePresenceStatus: "PRESENT",
    sourceRemovedAt: null,
    syncedAt: new Date("2026-07-20T12:00:00.000Z"),
    rawPayload: {},
    ...partial,
  };
}

function complement(
  partial: Partial<TreasuryTitleOperationalComplementRow> &
    Pick<TreasuryTitleOperationalComplementRow, "id" | "officialTitleId" | "officialExternalId">
): TreasuryTitleOperationalComplementRow {
  const now = new Date("2026-07-21T10:00:00.000Z");
  return {
    titleType: "RECEIVABLE",
    expectedDate: utcDate(2026, 7, 28),
    confirmedDate: null,
    scheduledDate: null,
    expectedAmount: "1000.00",
    confirmedAmount: null,
    scheduledAmount: null,
    status: "ACTIVE",
    priority: "NORMAL",
    plannedAccountId: null,
    responsibleUserId: null,
    nextAction: "Cobrar",
    reason: "Acordo comercial",
    notes: null,
    version: 1,
    createdAt: now,
    createdByUserId: "u1",
    updatedAt: now,
    updatedByUserId: "u1",
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    ...partial,
  };
}

const actor = {
  userId: "u1",
  role: "ADMIN",
  isSuperAdmin: true,
  canViewReceivables: true,
};

describe("treasuryReceivableQuery — filtros e paginação", () => {
  it("filtra cliente/CNPJ/nota/vendedor e pagina", async () => {
    const store = createEmptyTreasuryReceivableQueryMemoryStore();
    store.receivables.push(
      ar({
        id: "t1",
        externalId: 1,
        personName: "Alpha Industrial",
        personCnpj: "11.222.333/0001-44",
        sourceInvoiceNumber: "45210",
        dueDate: utcDate(2026, 7, 10),
        rawPayload: { nomeVendedor: "Maria Vendas", numeroPedido: "PV-1" },
      }),
      ar({
        id: "t2",
        externalId: 2,
        personName: "Beta Comercio",
        personCnpj: "99888777000166",
        sourceInvoiceNumber: "999",
        dueDate: utcDate(2026, 7, 15),
        rawPayload: { nomeVendedor: "Joao" },
      }),
      ar({
        id: "t3",
        externalId: 3,
        personName: "Alpha Filial",
        personCnpj: "11222333000144",
        sourceInvoiceNumber: "45211",
        dueDate: utcDate(2026, 8, 1),
        rawPayload: { nomeVendedor: "Maria Vendas", idPedidoVenda: 55 },
      })
    );
    const service = createTreasuryReceivableQueryService({
      repository: createMemoryTreasuryReceivableQueryRepository(store),
    });

    const byCustomer = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({
        customerName: "Alpha",
        page: "1",
        pageSize: "1",
        sortBy: "dueDate",
      }),
      REF
    );
    assert.equal(byCustomer.pagination.totalRows, 2);
    assert.equal(byCustomer.rows.length, 1);
    assert.equal(byCustomer.rows[0]?.externalId, 1);

    const byTax = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ customerTaxId: "11222333000144" }),
      REF
    );
    assert.equal(byTax.pagination.totalRows, 2);

    const byInvoice = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ invoice: "45210" }),
      REF
    );
    assert.equal(byInvoice.rows[0]?.externalId, 1);

    const bySeller = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ sellerName: "Maria" }),
      REF
    );
    assert.equal(bySeller.pagination.totalRows, 2);

    const byOrder = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ salesOrder: "PV-1" }),
      REF
    );
    assert.equal(byOrder.rows[0]?.official.salesOrderCode, "PV-1");
  });

  it("filtra data esperada, promessa, prioridade, conta e responsável cobrança", async () => {
    const store = createEmptyTreasuryReceivableQueryMemoryStore();
    store.receivables.push(
      ar({ id: "t1", externalId: 1 }),
      ar({ id: "t2", externalId: 2, dueDate: utcDate(2026, 8, 10) }),
      ar({ id: "t3", externalId: 3 })
    );
    store.complements.push(
      complement({
        id: "c1",
        officialTitleId: "t1",
        officialExternalId: 1,
        expectedDate: utcDate(2026, 7, 28),
        confirmedDate: utcDate(2026, 7, 25),
        confirmedAmount: "500.00",
        priority: "HIGH",
        plannedAccountId: "acc-1",
        responsibleUserId: "collector-1",
        nextAction: "Enviar boleto",
      }),
      complement({
        id: "c2",
        officialTitleId: "t2",
        officialExternalId: 2,
        expectedDate: utcDate(2026, 8, 5),
        priority: "LOW",
        plannedAccountId: "acc-2",
        responsibleUserId: "collector-2",
      })
    );
    const service = createTreasuryReceivableQueryService({
      repository: createMemoryTreasuryReceivableQueryRepository(store),
    });

    const promised = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ hasPromise: "true" }),
      REF
    );
    assert.equal(promised.pagination.totalRows, 1);
    assert.equal(promised.rows[0]?.operationalStatus, "PROMISED");
    assert.equal(promised.rows[0]?.nextAction, "Enviar boleto");
    assert.equal(promised.rows[0]?.lastAction?.summary, "Acordo comercial");

    const byPriority = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ priority: "HIGH" }),
      REF
    );
    assert.equal(byPriority.rows[0]?.complement?.priority, "HIGH");

    const byAccount = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ plannedAccountId: "acc-2" }),
      REF
    );
    assert.equal(byAccount.rows[0]?.externalId, 2);

    const byOwner = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({
        collectionOwnerUserId: "collector-1",
      }),
      REF
    );
    assert.equal(byOwner.rows[0]?.externalId, 1);

    const byExpected = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({
        expectedFrom: "2026-08-01",
        expectedTo: "2026-08-31",
      }),
      REF
    );
    assert.equal(byExpected.rows[0]?.externalId, 2);
  });

  it("calcula atraso, valor aberto/recebido parcial e exclui cancelados por padrão", async () => {
    const store = createEmptyTreasuryReceivableQueryMemoryStore();
    store.receivables.push(
      ar({
        id: "open-overdue",
        externalId: 10,
        dueDate: utcDate(2026, 7, 20),
        amountReceivable: decimalLike("1000.00"),
        balanceReceivable: decimalLike("400.00"),
        amountReceived: decimalLike("600.00"),
        settlementDate: utcDate(2026, 7, 15),
      }),
      ar({
        id: "cancelled-src",
        externalId: 11,
        dueDate: utcDate(2026, 7, 1),
        sourcePresenceStatus: "MISSING_CONFIRMED",
        sourceRemovedAt: new Date("2026-07-18T00:00:00.000Z"),
      }),
      ar({
        id: "cancelled-local",
        externalId: 12,
        dueDate: utcDate(2026, 8, 1),
      })
    );
    store.complements.push(
      complement({
        id: "c-local",
        officialTitleId: "cancelled-local",
        officialExternalId: 12,
        status: "CANCELLED",
        cancelledAt: new Date("2026-07-22T00:00:00.000Z"),
        cancellationReason: "Revogado",
      })
    );

    const service = createTreasuryReceivableQueryService({
      repository: createMemoryTreasuryReceivableQueryRepository(store),
    });

    const defaultList = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({}),
      REF
    );
    assert.equal(defaultList.pagination.totalRows, 1);
    const row = defaultList.rows[0]!;
    assert.equal(row.openAmount, "400.00");
    assert.equal(row.receivedAmount, "600.00");
    assert.equal(row.daysOverdue, 7);
    assert.equal(row.operationalStatus, "OVERDUE");
    // Sem duplicar pessoa/vencimento fora de official
    assert.equal(row.official.counterparty.name, "Cliente A");
    assert.equal(row.official.dueDate, "2026-07-20");
    assert.equal(Object.prototype.hasOwnProperty.call(row, "personName"), false);

    const withCancelled = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({ includeCancelled: "true" }),
      REF
    );
    assert.equal(withCancelled.pagination.totalRows, 3);

    const byDays = await service.listReceivables(
      actor,
      parseTreasuryReceivablesListQuery({
        daysOverdueMin: "5",
        daysOverdueMax: "10",
      }),
      REF
    );
    assert.equal(byDays.rows[0]?.externalId, 10);

    const detail = await service.getReceivable(actor, "open-overdue", REF);
    assert.equal(detail.externalId, 10);

    await assert.rejects(
      () => service.getReceivable(actor, "missing"),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "NOT_FOUND"
    );
  });

  it("nega consulta sem permissão", async () => {
    const store = createEmptyTreasuryReceivableQueryMemoryStore();
    const service = createTreasuryReceivableQueryService({
      repository: createMemoryTreasuryReceivableQueryRepository(store),
    });
    await assert.rejects(
      () =>
        service.listReceivables(
          {
            userId: "x",
            role: "USER",
            isSuperAdmin: false,
            canViewReceivables: false,
          },
          parseTreasuryReceivablesListQuery({})
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
