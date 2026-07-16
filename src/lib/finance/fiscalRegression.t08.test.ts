/**
 * T08 — Regressão fiscal ponta a ponta (casos obrigatórios + critérios).
 * Não introduz funcionalidade nova: valida camadas A–D e invariantes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NFE_FISCAL_BACKFILL_WATCH_ORDERS } from "../nfeFiscalBackfill.js";
import { PD_02457_FISCAL, PD_02457_NFE_XML } from "../nfeFiscalFixtures.js";
import {
  NFE_TAX_SCOPE,
  computeHighlightedResidual,
  parseNfeFiscalXml,
  sumHeaderTaxAmount,
} from "../nfeFiscalXmlParser.js";
import {
  computeFiscalAmountDue,
  computeFiscalBalanceDue,
  resolveFiscalGuideStatus,
} from "./fiscalSettlementClient.js";
import {
  canViewFiscalSettlements,
  FISCAL_SETTLEMENT_VIEW_PERMISSIONS,
} from "./fiscalSettlementPermissions.js";
import {
  createFiscalAllocation,
  createFiscalPaymentGuide,
} from "./fiscalSettlementService.server.js";
import {
  FISCAL_TAX_INTEL_COLUMN_SOURCES,
  buildFiscalTaxIntelKpisFromParts,
} from "./fiscalTaxIntelligenceClient.js";
import { canViewSalesOrderFiscalTaxes } from "../sales-orders/salesOrderFiscalTaxesPermissions.js";
import { resolveSalesOrderFiscalSettlementStatus } from "../sales-orders/salesOrderFiscalTaxesClient.js";

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    try {
      return (v as { toNumber: () => number }).toNumber();
    } catch {
      return Number(v) || 0;
    }
  }
  return Number(v) || 0;
}

function money(n: number) {
  const v = Number(n) || 0;
  return {
    toNumber: () => v,
    toFixed: (d: number) => v.toFixed(d),
    valueOf: () => v,
  };
}

function makePrismaMock() {
  const guides: any[] = [];
  const allocations: any[] = [];
  const audits: any[] = [];
  return {
    allocations,
    fiscalPaymentGuide: {
      findUnique: async ({ where, include }: any) => {
        let g =
          guides.find((x) => x.id === where.id) ??
          (where.dedupeKey
            ? guides.find((x) => x.dedupeKey === where.dedupeKey)
            : null);
        if (!g) return null;
        if (include) {
          return {
            ...g,
            proofs: [],
            allocations: allocations.filter((a) => a.guideId === g.id),
          };
        }
        return g;
      },
      create: async ({ data, include }: any) => {
        const id = `guide-${guides.length + 1}`;
        const row: any = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          cancelledAt: null,
        };
        for (const k of [
          "assessedAmount",
          "creditsAmount",
          "compensationsAmount",
          "interestAmount",
          "fineAmount",
          "amountDue",
          "amountPaid",
          "balanceDue",
        ]) {
          row[k] = money(toNum(data[k]));
        }
        guides.push(row);
        if (include) return { ...row, proofs: [], allocations: [] };
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = guides.findIndex((g) => g.id === where.id);
        guides[idx] = { ...guides[idx], ...data };
        return guides[idx];
      },
    },
    fiscalAllocation: {
      create: async ({ data }: any) => {
        const row = {
          id: `alloc-${allocations.length + 1}`,
          ...data,
          allocatedAmount: money(toNum(data.allocatedAmount)),
          calculatedAt: new Date(),
          version: 1,
        };
        allocations.push(row);
        return row;
      },
    },
    fiscalSettlementAuditLog: {
      create: async ({ data }: any) => {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      },
    },
    nomusAccountsPayable: {
      findUnique: async () => null,
    },
    salesOrder: {
      findUnique: async ({ where }: any) =>
        where?.id ? { id: where.id } : null,
    },
    nomusNfe: {
      findUnique: async () => null,
    },
  };
}

describe("T08 — watch list pedidos âncora", () => {
  it("inclui PD 02457 / 02139 / 02072 no backfill watch", () => {
    const joined = NFE_FISCAL_BACKFILL_WATCH_ORDERS.join("|");
    assert.match(joined, /02457/);
    assert.match(joined, /02139/);
    assert.match(joined, /02072/);
  });

  it("PD 02457: IPI destacado ≠ pago automático", () => {
    const parsed = parseNfeFiscalXml(PD_02457_NFE_XML);
    assert.equal(sumHeaderTaxAmount(parsed.lines, "IPI"), PD_02457_FISCAL.ipi);
    assert.equal("amountPaid" in parsed, false);
    assert.equal(parsed.highlightedResidual, 0);
  });
});

describe("T08 — parser casos fiscais obrigatórios", () => {
  it("XML sem tributos não inventa imposto", () => {
    const parsed = parseNfeFiscalXml(`<NFe><infNFe>
      <total><ICMSTot><vProd>50</vProd><vNF>50</vNF></ICMSTot></total>
    </infNFe></NFe>`);
    assert.equal(sumHeaderTaxAmount(parsed.lines, "IPI"), 0);
    assert.equal(sumHeaderTaxAmount(parsed.lines, "ICMS"), 0);
  });

  it("IPI + PIS + COFINS + ICMS-ST + FCP", () => {
    const xml = `<NFe><infNFe>
      <det nItem="1"><prod><NCM>1</NCM><CFOP>6401</CFOP></prod>
        <imposto>
          <ICMS><ICMS10><CST>10</CST><vICMS>6</vICMS><vICMSST>14.40</vICMSST><vFCP>1</vFCP></ICMS10></ICMS>
          <IPI><IPITrib><CST>50</CST><vIPI>5</vIPI></IPITrib></IPI>
          <PIS><PISAliq><vPIS>1.65</vPIS></PISAliq></PIS>
          <COFINS><COFINSAliq><vCOFINS>7.6</vCOFINS></COFINSAliq></COFINS>
        </imposto>
      </det>
      <total><ICMSTot>
        <vProd>50</vProd><vICMS>6</vICMS><vST>14.40</vST><vFCP>1</vFCP>
        <vIPI>5</vIPI><vPIS>1.65</vPIS><vCOFINS>7.6</vCOFINS><vNF>84.65</vNF>
      </ICMSTot></total>
    </infNFe></NFe>`;
    const p = parseNfeFiscalXml(xml);
    assert.equal(p.totals.vIPI, 5);
    assert.equal(p.totals.vPIS, 1.65);
    assert.equal(p.totals.vCOFINS, 7.6);
    assert.equal(p.totals.vST, 14.4);
    assert.equal(p.totals.vFCP, 1);
    assert.ok(p.lines.some((l) => l.taxType === "ICMS_ST"));
    assert.ok(p.lines.some((l) => l.taxType === "FCP"));
  });

  it("devolução e campo fiscal novo (IBS/CBS)", () => {
    const devol = parseNfeFiscalXml(`<NFe><infNFe>
      <ide><finNFe>4</finNFe><tpNF>0</tpNF></ide>
      <total><ICMSTot><vProd>10</vProd><vNF>10</vNF></ICMSTot></total>
    </infNFe></NFe>`);
    assert.equal(devol.finalidade, 4);

    const novo = parseNfeFiscalXml(`<NFe><infNFe>
      <total><ICMSTot><vProd>10</vProd><vNF>12</vNF><vIBS>1</vIBS><vCBS>1</vCBS></ICMSTot></total>
    </infNFe></NFe>`);
    assert.equal(novo.extensibleTotals?.vIBS, 1);
    assert.ok(novo.lines.some((l) => l.taxType === "IBS"));
  });

  it("não soma HEADER+ITEM; residual ≠ imposto/saldo financeiro", () => {
    const p = parseNfeFiscalXml(PD_02457_NFE_XML);
    const h = p.lines.filter(
      (l) => l.scope === NFE_TAX_SCOPE.HEADER && l.taxType === "IPI"
    );
    const i = p.lines.filter(
      (l) => l.scope === NFE_TAX_SCOPE.ITEM && l.taxType === "IPI"
    );
    assert.equal(h[0]!.amount, i[0]!.amount);
    assert.notEqual(
      (h[0]!.amount ?? 0) + (i[0]!.amount ?? 0),
      PD_02457_FISCAL.ipi
    );

    const residual = computeHighlightedResidual({
      vProd: 100,
      vDesc: 0,
      vFrete: 10,
      vSeg: 0,
      vOutro: 0,
      vII: 0,
      vIPI: 5,
      vIPIDevol: 0,
      vBC: null,
      vICMS: 0,
      vICMSDeson: 0,
      vBCST: null,
      vST: 0,
      vFCP: 0,
      vFCPST: 0,
      vFCPSTRet: 0,
      vPIS: 0,
      vCOFINS: 0,
      vISS: 0,
      vTotTrib: null,
      vNF: 115,
    });
    assert.equal(residual, 0);
  });
});

describe("T08 — apuração / guia / pagamento / alocação", () => {
  it("crédito, compensação, juros e multa no devido", () => {
    const due = computeFiscalAmountDue({
      assessedAmount: 1000,
      creditsAmount: 100,
      compensationsAmount: 50,
      interestAmount: 20,
      fineAmount: 10,
    });
    assert.equal(due, 880);
    assert.equal(computeFiscalBalanceDue(due, 200), 680);
  });

  it("guia sem pagamento = ISSUED; parcial ≠ pago total", () => {
    assert.equal(
      resolveFiscalGuideStatus({
        amountDue: 100,
        amountPaid: 0,
        cancelled: false,
      }),
      "ISSUED"
    );
    assert.equal(
      resolveFiscalGuideStatus({
        amountDue: 100,
        amountPaid: 40,
        cancelled: false,
      }),
      "PARTIALLY_PAID"
    );
    assert.equal(
      resolveSalesOrderFiscalSettlementStatus({
        hasGuide: true,
        assessedAmount: 129.19,
        amountDue: 129.19,
        amountPaid: 50,
        allocatedAmount: 50,
      }),
      "PARTIALLY_PAID"
    );
  });

  it("múltiplos pedidos por guia — alocações gerenciais distintas", async () => {
    const prisma = makePrismaMock();
    const guide = await createFiscalPaymentGuide(prisma as never, {
      taxType: "IPI",
      jurisdiction: "FEDERAL",
      guideType: "DARF",
      guideNumber: "MULTI-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      assessedAmount: 300,
      amountPaid: 300,
    });
    assert.equal(guide.amountPaid, 300);

    const a1 = await createFiscalAllocation(prisma as never, {
      guideId: guide.id,
      salesOrderId: "so-02457",
      taxType: "IPI",
      allocatedAmount: 129.19,
      allocationMethod: "MANUAL",
      notes: "Gerencial PD 02457",
    });
    const a2 = await createFiscalAllocation(prisma as never, {
      guideId: guide.id,
      salesOrderId: "so-02139",
      taxType: "IPI",
      allocatedAmount: 100,
      allocationMethod: "MANUAL",
      notes: "Gerencial PD 02139",
    });
    assert.equal(a1.isManagerialOnly, true);
    assert.equal(a2.isManagerialOnly, true);
    assert.equal(prisma.allocations.length, 2);
    assert.notEqual(a1.salesOrderId, a2.salesOrderId);
  });
});

describe("T08 — critérios de camada e permissões", () => {
  it("colunas de inteligência identificam fonte A/B/C/D", () => {
    const natures = Object.values(FISCAL_TAX_INTEL_COLUMN_SOURCES).map(
      (c) => c.nature
    );
    assert.ok(natures.includes("DESTACADO_NF"));
    assert.ok(natures.includes("APURADO"));
    assert.ok(natures.includes("PAGO"));
    assert.ok(natures.includes("ALOCADO"));
    assert.ok(
      FISCAL_TAX_INTEL_COLUMN_SOURCES.highlightedAmount.source.includes(
        "HEADER"
      )
    );
  });

  it("KPI não trata residual como imposto nem destacado como pago", () => {
    const k = buildFiscalTaxIntelKpisFromParts({
      highlightedAmount: 100,
      creditsAmount: 0,
      assessedAmount: 80,
      amountDue: 80,
      amountPaid: 50,
      interestAmount: 0,
      fineAmount: 0,
      guideBalanceDue: 30,
      allocatedAmount: 40,
      revenueBase: 1000,
      cancelledGuideCount: 0,
      validGuideCount: 1,
      nfeCount: 1,
    });
    assert.equal(k.highlightedVsAssessed, 20);
    assert.equal(k.assessedVsPaid, 30);
    assert.notEqual(k.highlightedAmount, k.amountPaid);
    assert.notEqual(k.allocatedAmount, k.amountPaid);
  });

  it("autorização view fiscal settlements / pedido tributos", () => {
    assert.equal(
      canViewFiscalSettlements({ hasPermission: () => false }),
      false
    );
    assert.equal(
      canViewFiscalSettlements({
        hasPermission: (k) => k === "finance.tax_apuration.view",
      }),
      true
    );
    assert.ok(FISCAL_SETTLEMENT_VIEW_PERMISSIONS.length >= 1);
    assert.equal(
      canViewSalesOrderFiscalTaxes({ hasPermission: () => false }),
      false
    );
  });
});
