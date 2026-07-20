/**
 * DS-06.2 — Fixtures canônicas do release candidate de Documentos de Saída.
 *
 * Cenários equivalem a evidências read-only (stage + vínculos lógicos).
 * Não consultam banco nem Nomus HTTP.
 */

import type { OutputDocumentFinancialStatusInput } from "./outputDocumentFinancialStatusResolver.js";
import type { OutputDocumentResolveEvidence } from "./nomusOutputDocumentResolver.js";
import type { ProjectOutputDocumentAllocationInput } from "./outputDocumentAllocationProjection.js";

export const OUTPUT_DOCUMENTS_RC_ORDER_A =
  "00000000-0000-4000-8000-0000000000a1";
export const OUTPUT_DOCUMENTS_RC_ORDER_B =
  "00000000-0000-4000-8000-0000000000b2";
export const OUTPUT_DOCUMENTS_RC_REF_DATE = new Date(
  "2026-07-17T12:00:00.000Z"
);

export type OutputDocumentsRcScenarioId =
  | "simple"
  | "cancelled"
  | "without_items"
  | "multi_order"
  | "partially_allocated"
  | "nfe_without_cr"
  | "cr_open"
  | "received"
  | "without_o2c"
  | "unresolved_item";

export type OutputDocumentsRcScenario = {
  id: OutputDocumentsRcScenarioId;
  label: string;
  evidence: OutputDocumentResolveEvidence;
  financial: OutputDocumentFinancialStatusInput;
  allocation: ProjectOutputDocumentAllocationInput;
  expect: {
    listedFromStage: true;
    dependsOnO2cForListing: false;
    financialStatus: string;
    orderCount: number;
    itemCount: number;
    o2cPresent: boolean;
    coverageStatus?: string;
    itemLinkStatus?: string;
    documentCancelled?: boolean;
  };
};

function header(
  externalId: number,
  overrides: Partial<OutputDocumentResolveEvidence["document"]> = {}
): OutputDocumentResolveEvidence["document"] {
  return {
    id: `doc-rc-${externalId}`,
    externalId,
    idNfe: 7208,
    tipoDocumentoEstoque: "DocumentoSaida",
    dataDocumento: new Date("2026-07-10T12:00:00.000Z"),
    documentNumber: `DS-${externalId}`,
    statusRaw: "Emitido",
    isCancelled: false,
    totalValue: "100.00",
    personExternalId: 501,
    personName: "Cliente RC",
    companyExternalId: 2,
    companyName: "KOPPETEL",
    movementDate: null,
    paymentTermsRaw: "28 DDL",
    ...overrides,
  };
}

function item(
  id: string,
  overrides: Partial<OutputDocumentResolveEvidence["items"][number]> = {}
): OutputDocumentResolveEvidence["items"][number] {
  return {
    id,
    externalItemId: 1,
    externalProductId: 100,
    quantity: "10",
    unitValue: "10.00",
    estimatedTotalValue: "100.00",
    ...overrides,
  };
}

function nfeLocal(
  overrides: Partial<NonNullable<OutputDocumentResolveEvidence["nfe"]>> = {}
): NonNullable<OutputDocumentResolveEvidence["nfe"]> {
  return {
    externalId: 7208,
    id: "nfe-rc-7208",
    numero: "7208",
    chave: "KEY7208",
    status: 1,
    foundLocally: true,
    ...overrides,
  };
}

function evidence(
  document: OutputDocumentResolveEvidence["document"],
  overrides: Partial<OutputDocumentResolveEvidence> = {}
): OutputDocumentResolveEvidence {
  return {
    document,
    items: [item(`item-rc-${document.externalId}`)],
    nfe: null,
    salesOrderNfeLinks: [],
    salesOrders: [],
    salesOrderItems: [],
    o2cFacts: [],
    receivables: [],
    ...overrides,
  };
}

