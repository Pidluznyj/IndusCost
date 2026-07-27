/**
 * Consulta CP Tesouraria: filtros, paginação, CC e programação.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialNomusPayableRow } from "./mappers/treasuryOfficialTitleMappers.js";
import type { TreasuryTitleOperationalComplementRow } from "./mappers/treasuryTitleOperationalComplementMappers.js";
import {
  createEmptyTreasuryPayableQueryMemoryStore,
  createMemoryTreasuryPayableQueryRepository,
} from "./repositories/treasuryPayableQueryRepository.memory.js";
import { createTreasuryPayableQueryService } from "./services/treasuryPayableQueryService.server.js";
import { parseTreasuryPayablesListQuery } from "./contracts/treasurySchemas.js";
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

const REF = new Date(Date.UTC(2026, 6, 27));

function ap(
  partial: Partial<OfficialNomusPayableRow> &
    Pick<OfficialNomusPayableRow, "id" | "externalId">
): OfficialNomusPayableRow {
  return {
    status: false,
    personId: 1,
    personName: "Fornecedor A",
    personCnpj: "98765432000155",
    description: "NF 100",
    documentNumber: "DOC-100",
    classification: "Material",
    comments: "Obs oficial",
    competenceDate: utcDate(2026, 6, 1),
    dueDate: utcDate(2026, 7, 20),
    scheduleDate: null,
    amountPayable: decimalLike("1000.00"),
    balancePayable: decimalLike("1000.00"),
    amountPaid: decimalLike("0.00"),
    amountScheduled: null,
    settlementDate: null,
    paymentDate: null,
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
    Pick<
      TreasuryTitleOperationalComplementRow,
      "id" | "officialTitleId" | "officialExternalId"
    >
): TreasuryTitleOperationalComplementRow {
  const now = new Date("2026-07-21T10:00:00.000Z");
  return {
    titleType: "PAYABLE",
    expectedDate: null,
    confirmedDate: null,
    scheduledDate: utcDate(2026, 8, 5),
    expectedAmount: null,
    confirmedAmount: null,
    scheduledAmount: "500.00",
    status: "ACTIVE",
    priority: "HIGH",
    plannedAccountId: "acc-1",
    responsibleUserId: "user-pay",
    nextAction: "Programar",
    reason: null,
    notes: "Obs local",
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
  canViewPayables: true,
};

describe("treasuryPayableQuery — filtros e paginação", () => {
  it("filtra fornecedor/CNPJ/documento/categoria/CC e pagina", async () => {
    const store = createEmptyTreasuryPayableQueryMemoryStore();
    store.payables.push(
      ap({
        id: "p1",
        externalId: 1,
        personName: "Alpha Suprimentos",
        documentNumber: "NF-AA",
        classification: "Serviços",
      }),
      ap({
        id: "p2",
        externalId: 2,
        personName: "Beta Insumos",
        personCnpj: "11111111000111",
        documentNumber: "NF-BB",
        classification: "Material",
      }),
      ap({
        id: "p3",
        externalId: 3,
        personName: "Alpha Filial",
        documentNumber: "DOC-CC",
        classification: "Material",
      })
    );
    store.costCenters.push(
      {
        accountsPayableId: 1,
        costCenterId: "cc-adm",
        costCenterCode: "ADM",
        costCenterName: "Administrativo",
        percentage: 100,
      },
      {
        accountsPayableId: 2,
        costCenterId: "cc-prod",
        costCenterCode: "PROD",
        costCenterName: "Produção",
        percentage: 100,
      }
    );

    const service = createTreasuryPayableQueryService({
      repository: createMemoryTreasuryPayableQueryRepository(store),
    });

    const byName = await service.listPayables(
      actor,
      parseTreasuryPayablesListQuery({ supplierName: "Alpha", pageSize: 10 }),
      REF
    );
    assert.equal(byName.rows.length, 2);

    const byDoc = await service.listPayables(
      actor,
      parseTreasuryPayablesListQuery({ document: "NF-BB" }),
      REF
    );
    assert.equal(byDoc.rows[0]?.externalId, 2);

    const byClass = await service.listPayables(
      actor,
      parseTreasuryPayablesListQuery({ classification: "Serviços" }),
      REF
    );
    assert.equal(byClass.rows.length, 1);
    assert.equal(byClass.rows[0]?.classification, "Serviços");

    const byCc = await service.listPayables(
      actor,
      parseTreasuryPayablesListQuery({ costCenter: "Produção" }),
      REF
    );
    assert.equal(byCc.rows.length, 1);
    assert.equal(byCc.rows[0]?.costCenterLabel, "PROD — Produção");

    const page1 = await service.listPayables(
      actor,
      parseTreasuryPayablesListQuery({ page: 1, pageSize: 2 }),
      REF
    );
    assert.equal(page1.rows.length, 2);
    assert.equal(page1.pagination.totalPages, 2);
  });

  it("retorna programação, conta, prioridade, observações e status PROGRAMMED", async () => {
    const store = createEmptyTreasuryPayableQueryMemoryStore();
    store.payables.push(
      ap({
        id: "p1",
        externalId: 10,
        dueDate: utcDate(2026, 7, 10),
        balancePayable: decimalLike("400.00"),
        amountPaid: decimalLike("600.00"),
      })
    );
    store.complements.push(
      complement({
        id: "c1",
        officialTitleId: "p1",
        officialExternalId: 10,
      })
    );

    const service = createTreasuryPayableQueryService({
      repository: createMemoryTreasuryPayableQueryRepository(store),
    });

    const detail = await service.getPayable(actor, "p1", REF);
    assert.equal(detail.openAmount, "400.00");
    assert.equal(detail.paidAmount, "600.00");
    assert.equal(detail.official.originalAmount, "1000.00");
    assert.equal(detail.scheduledDate, "2026-08-05");
    assert.equal(detail.scheduledAmount, "500.00");
    assert.equal(detail.plannedAccountId, "acc-1");
    assert.equal(detail.priority, "HIGH");
    assert.equal(detail.notes, "Obs local");
    assert.equal(detail.operationalStatus, "PROGRAMMED");
    assert.ok(detail.daysOverdue > 0);

    const programmed = await service.listPayables(
      actor,
      parseTreasuryPayablesListQuery({
        scheduledFrom: "2026-08-01",
        scheduledTo: "2026-08-31",
        priority: "HIGH",
        plannedAccountId: "acc-1",
        responsibleUserId: "user-pay",
      }),
      REF
    );
    assert.equal(programmed.rows.length, 1);
  });

  it("usa schedule Nomus quando não há complemento e nega sem permissão", async () => {
    const store = createEmptyTreasuryPayableQueryMemoryStore();
    store.payables.push(
      ap({
        id: "p1",
        externalId: 11,
        scheduleDate: utcDate(2026, 8, 1),
        amountScheduled: decimalLike("200.00"),
        comments: "Só oficial",
      })
    );
    const service = createTreasuryPayableQueryService({
      repository: createMemoryTreasuryPayableQueryRepository(store),
    });
    const detail = await service.getPayable(actor, "p1", REF);
    assert.equal(detail.scheduledDate, "2026-08-01");
    assert.equal(detail.scheduledAmount, "200.00");
    assert.equal(detail.notes, "Só oficial");
    assert.equal(detail.operationalStatus, "PROGRAMMED");

    await assert.rejects(
      () =>
        service.listPayables(
          { ...actor, isSuperAdmin: false, canViewPayables: false },
          parseTreasuryPayablesListQuery({})
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
