import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSupplierName } from "@/src/lib/financeSupplierIdentity.js";
import {
  buildPurchaseOrderFinancialBundle,
  classifyPurchaseOrderFinancialStatus,
  extractDirectNomusNfeRefs,
  extractDocumentEntryPurchaseOrderId,
  formatSupplierDisplayName,
  isBoletoPaymentMethod,
  matchesPurchaseOrderFinancialFilter,
  matchesPurchaseOrderFiscalFilter,
  parsePurchaseOrderPlannedInstallments,
  resolvePurchaseOrderSupplier,
  sumPlannedInstallmentsTotal,
  summarizeConfirmedPayables,
  type ConfirmedPayableSnapshot,
} from "./nomusPurchaseOrder360.js";

const PC00612_RAW = {
  codigoPedido: "PC00612",
  dataEmissao: "02/09/2026",
  dataEntregaPadrao: "11/09/2026",
  id: 613,
  idPessoaFornecedor: 215,
  itensPedidoCompra: [
    {
      idProduto: 1292,
      item: "000010",
      quantidade: "50",
      status: 2,
      valorUnitario: "62,77",
    },
  ],
  parcelas: [
    { dataVencimento: "16/10/2026", geraAdiantamento: false, idFormaPagamento: 10, valorParcela: "1.136,68" },
    { dataVencimento: "30/10/2026", geraAdiantamento: false, idFormaPagamento: 10, valorParcela: "1.136,68" },
    { dataVencimento: "09/11/2026", geraAdiantamento: false, idFormaPagamento: 10, valorParcela: "1.171,14" },
  ],
};

function payable(overrides: Partial<ConfirmedPayableSnapshot> = {}): ConfirmedPayableSnapshot {
  return {
    externalId: 9001,
    sourceInvoiceId: 7781,
    sourceInvoiceNumber: "64924",
    personId: 215,
    personName: "SULIFLEX IND. E COM. DE PLASTICOS LTDA",
    personCnpj: "12345678000190",
    dueDate: new Date("2026-10-16"),
    paymentDate: null,
    settlementDate: null,
    amountPayable: 1136.68,
    amountPaid: 0,
    balancePayable: 1136.68,
    paymentMethodName: "Boleto Bancário",
    description: null,
    comments: null,
    classification: null,
    nomusStatus: false,
    suspendPayment: false,
    ...overrides,
  };
}

describe("nomusPurchaseOrder360 planned installments", () => {
  it("PC00612 soma exatamente as 3 parcelas e não chama isso valor oficial", () => {
    const rows = parsePurchaseOrderPlannedInstallments(PC00612_RAW);
    assert.equal(rows.length, 3);
    assert.equal(sumPlannedInstallmentsTotal(rows), 3444.5);
    const bundle = buildPurchaseOrderFinancialBundle({
      rawPayload: PC00612_RAW,
      invoices: [],
      confirmedPayables: [],
    });
    assert.equal(bundle.financialStatus, "PLANNED_ONLY");
    assert.equal(bundle.plannedInstallmentsTotal, 3444.5);
  });
});