function allocationFromEvidence(
  ev: OutputDocumentResolveEvidence,
  allocationLines: ProjectOutputDocumentAllocationInput["allocationLines"] = []
): ProjectOutputDocumentAllocationInput {
  return {
    document: {
      id: ev.document.id,
      externalId: ev.document.externalId,
      idNfe: ev.document.idNfe,
      totalValue: ev.document.totalValue,
      items: ev.items.map((row) => ({
        id: row.id,
        externalProductId: row.externalProductId,
        quantity: row.quantity,
        unitValue: row.unitValue,
        estimatedTotalValue: row.estimatedTotalValue,
      })),
    },
    allocationLines,
  };
}

/** Documento simples: stage + NF + 1 pedido + CR aberto. */
export function fixtureSimpleDocument(): OutputDocumentsRcScenario {
  const document = header(9101);
  const itemId = `item-rc-${document.externalId}`;
  const ev = evidence(document, {
    items: [item(itemId)],
    nfe: nfeLocal(),
    salesOrderNfeLinks: [
      {
        linkId: "link-rc-a",
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_A,
        orderCode: "PD-RC-A",
        nfeExternalId: 7208,
      },
    ],
    salesOrders: [
      {
        id: OUTPUT_DOCUMENTS_RC_ORDER_A,
        orderCode: "PD-RC-A",
        status: "OPEN",
      },
    ],
    salesOrderItems: [
      {
        id: "soi-rc-a1",
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_A,
        externalProductId: 100,
        nomusItemExternalId: 9,
      },
    ],
    receivables: [
      {
        id: "ar-rc-1",
        externalId: 8801,
        sourceInvoiceId: 7208,
        amountReceivable: "100.00",
        balanceReceivable: "100.00",
        status: true,
      },
    ],
  });
  return {
    id: "simple",
    label: "documento simples",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "100.00",
      documentTotalValue: "100.00",
      receivables: [
        {
          externalId: 8801,
          sourceInvoiceId: 7208,
          amountReceivable: "100.00",
          amountReceived: "0",
          balanceReceivable: "100.00",
          dueDate: "2026-08-01T00:00:00.000Z",
        },
      ],
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev, [
      {
        stockDocumentItemId: itemId,
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_A,
        salesOrderItemId: "soi-rc-a1",
        orderCode: "PD-RC-A",
        allocatedValueByDocumentPrice: "100.00",
        quantityUsedForOrder: "10",
      },
    ]),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "cr_em_aberto",
      orderCount: 1,
      itemCount: 1,
      o2cPresent: false,
      coverageStatus: "completo",
      itemLinkStatus: "resolved",
    },
  };
}

/** Documento cancelado no stage. */
export function fixtureCancelledDocument(): OutputDocumentsRcScenario {
  const document = header(9102, {
    isCancelled: true,
    statusRaw: "Cancelado",
  });
  const ev = evidence(document, {
    nfe: nfeLocal({ status: 7 }),
  });
  return {
    id: "cancelled",
    label: "documento cancelado",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      isCancelled: true,
      nfeStatus: 7,
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "cancelado",
      orderCount: 0,
      itemCount: 1,
      o2cPresent: false,
      documentCancelled: true,
      itemLinkStatus: "unresolved",
    },
  };
}

/** Documento sem itens de stage. */
export function fixtureDocumentWithoutItems(): OutputDocumentsRcScenario {
  const document = header(9103, { totalValue: "0.00" });
  const ev = evidence(document, { items: [], nfe: nfeLocal() });
  return {
    id: "without_items",
    label: "documento sem itens",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "0",
      receivables: [],
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "aguardando_cr",
      orderCount: 0,
      itemCount: 0,
      o2cPresent: false,
    },
  };
}

