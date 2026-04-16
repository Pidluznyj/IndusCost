import assert from "node:assert/strict";
import test from "node:test";
import type { PurchaseRequestRow } from "@/src/types/purchase";
import type { Proposal } from "@/src/types/commercial";
import {
  filterIndirectCosts,
  filterProposals,
  filterPurchaseRequests,
  type IndirectCostRow,
} from "./operationalListFilters";

test("Compras: filtra por centro de custo (cabeçalho ou item)", () => {
  const base: PurchaseRequestRow[] = [
    {
      id: "r1",
      number: 1,
      requester: "Ana",
      department: "Engenharia",
      requestCategory: null,
      priority: "NORMAL",
      status: "ABERTA",
      justification: "x",
      defaultCostCenterId: "cc-a",
      notes: null,
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
      defaultCostCenter: {
        id: "cc-a",
        code: "A",
        name: "Centro A",
        description: null,
        isActive: true,
        notes: null,
        createdAt: "2026-01-01T10:00:00.000Z",
        updatedAt: "2026-01-01T10:00:00.000Z",
      },
      items: [
        {
          id: "i1",
          purchaseRequestId: "r1",
          lineType: "INDIRETO",
          materialId: null,
          description: "Luva",
          quantity: 1,
          unit: "UN",
          costCenterId: "cc-b",
          desiredDate: null,
          priority: null,
          notes: null,
          suggestedSupplier: "Fornecedor X",
          supplierReference: "NF-123",
          packagingPresentation: null,
          minOrderQtySuggested: null,
          lineStatus: "ABERTA",
          material: null,
          costCenter: null,
        },
      ],
    },
  ];

  assert.equal(
    filterPurchaseRequests(base, {
      search: "",
      status: "",
      priority: "",
      costCenterId: "cc-a",
    }).length,
    1
  );
  assert.equal(
    filterPurchaseRequests(base, {
      search: "",
      status: "",
      priority: "",
      costCenterId: "cc-b",
    }).length,
    1
  );
  assert.equal(
    filterPurchaseRequests(base, {
      search: "",
      status: "",
      priority: "",
      costCenterId: "cc-c",
    }).length,
    0
  );
});

test("Compras: busca encontra fornecedor/referência/descrição em itens", () => {
  const base: PurchaseRequestRow[] = [
    {
      id: "r1",
      number: 10,
      requester: "João",
      department: "TI",
      requestCategory: null,
      priority: "NORMAL",
      status: "RASCUNHO",
      justification: "x",
      defaultCostCenterId: "cc-a",
      notes: null,
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
      defaultCostCenter: {
        id: "cc-a",
        code: "A",
        name: "Centro A",
        description: null,
        isActive: true,
        notes: null,
        createdAt: "2026-01-01T10:00:00.000Z",
        updatedAt: "2026-01-01T10:00:00.000Z",
      },
      items: [
        {
          id: "i1",
          purchaseRequestId: "r1",
          lineType: "INDIRETO",
          materialId: null,
          description: "Notebook",
          quantity: 1,
          unit: "UN",
          costCenterId: null,
          desiredDate: null,
          priority: null,
          notes: null,
          suggestedSupplier: "ACME",
          supplierReference: "DOC-999",
          packagingPresentation: null,
          minOrderQtySuggested: null,
          lineStatus: "ABERTA",
          material: null,
          costCenter: null,
        },
      ],
    },
  ];

  const r1 = filterPurchaseRequests(base, { search: "doc-999", status: "", priority: "", costCenterId: "" });
  assert.deepEqual(r1.map((r) => r.id), ["r1"]);
});

test("Custos Indiretos: filtra por categoria/status e busca por descrição/CC", () => {
  const rows: IndirectCostRow[] = [
    {
      id: "1",
      description: "Energia",
      category: "CIF",
      monthlyValue: 100,
      costCenter: "PROD",
      allocationCriteria: "HH_TOTAL",
      status: "ACTIVE",
    },
    {
      id: "2",
      description: "Aluguel",
      category: "ADMINISTRATIVO",
      monthlyValue: 50,
      costCenter: "ADM",
      allocationCriteria: "FIXED",
      status: "INACTIVE",
    },
  ];

  assert.deepEqual(filterIndirectCosts(rows, { search: "prod", category: "", status: "" }).map((r) => r.id), ["1"]);
  assert.deepEqual(filterIndirectCosts(rows, { search: "", category: "CIF", status: "" }).map((r) => r.id), ["1"]);
  assert.deepEqual(filterIndirectCosts(rows, { search: "", category: "", status: "INACTIVE" }).map((r) => r.id), ["2"]);
});

test("Propostas: filtra por período, faixa de valor e cliente", () => {
  const p: Proposal[] = [
    {
      id: "p1",
      number: 1,
      title: "A",
      customerId: "c1",
      Customer: { id: "c1", companyName: "Cliente 1", taxId: "1", country: "BR", status: "ACTIVE", createdAt: "", updatedAt: "" },
      status: "DRAFT",
      responsible: "R1",
      validityDays: 15,
      freightCondition: "CIF",
      totalItems: 1,
      totalGrossValue: 100,
      totalDiscount: 0,
      totalNetValue: 100,
      totalCost: 50,
      totalMarginValue: 50,
      totalMarginPerc: 50,
      totalTaxes: 0,
      totalCommission: 0,
      totalFreight: 0,
      items: [],
      createdAt: "2026-02-10T10:00:00.000Z",
      updatedAt: "2026-02-10T10:00:00.000Z",
    },
    {
      id: "p2",
      number: 2,
      title: "B",
      customerId: "c2",
      Customer: { id: "c2", companyName: "Cliente 2", taxId: "2", country: "BR", status: "ACTIVE", createdAt: "", updatedAt: "" },
      status: "SENT",
      responsible: "R2",
      validityDays: 15,
      freightCondition: "CIF",
      totalItems: 1,
      totalGrossValue: 500,
      totalDiscount: 0,
      totalNetValue: 500,
      totalCost: 300,
      totalMarginValue: 200,
      totalMarginPerc: 40,
      totalTaxes: 0,
      totalCommission: 0,
      totalFreight: 0,
      items: [],
      createdAt: "2026-03-05T10:00:00.000Z",
      updatedAt: "2026-03-05T10:00:00.000Z",
    },
  ];

  const byPeriod = filterProposals(p, {
    search: "",
    status: "",
    responsible: "",
    customerId: "",
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    minNetValue: "",
    maxNetValue: "",
  });
  assert.deepEqual(byPeriod.map((x) => x.id), ["p2"]);

  const byValue = filterProposals(p, {
    search: "",
    status: "",
    responsible: "",
    customerId: "",
    startDate: "",
    endDate: "",
    minNetValue: "200",
    maxNetValue: "600",
  });
  assert.deepEqual(byValue.map((x) => x.id), ["p2"]);

  const byCustomer = filterProposals(p, {
    search: "",
    status: "",
    responsible: "",
    customerId: "c1",
    startDate: "",
    endDate: "",
    minNetValue: "",
    maxNetValue: "",
  });
  assert.deepEqual(byCustomer.map((x) => x.id), ["p1"]);
});

