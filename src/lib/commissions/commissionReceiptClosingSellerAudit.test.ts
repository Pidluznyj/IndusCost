/**
 * Auditoria estática — fechamento por recebimento: vendedor vs NO_SCHEDULE.
 * Garante que fallbacks proibidos não entram no caminho de resolução de vendedor.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  isReceiptClosingSellerExcludedFromCommission,
  RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY,
  resolveReceiptClosingSellerGroupKey,
} from "./commissionReceiptClosingApi.shared.js";
import { extractSellerFromOrder } from "./commission-source-resolver.js";
import { resolveCommissionReceiptSeller } from "./commissionReceiptSeller.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";

const ROOT = join(process.cwd(), "src/lib/commissions");

const RECEIPT_CLOSING_SELLER_FILES = [
  "commissionReceiptSeller.ts",
  "commissionReceiptEngine.ts",
  "commissionReceiptClosingApi.ts",
  "commissionReceiptClosingApi.shared.ts",
  "commissionReceiptClosingDetailExport.shared.ts",
  "commissionReceiptClosingSellerFilter.shared.ts",
  "commissionNomusOrderSellerResolver.ts",
  "commission-source-resolver.ts",
] as const;

const UI_RECEIPT_CLOSING = join(
  process.cwd(),
  "src/components/commissions/pages/CommissionsReceiptClosingPage.tsx"
);

const OK_IDENTITY: CommissionSellerIdentityContext = {
  persons: [
    {
      id: "person-gislene",
      nomusPersonId: 464,
      name: "GISLENE LIMA",
      type: "SELLER",
      source: "NOMUS",
      active: true,
      linkedRecordCount: 1,
    },
  ],
  aliases: [],
};

function readCommissionsFile(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

/** Remove comentários para auditoria de uso real (não documentação). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("commissionReceiptClosingSellerAudit", () => {
  it("arquivos do fechamento por recebimento não referenciam Proposal como fonte", () => {
    for (const file of RECEIPT_CLOSING_SELLER_FILES) {
      const src = stripComments(readCommissionsFile(file));
      assert.doesNotMatch(
        src,
        /\bProposal\b|\bproposalId\b|\bfrom\s+Proposal\b/i,
        `${file} não deve usar Proposal`
      );
    }
    const page = stripComments(readFileSync(UI_RECEIPT_CLOSING, "utf8"));
    assert.doesNotMatch(page, /\bProposal\b/i);
  });

  it("extractSellerFromOrder usa externalSellerId e nomusSellerName — não SalesOrder.responsible", () => {
    const seller = extractSellerFromOrder({
      externalSellerId: 464,
      nomusSellerName: "GISLENE LIMA",
      responsible: "RESPONSAVEL CRM PROIBIDO",
    });
    assert.equal(seller.nomusSellerId, 464);
    assert.equal(seller.responsibleName, "GISLENE LIMA");
    assert.notEqual(seller.responsibleName, "RESPONSAVEL CRM PROIBIDO");
  });

  it("resolveCommissionReceiptSeller não resolve por legacyResponsible / nome legado", () => {
    const src = readCommissionsFile("commissionReceiptSeller.ts");
    assert.doesNotMatch(src, /legacyResponsible/);
    assert.doesNotMatch(src, /order\.responsible/);

    const unresolved = resolveCommissionReceiptSeller({
      salesOrder: {
        externalSellerId: 9999,
        nomusSellerName: "NOME LEGADO QUALQUER",
      },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(unresolved.sellerResolutionStatus, "SELLER_UNRESOLVED");
    assert.equal(unresolved.canonicalSellerId, null);

    const resolved = resolveCommissionReceiptSeller({
      salesOrder: { externalSellerId: 464, nomusSellerName: null },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(resolved.sellerResolutionStatus, "RESOLVED_FROM_SALES_ORDER");
    assert.equal(resolved.canonicalSellerName, "GISLENE LIMA");
  });

  it("CommissionRecord não prevalece quando externalSellerId é null", () => {
    const r = resolveCommissionReceiptSeller({
      commissionRecord: {
        commissionPersonId: "person-eduardo",
        commissionPersonName: "JOSE EDUARDO CARDOSO DOS SANTOS",
        nomusSellerId: 1189,
      },
      salesOrder: { externalSellerId: null },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(r.sellerResolutionStatus, "NO_SELLER");
    assert.equal(r.rawSellerId, null);
    assert.equal(r.canonicalSellerName, "Sem vendedor no pedido Nomus");
  });

  it("NO_SCHEDULE não entra em isReceiptClosingSellerExcludedFromCommission", () => {
    assert.equal(isReceiptClosingSellerExcludedFromCommission("NO_SCHEDULE"), false);
    assert.equal(isReceiptClosingSellerExcludedFromCommission("CUSTOMER_EXCLUDED"), true);
  });

  it("NO_SCHEDULE com vendedor canônico não agrupa em Sem vendedor / Excluído", () => {
    const key = resolveReceiptClosingSellerGroupKey({
      status: "NO_SCHEDULE",
      canonicalSellerId: "person-gislene",
      canonicalSellerName: "GISLENE LIMA",
      rawSellerId: 464,
      rawSellerName: "464",
      sellerResolutionStatus: "RESOLVED_FROM_SALES_ORDER",
    });
    assert.equal(key, "person-gislene");
    assert.notEqual(key, RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY);
  });

  it("motor de fechamento resolve vendedor em buildExceptionLine via resolveCommissionReceiptSeller", () => {
    const engine = readCommissionsFile("commissionReceiptEngine.ts");
    assert.match(engine, /resolveCommissionReceiptSeller/);
    assert.match(engine, /resolveReceiptExceptionLineSellerFields/);
    assert.doesNotMatch(
      engine,
      /status === "NO_SCHEDULE"[\s\S]{0,120}RECEIPT_CLOSING_UNASSIGNED/,
      "NO_SCHEDULE não deve mapear diretamente para bucket Sem vendedor"
    );
  });

  it("exportação usa mapReceiptClosingLineToExportSellerColumns do helper compartilhado", () => {
    const xlsx = readCommissionsFile("commissionReceiptClosingDetailExport.shared.ts");
    const api = readCommissionsFile("commissionReceiptClosingApi.ts");
    assert.match(xlsx, /mapReceiptClosingLineToExportSellerColumns/);
    assert.match(api, /mapReceiptClosingLineToExportSellerColumns/);
  });
});