/** Documento com vários pedidos na mesma NF. */
export function fixtureDocumentMultiOrder(): OutputDocumentsRcScenario {
  const document = header(9104);
  const itemId = `item-rc-${document.externalId}`;
  const ev = evidence(document, {
    items: [item(itemId)],
    nfe: nfeLocal(),
    salesOrderNfeLinks: [
      {
        linkId: "link-rc-a",
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_A,
        orderCode: "PD-RC-A",
        nfeExternalId: 7208,
      },
      {
        linkId: "link-rc-b",
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_B,
        orderCode: "PD-RC-B",
        nfeExternalId: 7208,
      },
    ],
    salesOrders: [
      { id: OUTPUT_DOCUMENTS_RC_ORDER_A, orderCode: "PD-RC-A", status: "OPEN" },
      { id: OUTPUT_DOCUMENTS_RC_ORDER_B, orderCode: "PD-RC-B", status: "OPEN" },
    ],
  });
  return {
    id: "multi_order",
    label: "documento com vários pedidos",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "100.00",
      receivables: [
        {
          externalId: 8804,
          sourceInvoiceId: 7208,
          amountReceivable: "100.00",
          amountReceived: "0",
          balanceReceivable: "100.00",
          dueDate: "2026-08-15T00:00:00.000Z",
        },
      ],
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev, [
      {
        stockDocumentItemId: itemId,
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_A,
        salesOrderItemId: "soi-a",
        orderCode: "PD-RC-A",
        allocatedValueByDocumentPrice: "60.00",
        quantityUsedForOrder: "6",
      },
      {
        stockDocumentItemId: itemId,
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_B,
        salesOrderItemId: "soi-b",
        orderCode: "PD-RC-B",
        allocatedValueByDocumentPrice: "40.00",
        quantityUsedForOrder: "4",
      },
    ]),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "cr_em_aberto",
      orderCount: 2,
      itemCount: 1,
      o2cPresent: false,
      coverageStatus: "completo",
      itemLinkStatus: "resolved",
    },
  };
}

/** Documento parcialmente alocado (saldo não alocado). */
export function fixturePartiallyAllocatedDocument(): OutputDocumentsRcScenario {
  const document = header(9105);
  const itemId = `item-rc-${document.externalId}`;
  const ev = evidence(document, {
    items: [item(itemId)],
    nfe: nfeLocal(),
    salesOrderNfeLinks: [
      {
        linkId: "link-rc-a",
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_A,
        orderCode: "PD-RC-A",
        nfeExternalId: 7208,
      },
    ],
    salesOrders: [
      { id: OUTPUT_DOCUMENTS_RC_ORDER_A, orderCode: "PD-RC-A", status: "OPEN" },
    ],
    o2cFacts: [
      {
        runId: "o2c-rc-partial",
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_A,
        orderCode: "PD-RC-A",
        salesOrderItemId: "soi-rc-a1",
        nfeExternalId: 7208,
        stockDocumentExternalId: document.externalId,
        stockDocumentIdNfe: 7208,
        stockDocumentItemId: itemId,
        allocatedValueByDocumentPrice: "40.00",
        quantityUsedForOrder: "4",
        receivableIds: [],
      },
    ],
  });
  return {
    id: "partially_allocated",
    label: "documento parcialmente alocado",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "100.00",
      receivables: [],
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev, [
      {
        stockDocumentItemId: itemId,
        salesOrderId: OUTPUT_DOCUMENTS_RC_ORDER_A,
        salesOrderItemId: "soi-rc-a1",
        allocatedValueByDocumentPrice: "40.00",
        quantityUsedForOrder: "4",
      },
    ]),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "aguardando_cr",
      orderCount: 1,
      itemCount: 1,
      o2cPresent: true,
      coverageStatus: "parcial",
      itemLinkStatus: "partial",
    },
  };
}

/** NF presente, sem títulos CR. */
export function fixtureNfeWithoutCr(): OutputDocumentsRcScenario {
  const document = header(9106);
  const ev = evidence(document, { nfe: nfeLocal(), receivables: [] });
  return {
    id: "nfe_without_cr",
    label: "documento com NF sem CR",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "100.00",
      receivables: [],
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "aguardando_cr",
      orderCount: 0,
      itemCount: 1,
      o2cPresent: false,
      itemLinkStatus: "unresolved",
    },
  };
}