describe("nomusPurchaseOrder360 supplier", () => {
  it("1. alias externo exato", () => {
    const resolved = resolvePurchaseOrderSupplier({
      supplierExternalId: 215,
      supplierName: null,
      supplierTaxId: null,
      aliases: [
        {
          externalSupplierId: 215,
          financialSupplierId: "fs-1",
          displayName: "SULIFLEX IND. E COM. DE PLASTICOS LTDA",
          document: "12.345.678/0001-90",
          normalizedDocument: "12345678000190",
          normalizedName: "suliflex",
        },
      ],
      documents: [],
      apIdentities: [],
      nameCandidates: [],
    });
    assert.equal(resolved.matchMethod, "SUPPLIER_ALIAS");
    assert.equal(resolved.matchConfidence, "EXACT");
    assert.equal(resolved.resolvedName, "SULIFLEX IND. E COM. DE PLASTICOS LTDA");
    assert.equal(resolved.ambiguous, false);
  });

  it("2. documento fiscal exato", () => {
    const resolved = resolvePurchaseOrderSupplier({
      supplierExternalId: 215,
      supplierName: null,
      supplierTaxId: "12.345.678/0001-90",
      aliases: [],
      documents: [
        {
          financialSupplierId: "fs-2",
          displayName: "SULIFLEX IND. E COM. DE PLASTICOS LTDA",
          document: "12.345.678/0001-90",
          normalizedDocument: "12345678000190",
        },
      ],
      apIdentities: [],
      nameCandidates: [],
    });
    assert.equal(resolved.matchMethod, "SUPPLIER_DOCUMENT");
    assert.equal(resolved.matchConfidence, "EXACT");
    assert.equal(resolved.matched, true);
  });

  it("3. identidade Nomus via AP (215 -> SULIFLEX)", () => {
    const resolved = resolvePurchaseOrderSupplier({
      supplierExternalId: 215,
      supplierName: null,
      supplierTaxId: null,
      aliases: [],
      documents: [],
      apIdentities: [
        {
          personId: 215,
          personName: "SULIFLEX IND. E COM. DE PLASTICOS LTDA",
          personCnpj: "12345678000190",
        },
      ],
      nameCandidates: [],
    });
    assert.equal(resolved.matchMethod, "SUPPLIER_AP_IDENTITY");
    assert.equal(resolved.resolvedName, "SULIFLEX IND. E COM. DE PLASTICOS LTDA");
    assert.equal(resolved.financialSupplierId, null);
  });

  it("4. nome fallback único", () => {
    const resolved = resolvePurchaseOrderSupplier({
      supplierExternalId: 99,
      supplierName: "Fornecedor Unico LTDA",
      supplierTaxId: null,
      aliases: [],
      documents: [],
      apIdentities: [],
      nameCandidates: [
        {
          financialSupplierId: "fs-3",
          displayName: "Fornecedor Unico LTDA",
          normalizedName: normalizeSupplierName("Fornecedor Unico LTDA"),
        },
      ],
    });
    assert.equal(resolved.matchMethod, "NAME_FALLBACK");
    assert.equal(resolved.matchConfidence, "FALLBACK");
  });

  it("5. nome ambíguo não escolhe", () => {
    const resolved = resolvePurchaseOrderSupplier({
      supplierExternalId: 99,
      supplierName: "Fornecedor Ambiguo",
      supplierTaxId: null,
      aliases: [],
      documents: [],
      apIdentities: [],
      nameCandidates: [
        {
          financialSupplierId: "a",
          displayName: "Fornecedor Ambiguo",
          normalizedName: normalizeSupplierName("Fornecedor Ambiguo"),
        },
        {
          financialSupplierId: "b",
          displayName: "Fornecedor Ambiguo 2",
          normalizedName: normalizeSupplierName("Fornecedor Ambiguo"),
        },
      ],
    });
    assert.equal(resolved.matchMethod, "UNRESOLVED");
    assert.equal(resolved.ambiguous, true);
    assert.equal(resolved.financialSupplierId, null);
  });

  it("6. nenhum match", () => {
    const resolved = resolvePurchaseOrderSupplier({
      supplierExternalId: 999,
      supplierName: null,
      supplierTaxId: null,
      aliases: [],
      documents: [],
      apIdentities: [],
      nameCandidates: [],
    });
    assert.equal(resolved.matchMethod, "UNRESOLVED");
    assert.equal(resolved.matched, false);
    assert.equal(
      formatSupplierDisplayName({
        resolvedName: resolved.resolvedName,
        nomusName: resolved.nomusName,
        supplierExternalId: 999,
      }),
      "Fornecedor Nomus #999"
    );
  });
});

