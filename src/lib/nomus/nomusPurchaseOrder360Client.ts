export type NomusPurchaseOrder360Supplier = {
  nomusExternalId: number | null;
  nomusName: string | null;
  nomusDocument: string | null;
  resolvedName: string | null;
  resolvedDocument: string | null;
  financialSupplierId: string | null;
  matchMethod: string;
  matchConfidence: string;
  matched: boolean;
  ambiguous: boolean;
};

export type NomusPurchaseOrder360Detail = {
  order: {
    id: string;
    externalId: number;
    orderNumber: string | null;
    statusRaw: string | null;
    canceled: boolean | null;
    stage: string;
    issuedAt: string | null;
    expectedAt: string | null;
    overdue: boolean;
    paymentTerms: string | null;
    comments: string | null;
    header: Record<string, unknown>;
  };
  supplier: NomusPurchaseOrder360Supplier;
  items: Array<{
    id: string;
    lineCode: string | null;
    productExternalId: number | null;
    productCode: string | null;
    description: string | null;
    descriptionSource: string | null;
    unit: string | null;
    orderedQuantity: number | null;
    receivedQuantity: number | null;
    remainingQuantity: number | null;
    unitPrice: number | null;
    discountPercent: number | null;
    discountAmount: number | null;
    surchargePercent: number | null;
    surchargeAmount: number | null;
    totalAmount: number | null;
    deliveryDate: string | null;
    comments: string | null;
    itemStatusCode: number | null;
    itemStatusLabel: string | null;
    unitId: number | null;
    entrySectorId: number | null;
    financialClassificationId: number | null;
    movementTypeId: number | null;
  }>;
  plannedInstallments: Array<{
    index: number;
    dueDate: string | null;
    dueDateRaw: string | null;
    amount: number | null;
    paymentMethodId: number | null;
    bankAccountId: number | null;
    generatesAdvance: boolean | null;
  }>;
  receiving: {
    stage: string;
    itemCount: number;
    waitingRelease: number;
    released: number;
    partial: number;
    received: number;
    receivedWithCut: number;
    canceled: number;
    returnedPartial: number;
    returnedFull: number;
    receivingQuantityAvailable: boolean;
  };
  fiscal: {
    invoices: Array<{
      externalId: number;
      number: string | null;
      series: string | null;
      key: string | null;
      issuedAt: string | null;
      processedAt: string | null;
      issuerDocument: string | null;
      status: number | null;
      operationType: number | null;
      amount: number | null;
      canceled: boolean;
      foundLocally: boolean;
    }>;
    unresolvedLabel: string | null;
  };
  confirmedPayables: Array<{
    externalId: number;
    sourceInvoiceNumber: string | null;
    personName: string | null;
    dueDate: string | null;
    paymentDate: string | null;
    settlementDate: string | null;
    amountPayable: number | null;
    amountPaid: number | null;
    balancePayable: number | null;
    paymentMethodName: string | null;
    hasBoletoDocument: boolean;
    boletoIsPaymentMethodOnly: boolean;
  }>;
  financialSummary: {
    plannedInstallmentsTotal: number | null;
    plannedInstallmentsCount: number;
    financialStatus: string;
    count: number;
    confirmedAmount: number;
    paidAmount: number;
    openAmount: number;
    hasBoletoDocument: boolean;
  };
  relationEvidence: Array<{ method: string; confidence: string; source: string; detail: string }>;
  syncMetadata: {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    syncedAt: string | null;
    payloadHash: string | null;
    createdAtNomus: string | null;
    modifiedAtNomus: string | null;
  };
  rawPayload?: unknown;
};
