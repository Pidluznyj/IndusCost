/**
 * Inteligência Fiscal 360° — leitura das FONTES oficiais (somente leitura), usada só pelo processador.
 * Nenhuma rota GET da 360° chama estas funções. Nenhum XML é lido: só colunas já persistidas.
 */
import { Prisma } from "@prisma/client";
import { fiscalNfeWhereSql, nfeCompetenceDateSql } from "@/src/lib/financeBillingNfeDashboard.js";
import { FISCAL360_AP_RULES_KEY } from "./fiscal360Constants.js";
import type {
  FiscalApConfiguredRule,
  FiscalApDecision,
  FiscalApSourceRow,
  FiscalApTreasuryEvidence,
} from "./fiscal360ApClassifier.js";
import type { FiscalDocumentSourceRow } from "./fiscal360DocumentFact.js";
import type { FiscalGuideSourceRow } from "./fiscal360PaymentFact.js";
import type { Fiscal360Db } from "./fiscal360Queue.server.js";

export { num, numOrNull } from "./fiscal360Num.js";
import { num, numOrNull } from "./fiscal360Num.js";

const SUMMARY_COLUMNS = [
  "vProd",
  "vDesc",
  "vNF",
  "vBC",
  "vICMS",
  "vICMSDeson",
  "vBCST",
  "vST",
  "vFCP",
  "vFCPST",
  "vIPI",
  "vPIS",
  "vCOFINS",
  "vISS",
  "vII",
] as const;

/**
 * Carrega NF-e + resumo fiscal persistido. `isOfficialBilling` e a competência vêm das MESMAS
 * expressões SQL usadas por Faturamento/DRE (`fiscalNfeWhereSql`, `nfeCompetenceDateSql`).
 */
