/**
 * Auditoria SOMENTE LEITURA: inadimplência comercial × motor oficial de Contas a Receber.
 *
 * Não grava, não sincroniza, não altera título, saldo, baixa ou status.
 * Pode rodar em homologação/produção com o DATABASE_URL do ambiente — só `findMany`.
 *
 * Classifica:
 *   DIVERGENCE_COMMERCIAL_OVERDUE_WITHOUT_OFFICIAL — Comercial OVERDUE sem CR oficial
 *   DIVERGENCE_ID_MISMATCH — os externalId oficiais divergem
 *   LEGITIMATE_TOLERANCE — Financeiro venceu D+1..D+3; Comercial ainda não bloqueia
 *   LEGITIMATE_COMMERCIAL_POLICY — protesto/identidade/sync, sem contradição financeira
 *
 * Uso:
 *   npx tsx scripts/auditCommercialDelinquencyVsOfficialAr.ts
 *   npx tsx scripts/auditCommercialDelinquencyVsOfficialAr.ts --json
 *   npx tsx scripts/auditCommercialDelinquencyVsOfficialAr.ts --asOf=2026-10-20 --limit=200
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { formatCnpj, normalizeCnpj } from "../src/lib/companyCnpjFormat.js";
import {
  analyzeCommercialDelinquency,
  commercialDelinquencyMoney,
  commercialDelinquencyTitleToDashboardRow,
  selectOfficialArOverdueForCommercial,
  type CommercialDelinquencySyncRunStatus,
  type CommercialDelinquencyTitleInput,
} from "../src/lib/commercial/customerDelinquencyAnalysis.js";
import { computeDaysOverdue } from "../src/lib/financeAccountsReceivableDashboard.js";
import { buildNomusArReportSyncCutoff } from "../src/lib/financeNomusArReportFreshness.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const asOfArg = args.find((arg) => arg.startsWith("--asOf="));
const cnpjArg = args.find((arg) => arg.startsWith("--cnpj="));
const limit = limitArg ? Number.parseInt(limitArg.slice("--limit=".length), 10) : 5000;
const asOf = asOfArg ? new Date(`${asOfArg.slice("--asOf=".length)}T12:00:00`) : new Date();
const cnpjFilter = cnpjArg ? normalizeCnpj(cnpjArg.slice("--cnpj=".length)) : "";

type Kind =
  | "ALIGNED"
  | "LEGITIMATE_TOLERANCE"
  | "LEGITIMATE_COMMERCIAL_POLICY"
  | "DIVERGENCE_COMMERCIAL_OVERDUE_WITHOUT_OFFICIAL"
  | "DIVERGENCE_ID_MISMATCH";

type Finding = {
  kind: Kind;
  customerId: string;
  cnpj: string;
  commercialStatus: string;
  officialOverdueIds: number[];
  commercialOfficialOverdueIds: number[];
  commercialOverdueIds: number[];
  commercialOverdueAmount: number | null;
  maxOfficialDays: number;
};

function maskCnpj(value: string | null | undefined): string {
  const digits = normalizeCnpj(value);
  if (digits.length < 8) return "(sem CNPJ)";
  return `${digits.slice(0, 8)}****`;
}

function asRunStatus(status: string | null | undefined): CommercialDelinquencySyncRunStatus | null {
  if (status === "SUCCESS" || status === "FAILED" || status === "INCONCLUSIVE" || status === "RUNNING") {
    return status;
  }
  return null;
}

function classify(input: {
  commercialStatus: string;
  officialOverdueIds: number[];
  commercialOfficialOverdueIds: number[];
  commercialOverdueIds: number[];
  maxOfficialDays: number;
}): Kind {
  const official = [...input.officialOverdueIds].sort((a, b) => a - b).join(",");
  const commercialOfficial = [...input.commercialOfficialOverdueIds].sort((a, b) => a - b).join(",");
  if (official !== commercialOfficial) return "DIVERGENCE_ID_MISMATCH";
  if (input.commercialStatus === "OVERDUE" && input.officialOverdueIds.length === 0) {
    return "DIVERGENCE_COMMERCIAL_OVERDUE_WITHOUT_OFFICIAL";
  }
  if (input.officialOverdueIds.length > 0 && input.commercialOverdueIds.length === 0 && input.maxOfficialDays <= 3) {
    return "LEGITIMATE_TOLERANCE";
  }
  if (input.commercialStatus === "OVERDUE" || input.commercialStatus === "REGULAR") {
    return "ALIGNED";
  }
  return "LEGITIMATE_COMMERCIAL_POLICY";
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const [customers, titles, orders, syncAgg, latestRun] = await Promise.all([
      prisma.customer.findMany({
        where: cnpjFilter
          ? { taxId: { in: [...new Set([cnpjFilter, formatCnpj(cnpjFilter)].filter(Boolean))] } }
          : undefined,
        select: { id: true, taxId: true, nomusExternalPersonId: true, companyName: true },
        take: Number.isFinite(limit) ? limit : 5000,
      }),
      prisma.nomusAccountsReceivable.findMany({
        select: {
          externalId: true,
          personId: true,
          personName: true,
          personCnpj: true,
          companyName: true,
          description: true,
          comments: true,
          dueDate: true,
          settlementDate: true,
          amountReceivable: true,
          amountReceived: true,
          balanceReceivable: true,
          sourceInvoiceId: true,
          sourceInvoiceNumber: true,
          paymentMethodName: true,
          bankAccountName: true,
          suspendCollection: true,
          status: true,
          syncedAt: true,
          sourcePresenceStatus: true,
          rawPayload: true,
        },
      }),
      prisma.salesOrder.findMany({
        select: { customerId: true, externalCustomerId: true },
      }),
      prisma.nomusAccountsReceivable.aggregate({ _max: { syncedAt: true } }),
      prisma.nomusSourceSyncRun.findFirst({
        where: { entityType: "ACCOUNTS_RECEIVABLE" },
        orderBy: { startedAt: "desc" },
        select: { status: true, payloadComplete: true, startedAt: true },
      }),
    ]);

    const ordersByCustomer = new Map<string, Array<number | null>>();
    for (const order of orders) {
      const bucket = ordersByCustomer.get(order.customerId) ?? [];
      bucket.push(order.externalCustomerId);
      ordersByCustomer.set(order.customerId, bucket);
    }

    const titlesByPerson = new Map<number, CommercialDelinquencyTitleInput[]>();
    for (const row of titles) {
      if (row.personId == null) continue;
      const mapped: CommercialDelinquencyTitleInput = {
        externalId: row.externalId,
        personId: row.personId,
        personName: row.personName,
        personCnpj: row.personCnpj,
        companyName: row.companyName,
        description: row.description,
        comments: row.comments,
        dueDate: row.dueDate,
        settlementDate: row.settlementDate,
        amountReceivable: commercialDelinquencyMoney(row.amountReceivable),
        amountReceived: commercialDelinquencyMoney(row.amountReceived),
        balanceReceivable: commercialDelinquencyMoney(row.balanceReceivable),
        sourceInvoiceId: row.sourceInvoiceId,
        sourceInvoiceNumber: row.sourceInvoiceNumber,
        paymentMethodName: row.paymentMethodName,
        bankAccountName: row.bankAccountName,
        suspendCollection: row.suspendCollection,
        nomusStatus: row.status,
        syncedAt: row.syncedAt,
        sourcePresenceStatus: row.sourcePresenceStatus,
        rawPayload: row.rawPayload,
      };
      const bucket = titlesByPerson.get(row.personId) ?? [];
      bucket.push(mapped);
      titlesByPerson.set(row.personId, bucket);
    }

    const cnpjCounts = new Map<string, string[]>();
    for (const customer of customers) {
      const cnpj = normalizeCnpj(customer.taxId);
      if (!cnpj) continue;
      const ids = cnpjCounts.get(cnpj) ?? [];
      ids.push(customer.id);
      cnpjCounts.set(cnpj, ids);
    }

    const syncCutoff = buildNomusArReportSyncCutoff(syncAgg._max.syncedAt);
    const findings: Finding[] = [];
    const counts: Record<Kind, number> = {
      ALIGNED: 0,
      LEGITIMATE_TOLERANCE: 0,
      LEGITIMATE_COMMERCIAL_POLICY: 0,
      DIVERGENCE_COMMERCIAL_OVERDUE_WITHOUT_OFFICIAL: 0,
      DIVERGENCE_ID_MISMATCH: 0,
    };

    for (const customer of customers) {
      const personId = customer.nomusExternalPersonId;
      const customerTitles = personId != null && personId > 0 ? (titlesByPerson.get(personId) ?? []) : [];
      const cnpj = normalizeCnpj(customer.taxId);
      const peers = cnpjCounts.get(cnpj) ?? [customer.id];
      const analysis = analyzeCommercialDelinquency({
        customerId: customer.id,
        taxId: customer.taxId,
        nomusExternalPersonId: customer.nomusExternalPersonId,
        salesOrderExternalCustomerIds: ordersByCustomer.get(customer.id) ?? [],
        peerCustomerIdsWithSameCnpj: peers,
        titles: customerTitles,
        syncCutoff,
        latestRunStatus: asRunStatus(latestRun?.status),
        payloadComplete: latestRun?.payloadComplete ?? null,
        referenceDate: asOf,
      });
      const official = selectOfficialArOverdueForCommercial(
        customerTitles.map(commercialDelinquencyTitleToDashboardRow),
        asOf,
        syncCutoff
      );
      const officialOverdueIds = official.map((row) => row.externalId).sort((a, b) => a - b);
      let maxOfficialDays = 0;
      for (const row of official) {
        maxOfficialDays = Math.max(maxOfficialDays, computeDaysOverdue(row.dueDate, asOf));
      }
      const kind = classify({
        commercialStatus: analysis.status,
        officialOverdueIds,
        commercialOfficialOverdueIds: analysis.evidence.officialOverdueTitleIds ?? [],
        commercialOverdueIds: analysis.evidence.overdueTitleIds,
        maxOfficialDays,
      });
      counts[kind] += 1;
      if (kind === "ALIGNED") continue;
      findings.push({
        kind,
        customerId: customer.id,
        cnpj: maskCnpj(customer.taxId),
        commercialStatus: analysis.status,
        officialOverdueIds,
        commercialOfficialOverdueIds: analysis.evidence.officialOverdueTitleIds ?? [],
        commercialOverdueIds: analysis.evidence.overdueTitleIds,
        commercialOverdueAmount: analysis.overdueAmount,
        maxOfficialDays,
      });
    }

    const payload = {
      readOnly: true,
      asOf: asOf.toISOString(),
      customers: customers.length,
      titles: titles.length,
      latestRun: latestRun?.status ?? null,
      counts,
      findings,
    };

    if (asJson) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    console.log("Auditoria comercial × AR oficial (somente leitura)");
    console.log(`Data-base: ${payload.asOf}`);
    console.log(`Clientes: ${payload.customers} | Títulos: ${payload.titles} | Sync: ${payload.latestRun}`);
    for (const [kind, count] of Object.entries(counts)) {
      console.log(`  ${kind}: ${count}`);
    }
    const divergences = findings.filter((row) => row.kind.startsWith("DIVERGENCE"));
    console.log(`Divergências financeiras: ${divergences.length}`);
    for (const row of divergences.slice(0, 50)) {
      console.log(
        `  ${row.kind} ${row.cnpj} status=${row.commercialStatus} oficial=[${row.officialOverdueIds.join(",")}] comercial=[${row.commercialOfficialOverdueIds.join(",")}]`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