describe("nomusPurchaseOrder360 financeiro", () => {
  it("1. parcelas sem CP -> PLANNED_ONLY", () => {
    const bundle = buildPurchaseOrderFinancialBundle({
      rawPayload: PC00612_RAW,
      invoices: [],
      confirmedPayables: [],
    });
    assert.equal(bundle.financialStatus, "PLANNED_ONLY");
    assert.equal(bundle.confirmedPayables.length, 0);
  });

  it("2. NF direta + CP por sourceInvoiceId -> CONFIRMED", () => {
    const bundle = buildPurchaseOrderFinancialBundle({
      rawPayload: { ...PC00612_RAW, nfes: [{ id: 7781, numero: "64924" }] },
      invoices: [
        {
          externalId: 7781,
          number: "64924",
          series: "1",
          key: null,
          issuedAt: null,
          processedAt: null,
          issuerDocument: null,
          status: 100,
          operationType: 0,
          amount: 3444.5,
          canceled: false,
          foundLocally: true,
          relationMethod: "DIRECT_NOMUS_NFE",
          confidence: "EXACT",
        },
      ],
      confirmedPayables: [payable(), payable({ externalId: 9002, amountPayable: 1136.68, amountPaid: 0, balancePayable: 1136.68 }), payable({ externalId: 9003, amountPayable: 1171.14, amountPaid: 0, balancePayable: 1171.14 })],
    });
    assert.equal(bundle.financialStatus, "CONFIRMED");
    assert.ok(bundle.relationEvidence.some((row) => row.method === "NFE_TO_AP"));
  });

  it("3. parte paga -> PARTIALLY_PAID", () => {
    assert.equal(
      classifyPurchaseOrderFinancialStatus({
        plannedCount: 3,
        confirmedCount: 1,
        allSettled: false,
        anyPaid: true,
        anyOpen: true,
      }),
      "PARTIALLY_PAID"
    );
  });

  it("4. todos pagos -> PAID", () => {
    const summary = summarizeConfirmedPayables([
      payable({ amountPaid: 1136.68, balancePayable: 0 }),
    ]);
    assert.equal(summary.allSettled, true);
    assert.equal(
      classifyPurchaseOrderFinancialStatus({
        plannedCount: 3,
        confirmedCount: 1,
        allSettled: true,
        anyPaid: true,
        anyOpen: false,
      }),
      "PAID"
    );
  });

  it("5. supplier igual sem NFe link NÃO vincula CP", () => {
    const bundle = buildPurchaseOrderFinancialBundle({
      rawPayload: PC00612_RAW,
      invoices: [],
      confirmedPayables: [],
    });
    assert.equal(bundle.confirmedPayables.length, 0);
    assert.equal(bundle.financialStatus, "PLANNED_ONLY");
  });

  it("6. NF diferente do mesmo fornecedor NÃO vincula", () => {
    const refs = extractDirectNomusNfeRefs({ nfes: [{ id: 7781 }] });
    assert.deepEqual(refs.map((row) => row.externalId), [7781]);
    assert.ok(!refs.some((row) => row.externalId === 9999));
  });

  it("7. Boleto Bancário é só forma de pagamento", () => {
    const summary = summarizeConfirmedPayables([payable()]);
    assert.equal(summary.hasBoletoDocument, false);
    assert.equal(isBoletoPaymentMethod("Boleto Bancário"), true);
  });
});

describe("nomusPurchaseOrder360 fiscal", () => {
  it("raw.nfes vazio", () => {
    assert.deepEqual(extractDirectNomusNfeRefs({ nfes: [] }), []);
    assert.equal(matchesPurchaseOrderFiscalFilter(0, "WITHOUT_NFE"), true);
  });

  it("raw.nfes ausente", () => {
    assert.deepEqual(extractDirectNomusNfeRefs({ id: 613 }), []);
    assert.deepEqual(extractDirectNomusNfeRefs(null), []);
  });

  it("uma NF e múltiplas NFs", () => {
    assert.equal(extractDirectNomusNfeRefs({ nfes: [7781] }).length, 1);
    assert.equal(
      extractDirectNomusNfeRefs({ nfes: [{ id: 1, numero: "A" }, { idNfe: 2, numero: "B" }] }).length,
      2
    );
  });

  it("NF cancelada e ID sem registro local permanecem no contrato", () => {
    const bundle = buildPurchaseOrderFinancialBundle({
      rawPayload: { nfes: [10] },
      invoices: [
        {
          externalId: 10,
          number: null,
          series: null,
          key: null,
          issuedAt: null,
          processedAt: null,
          issuerDocument: null,
          status: null,
          operationType: null,
          amount: null,
          canceled: true,
          foundLocally: false,
          relationMethod: "DIRECT_NOMUS_NFE",
          confidence: "EXACT",
        },
      ],
      confirmedPayables: [],
    });
    assert.equal(bundle.invoices[0]?.canceled, true);
    assert.equal(bundle.invoices[0]?.foundLocally, false);
  });

  it("sourceInvoiceId da NF vinculada é o elo canônico do CP", () => {
    const bundle = buildPurchaseOrderFinancialBundle({
      rawPayload: { nfes: [7781] },
      invoices: [
        {
          externalId: 7781,
          number: "64924",
          series: null,
          key: null,
          issuedAt: null,
          processedAt: null,
          issuerDocument: null,
          status: null,
          operationType: null,
          amount: null,
          canceled: false,
          foundLocally: true,
          relationMethod: "DIRECT_NOMUS_NFE",
          confidence: "EXACT",
        },
      ],
      confirmedPayables: [payable()],
    });
    assert.equal(bundle.confirmedPayables[0]?.sourceInvoiceId, 7781);
    assert.ok(matchesPurchaseOrderFinancialFilter(bundle.financialStatus, "CONFIRMED"));
  });

  it("documento de estoque só liga se houver idPedidoCompra explícito", () => {
    assert.equal(extractDocumentEntryPurchaseOrderId({ idNfe: 7781 }), null);
    assert.equal(extractDocumentEntryPurchaseOrderId({ idPedidoCompra: 613 }), 613);
  });
});