/** CR em aberto. */
export function fixtureCrOpen(): OutputDocumentsRcScenario {
  const document = header(9107);
  const ev = evidence(document, {
    nfe: nfeLocal(),
    receivables: [
      {
        id: "ar-rc-open",
        externalId: 8807,
        sourceInvoiceId: 7208,
        amountReceivable: "100.00",
        balanceReceivable: "100.00",
        status: true,
      },
    ],
  });
  return {
    id: "cr_open",
    label: "documento com CR aberto",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "100.00",
      receivables: [
        {
          externalId: 8807,
          sourceInvoiceId: 7208,
          amountReceivable: "100.00",
          amountReceived: "0",
          balanceReceivable: "100.00",
          dueDate: "2026-09-01T00:00:00.000Z",
        },
      ],
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "cr_em_aberto",
      orderCount: 0,
      itemCount: 1,
      o2cPresent: false,
      itemLinkStatus: "unresolved",
    },
  };
}

/** Documento com CR recebido. */
export function fixtureReceivedDocument(): OutputDocumentsRcScenario {
  const document = header(9108);
  const ev = evidence(document, {
    nfe: nfeLocal(),
    receivables: [
      {
        id: "ar-rc-paid",
        externalId: 8808,
        sourceInvoiceId: 7208,
        amountReceivable: "100.00",
        balanceReceivable: "0",
        status: true,
      },
    ],
  });
  return {
    id: "received",
    label: "documento recebido",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "100.00",
      receivables: [
        {
          externalId: 8808,
          sourceInvoiceId: 7208,
          amountReceivable: "100.00",
          amountReceived: "100.00",
          balanceReceivable: "0",
          dueDate: "2026-06-01T00:00:00.000Z",
          settlementDate: "2026-06-05T00:00:00.000Z",
        },
      ],
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "recebido",
      orderCount: 0,
      itemCount: 1,
      o2cPresent: false,
      itemLinkStatus: "unresolved",
    },
  };
}

/** Stage listável sem materialização O2C. */
export function fixtureWithoutO2c(): OutputDocumentsRcScenario {
  const document = header(9109, { idNfe: null, totalValue: "50.00" });
  const ev = evidence(document, {
    document,
    items: [
      item(`item-rc-${document.externalId}`, {
        quantity: "5",
        unitValue: "10.00",
        estimatedTotalValue: "50.00",
      }),
    ],
    nfe: null,
    o2cFacts: [],
  });
  return {
    id: "without_o2c",
    label: "documento sem O2C",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: null,
      documentTotalValue: "50.00",
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "sem_informacao_financeira",
      orderCount: 0,
      itemCount: 1,
      o2cPresent: false,
      itemLinkStatus: "unresolved",
    },
  };
}

/** Item de stage sem vínculo a pedido. */
export function fixtureUnresolvedItem(): OutputDocumentsRcScenario {
  const document = header(9110);
  const itemId = `item-rc-${document.externalId}`;
  const ev = evidence(document, {
    items: [item(itemId)],
    nfe: nfeLocal(),
  });
  return {
    id: "unresolved_item",
    label: "item não resolvido",
    evidence: ev,
    financial: {
      stockDocumentExternalId: document.externalId,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "100.00",
      receivables: [],
      referenceDate: OUTPUT_DOCUMENTS_RC_REF_DATE,
    },
    allocation: allocationFromEvidence(ev, []),
    expect: {
      listedFromStage: true,
      dependsOnO2cForListing: false,
      financialStatus: "aguardando_cr",
      orderCount: 0,
      itemCount: 1,
      o2cPresent: false,
      coverageStatus: "nao_alocado",
      itemLinkStatus: "unresolved",
    },
  };
}

export function allOutputDocumentsRcScenarios(): OutputDocumentsRcScenario[] {
  return [
    fixtureSimpleDocument(),
    fixtureCancelledDocument(),
    fixtureDocumentWithoutItems(),
    fixtureDocumentMultiOrder(),
    fixturePartiallyAllocatedDocument(),
    fixtureNfeWithoutCr(),
    fixtureCrOpen(),
    fixtureReceivedDocument(),
    fixtureWithoutO2c(),
    fixtureUnresolvedItem(),
  ];
}