export async function loadFiscal360DocumentSources(db: Fiscal360Db, ids: string[]): Promise<FiscalDocumentSourceRow[]> {
  if (ids.length === 0) return [];
  const competence = nfeCompetenceDateSql("emissao", "n");
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT n."id", n."externalId", n."chave", n."numero", n."serie", n."status", n."cnpjEmitente",
           n."xmlDestCnpjCpf", n."xmlNatOp", n."xmlTpNF", n."isFornecedor", n."tipoOperacao",
           n."billingClassification"::text AS "billingClassification", n."isMarketSale",
           COALESCE((${fiscalNfeWhereSql("emissao", undefined, "n")}), false) AS "isOfficialBilling",
           to_char(${competence}, 'YYYY-MM') AS "competenceMonth",
           ${competence} AS "issueDate",
           n."valorLiquido", n."xmlVProd", n."xmlVDesc", n."xmlVNF", n."payloadHash",
           fs."id" AS "summaryId", fs."parserVersion", fs."source" AS "summarySource", fs."xmlHash",
           fs."isCancelled", fs."finalidade", fs."tpNF" AS "summaryTpNF", fs."extensibleTotals",
           ${Prisma.raw(SUMMARY_COLUMNS.map((c) => `fs."${c}" AS "s_${c}"`).join(", "))}
    FROM "NomusNfe" n
    LEFT JOIN "NomusNfeFiscalSummary" fs ON fs."nomusNfeId" = n."id"
    WHERE n."id" IN (${Prisma.join(ids)})
  `);
  return rows.map((r) => {
    const summary =
      r.summaryId == null
        ? null
        : {
            parserVersion: (r.parserVersion as string | null) ?? null,
            source: (r.summarySource as string | null) ?? null,
            xmlHash: (r.xmlHash as string | null) ?? null,
            isCancelled: (r.isCancelled as boolean | null) ?? null,
            finalidade: (r.finalidade as number | null) ?? null,
            tpNF: (r.summaryTpNF as number | null) ?? null,
            extensibleTotals: (r.extensibleTotals as Record<string, number> | null) ?? null,
            ...(Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c, numOrNull(r[`s_${c}`])])) as Record<
              (typeof SUMMARY_COLUMNS)[number],
              number | null
            >),
          };
    return {
      nomusNfeId: String(r.id),
      externalId: Number(r.externalId),
      chave: (r.chave as string | null) ?? null,
      numero: (r.numero as string | null) ?? null,
      serie: (r.serie as string | null) ?? null,
      status: r.status == null ? null : Number(r.status),
      cnpjEmitente: (r.cnpjEmitente as string | null) ?? null,
      xmlDestCnpjCpf: (r.xmlDestCnpjCpf as string | null) ?? null,
      xmlNatOp: (r.xmlNatOp as string | null) ?? null,
      xmlTpNF: r.xmlTpNF == null ? null : Number(r.xmlTpNF),
      isFornecedor: r.isFornecedor == null ? null : Number(r.isFornecedor),
      tipoOperacao: r.tipoOperacao == null ? null : Number(r.tipoOperacao),
      billingClassification: (r.billingClassification as string | null) ?? null,
      isMarketSale: Boolean(r.isMarketSale),
      isOfficialBilling: Boolean(r.isOfficialBilling),
      competenceMonth: (r.competenceMonth as string | null) ?? null,
      issueDate: (r.issueDate as Date | null) ?? null,
      valorLiquido: numOrNull(r.valorLiquido),
      xmlVProd: numOrNull(r.xmlVProd),
      xmlVDesc: numOrNull(r.xmlVDesc),
      xmlVNF: numOrNull(r.xmlVNF),
      payloadHash: (r.payloadHash as string | null) ?? null,
      summary,
    };
  });
}

export async function loadFiscal360ApSources(db: Fiscal360Db, externalIds: number[]): Promise<FiscalApSourceRow[]> {
  if (externalIds.length === 0) return [];
  const rows = await db.nomusAccountsPayable.findMany({
    where: { externalId: { in: externalIds } },
    select: {
      id: true,
      externalId: true,
      classification: true,
      type: true,
      status: true,
      companyName: true,
      personName: true,
      personCnpj: true,
      description: true,
      comments: true,
      paymentMethodName: true,
      documentNumber: true,
      dueDate: true,
      competenceDate: true,
      settlementDate: true,
      paymentDate: true,
      amountPayable: true,
      amountPaid: true,
      balancePayable: true,
      suspendPayment: true,
      payloadHash: true,
      sourcePresenceStatus: true,
      bankAccountName: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    sourcePresenceStatus: String(r.sourcePresenceStatus),
    amountPayable: numOrNull(r.amountPayable),
    amountPaid: numOrNull(r.amountPaid),
    balancePayable: numOrNull(r.balancePayable),
  }));
}

/** Evidência bancária: alocações AP (TITLE) de matches MATCHED na conciliação de Tesouraria. */
export async function loadFiscal360TreasuryEvidence(
  db: Fiscal360Db,
  externalIds: number[]
): Promise<Map<number, FiscalApTreasuryEvidence>> {
  const out = new Map<number, FiscalApTreasuryEvidence>();
  if (externalIds.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ ext: number; paidDate: Date | null; amount: unknown; n: bigint }>>(Prisma.sql`
    SELECT a."nomusExternalId" AS ext, MAX(m."matchedCivilDate") AS "paidDate", SUM(a."amount") AS amount, COUNT(*) AS n
    FROM "TreasuryReconciliationAllocation" a
    JOIN "TreasuryReconciliationMatch" m ON m."id" = a."matchId"
    WHERE a."nomusSide" = 'AP' AND a."kind"::text = 'TITLE' AND m."status"::text = 'MATCHED'
      AND a."nomusExternalId" IN (${Prisma.join(externalIds)})
    GROUP BY a."nomusExternalId"
  `);
  for (const r of rows) {
    out.set(Number(r.ext), { paidDate: r.paidDate ?? null, matchedAmount: num(r.amount), matchCount: Number(r.n) });
  }
  return out;
}

export type Fiscal360GuideLink = { guideId: string; apExternalId: number; createdAt: Date; source: "FK" | "DECISION"; taxType: string };

/**
 * Vínculos guia ↔ título AP (FK da guia + decisões manuais ativas). Guia cancelada não reivindica título.
 * Vencedor por título: vínculo mais antigo (createdAt, id) — determinístico.
 */
export async function loadFiscal360GuideLinks(
  db: Fiscal360Db,
  filter: { apExternalIds?: number[]; guideIds?: string[] }
): Promise<Fiscal360GuideLink[]> {
  const apIds = filter.apExternalIds ?? [];
  const guideIds = filter.guideIds ?? [];
  if (apIds.length === 0 && guideIds.length === 0) return [];
  const decisions = await db.fiscalReconciliationDecision.findMany({
    where: {
      active: true,
      decisionType: "LINK_GUIDE_AP",
      OR: [
        ...(apIds.length ? [{ apExternalId: { in: apIds } }] : []),
        ...(guideIds.length ? [{ guideId: { in: guideIds } }] : []),
      ],
    },
    select: { guideId: true, apExternalId: true, createdAt: true },
  });
  const decisionGuideIds = decisions.map((d) => d.guideId).filter((g): g is string => Boolean(g));
  const guides = await db.fiscalPaymentGuide.findMany({
    where: {
      status: { not: "CANCELLED" },
      OR: [
        ...(apIds.length ? [{ accountsPayableExternalId: { in: apIds } }] : []),
        ...(guideIds.length || decisionGuideIds.length ? [{ id: { in: [...guideIds, ...decisionGuideIds] } }] : []),
      ],
    },
    select: { id: true, accountsPayableExternalId: true, createdAt: true, taxType: true },
  });
  const byId = new Map(guides.map((g) => [g.id, g]));
  const links: Fiscal360GuideLink[] = [];
  // Decisão manual prevalece sobre o FK da própria guia.
  const decided = new Set<string>();
  for (const d of decisions) {
    const g = d.guideId ? byId.get(d.guideId) : null;
    if (!g || d.apExternalId == null) continue;
    decided.add(g.id);
    links.push({ guideId: g.id, apExternalId: d.apExternalId, createdAt: d.createdAt, source: "DECISION", taxType: g.taxType });
  }
  for (const g of guides) {
    if (decided.has(g.id) || g.accountsPayableExternalId == null) continue;
    links.push({ guideId: g.id, apExternalId: g.accountsPayableExternalId, createdAt: g.createdAt, source: "FK", taxType: g.taxType });
  }
  return links;
}

/** Inclui as demais guias que disputam os mesmos títulos (para decidir o vencedor). */
export async function loadFiscal360CompetingLinks(db: Fiscal360Db, apExternalIds: number[]): Promise<Fiscal360GuideLink[]> {
  return loadFiscal360GuideLinks(db, { apExternalIds });
}

export function resolveFiscal360ClaimWinner(links: Fiscal360GuideLink[], apExternalId: number): Fiscal360GuideLink | null {
  const candidates = links
    .filter((l) => l.apExternalId === apExternalId)
    .sort((a, b) => +a.createdAt - +b.createdAt || a.guideId.localeCompare(b.guideId));
  return candidates[0] ?? null;
}

export async function loadFiscal360ApDecisions(db: Fiscal360Db, externalIds: number[]): Promise<Map<number, FiscalApDecision>> {
  const out = new Map<number, FiscalApDecision>();
  if (externalIds.length === 0) return out;
  const rows = await db.fiscalReconciliationDecision.findMany({
    where: { active: true, decisionType: { in: ["AP_CONFIRM_TAX", "AP_REJECT_TAX"] }, apExternalId: { in: externalIds } },
    orderBy: { createdAt: "desc" },
  });
  for (const r of rows) {
    if (r.apExternalId == null || out.has(r.apExternalId)) continue;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    out.set(r.apExternalId, {
      id: r.id,
      decisionType: r.decisionType as FiscalApDecision["decisionType"],
      taxType: typeof payload.taxType === "string" ? payload.taxType : null,
      revenueCode: typeof payload.revenueCode === "string" ? payload.revenueCode : null,
      competenceMonth: typeof payload.competenceMonth === "string" ? payload.competenceMonth : null,
    });
  }
  return out;
}

export async function loadFiscal360ApRules(db: Fiscal360Db): Promise<{ version: string; rules: FiscalApConfiguredRule[] }> {
  const active = await db.fiscalRuleVersion.findFirst({
    where: { ruleKey: FISCAL360_AP_RULES_KEY, status: "ACTIVE" },
    orderBy: { version: "desc" },
  });
  if (!active) return { version: "none", rules: [] };
  const params = (active.parameters ?? {}) as { rules?: unknown };
  const rules = Array.isArray(params.rules)
    ? (params.rules as FiscalApConfiguredRule[]).filter(
        (r) => r && typeof r.value === "string" && r.value.trim() && (r.outcome === "TAX" || r.outcome === "NOT_TAX")
      )
    : [];
  return { version: `v${active.version}`, rules };
}

export async function loadFiscal360GuideSources(db: Fiscal360Db, guideIds: string[]): Promise<FiscalGuideSourceRow[]> {
  if (guideIds.length === 0) return [];
  const rows = await db.fiscalPaymentGuide.findMany({
    where: { id: { in: guideIds } },
    include: {
      period: { select: { companyName: true } },
      _count: { select: { proofs: true } },
    },
  });
  return rows.map((g) => ({
    id: g.id,
    taxType: g.taxType,
    jurisdiction: g.jurisdiction,
    revenueCode: g.revenueCode,
    guideType: g.guideType,
    guideNumber: g.guideNumber,
    periodStart: g.periodStart,
    periodEnd: g.periodEnd,
    dueDate: g.dueDate,
    assessedAmount: num(g.assessedAmount),
    creditsAmount: num(g.creditsAmount),
    compensationsAmount: num(g.compensationsAmount),
    interestAmount: num(g.interestAmount),
    fineAmount: num(g.fineAmount),
    amountDue: num(g.amountDue),
    amountPaid: num(g.amountPaid),
    balanceDue: num(g.balanceDue),
    paidAt: g.paidAt,
    status: g.status,
    paymentAccount: g.paymentAccount,
    accountsPayableExternalId: g.accountsPayableExternalId,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    periodCompanyName: g.period?.companyName ?? null,
    proofCount: g._count.proofs,
  }));
}
