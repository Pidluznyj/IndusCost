/**
 * Score e decisão da carteira, em lote.
 * QUOD e IEPTB: uma leitura por fonte. A decisão é `decideCommercialCredit`.
 * Não dispara consulta paga e não grava crédito.
 */
import type { CommercialDelinquencyAnalysis } from "./customerDelinquencyAnalysis.js";
import { analyzeManyCustomerDelinquency, type CustomerDelinquencyDb } from "./customerDelinquencyAnalysis.server.js";
import {
  confirmedRelatedExposure,
  decideCommercialCredit,
  type CommercialIeptbEvidence,
  type CommercialQuodEvidence,
} from "./commercialCreditDecision.js";
import { resolveConfirmedPendingProtest } from "./commercialCreditOccurrence.js";
import { resolveStoredExternalProtest } from "./commercialCreditDecision.server.js";
import { loadCorporateLinkGraphs } from "./corporateRelation.server.js";
import { loadCreditRelationSignals } from "./creditRelationFacts.server.js";
import {
  IEPTB_READ_FAILED,
  QUOD_READ_FAILED,
  groupConsultationsByCustomer,
  selectIeptbCreditEvidence,
  selectQuodCreditEvidence,
  type StoredIeptbConsultation,
  type StoredQuodConsultation,
} from "./creditEvidenceSelection.js";
import {
  portfolioCreditReadFailed,
  presentPortfolioCredit,
  type PortfolioCreditPublic,
} from "./portfolioCredit.js";
import { COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT } from "./commercialCreditDecision.js";

export type PortfolioCreditCustomer = {
  id: string;
  taxId?: string | null;
  nomusExternalPersonId?: number | null;
  cnpjRisk?: { score: number; verdict?: string | null } | null;
};

type PortfolioDb = CustomerDelinquencyDb;

type PortfolioReadModels = {
  quodDossierConsultation?: { findMany(args: unknown): Promise<StoredQuodConsultation[]> };
  ieptbOnlineConsultation?: { findMany(args: unknown): Promise<StoredIeptbConsultation[]> };
  customerCorporateLink?: {
    findMany(args: unknown): Promise<Array<{
      customerId?: string;
      relatedCustomerId?: string;
      status?: string | null;
      evidenceFingerprint?: string | null;
      closedAt?: Date | string | null;
    }>>;
  };
  commercialExternalProtest?: { findMany(args: unknown): Promise<Array<{ customerId?: string; status: string; effectiveFrom: Date; effectiveUntil: Date | null }>> };
  commercialCreditException?: { findMany(args: unknown): Promise<Array<{ id: string; customerId: string; scope: string; expiresAt: Date; revokedAt: Date | null }>> };
  commercialCreditOccurrence?: { findMany(args: unknown): Promise<Array<{ customerId: string; kind: string; status: string; origin: string; occurredAt: Date; titleExternalId: number | null; responsibleUserId: string | null; justification: string; closedAt: Date | null }>> };
};

function readModels(db: PortfolioDb): PortfolioReadModels {
  return db as PortfolioDb & PortfolioReadModels;
}

const QUOD_ABSENT: CommercialQuodEvidence = {
  state: "NOT_CONSULTED",
  confirmedRestriction: false,
  insufficient: false,
  cnpjMatches: true,
};

const IEPTB_ABSENT: CommercialIeptbEvidence = {
  state: "NOT_CONSULTED",
  confirmedProtest: false,
  insufficient: false,
  cnpjMatches: true,
};

async function loadRows<T>(
  read: (() => Promise<T[]>) | null
): Promise<{ rows: T[]; readFailed: boolean; available: boolean }> {
  if (!read) return { rows: [], readFailed: false, available: false };
  try {
    return { rows: await read(), readFailed: false, available: true };
  } catch (error) {
    console.error("portfolio-credit-read", error instanceof Error ? error.name : "error");
    return { rows: [], readFailed: true, available: true };
  }
}

export async function loadPortfolioCredit(
  db: PortfolioDb,
  customers: readonly PortfolioCreditCustomer[],
  now: Date = new Date(),
  limits?: { examineLimit?: number; maxCatalogRows?: number }
): Promise<Map<string, PortfolioCreditPublic>> {
  const result = new Map<string, PortfolioCreditPublic>();
  if (customers.length === 0) return result;
  const ids = customers.map((customer) => customer.id);
  const models = readModels(db);
  try {
    const [quodLoad, linkLoad] = await Promise.all([
      loadRows(models.quodDossierConsultation ? () => models.quodDossierConsultation!.findMany({
        where: { customerId: { in: ids } },
        orderBy: { consultedAt: "desc" },
        select: {
          customerId: true,
          cnpj: true,
          status: true,
          confirmedRestriction: true,
          insufficient: true,
          validUntil: true,
          consultedAt: true,
        },
      }) : null),
      models.customerCorporateLink
        ? loadCorporateLinkGraphs({ customerCorporateLink: models.customerCorporateLink }, ids)
        : Promise.resolve({ graphs: new Map(), readFailed: false }),
    ]);
    const rejectedByCustomer = new Map(
      [...linkLoad.graphs.entries()].map(([id, graph]) => [id, graph.rejected])
    );
    const manualConfirmedByCustomer = new Map(
      [...linkLoad.graphs.entries()].map(([id, graph]) => [id, graph.confirmedIds])
    );
    const signals = await loadCreditRelationSignals(db, customers, now, rejectedByCustomer, {
      ...limits,
      manualConfirmedByCustomer,
    });
    const sameRootPeersByCustomer = new Map(
      customers.map((customer) => [customer.id, signals.byCustomer.get(customer.id)?.confirmedIds ?? []])
    );
    const relatedIds = new Set<string>();
    for (const customer of customers) {
      const graph = linkLoad.graphs.get(customer.id);
      for (const id of graph?.confirmedIds ?? []) if (id !== customer.id) relatedIds.add(id);
      for (const id of sameRootPeersByCustomer.get(customer.id) ?? []) relatedIds.add(id);
    }
    const involved = [...new Set([...ids, ...relatedIds])];
    const extraQuodIds = involved.filter((id) => !ids.includes(id));
    if (extraQuodIds.length > 0 && models.quodDossierConsultation && !quodLoad.readFailed) {
      const extraQuod = await loadRows(() =>
        models.quodDossierConsultation!.findMany({
          where: { customerId: { in: extraQuodIds } },
          orderBy: { consultedAt: "desc" },
          select: {
            customerId: true,
            cnpj: true,
            status: true,
            confirmedRestriction: true,
            insufficient: true,
            validUntil: true,
            consultedAt: true,
          },
        })
      );
      if (extraQuod.readFailed) quodLoad.readFailed = true;
      else quodLoad.rows.push(...extraQuod.rows);
    }
    const ieptbLoad = await loadRows(models.ieptbOnlineConsultation ? () => models.ieptbOnlineConsultation!.findMany({
      where: { customerId: { in: involved } },
      orderBy: { consultedAt: "desc" },
      select: {
        customerId: true,
        cnpj: true,
        status: true,
        confirmedProtest: true,
        confirmedClear: true,
        insufficient: true,
        validUntil: true,
        consultedAt: true,
      },
    }) : null);
    const [delinquency, protests, exceptions, occurrences] = await Promise.all([
      analyzeManyCustomerDelinquency(db, involved, now),
      loadRows(models.commercialExternalProtest ? () => models.commercialExternalProtest!.findMany({
        where: { customerId: { in: involved } },
        select: { customerId: true, status: true, effectiveFrom: true, effectiveUntil: true },
      }) : null),
      loadRows(models.commercialCreditException ? () => models.commercialCreditException!.findMany({
        where: { customerId: { in: ids }, activeKey: "ACTIVE", revokedAt: null },
        select: { id: true, customerId: true, scope: true, expiresAt: true, revokedAt: true },
      }) : null),
      loadRows(models.commercialCreditOccurrence ? () => models.commercialCreditOccurrence!.findMany({
        where: { customerId: { in: ids } },
        select: {
          customerId: true,
          kind: true,
          status: true,
          origin: true,
          occurredAt: true,
          titleExternalId: true,
          responsibleUserId: true,
          justification: true,
          closedAt: true,
        },
      }) : null),
    ]);
    const quodByCustomer = groupConsultationsByCustomer(quodLoad.rows, involved);
    const ieptbByCustomer = groupConsultationsByCustomer(ieptbLoad.rows, involved);
    const protestsByCustomer = groupConsultationsByCustomer(protests.rows, involved);
    const exceptionsByCustomer = groupConsultationsByCustomer(exceptions.rows, ids);
    const occurrencesByCustomer = groupConsultationsByCustomer(occurrences.rows, ids);
    const auxiliaryReadFailed = linkLoad.readFailed || protests.readFailed || exceptions.readFailed || occurrences.readFailed;

    for (const customer of customers) {
      const quod = quodLoad.readFailed
        ? QUOD_READ_FAILED
        : quodLoad.available
          ? selectQuodCreditEvidence(quodByCustomer.get(customer.id) ?? [], now, customer.taxId)
          : QUOD_ABSENT;
      const ieptb = ieptbLoad.readFailed
        ? IEPTB_READ_FAILED
        : ieptbLoad.available
          ? selectIeptbCreditEvidence(ieptbByCustomer.get(customer.id) ?? [], now, customer.taxId)
          : IEPTB_ABSENT;
      const own = delinquency.get(customer.id);
      const graph = linkLoad.graphs.get(customer.id);
      const signal = signals.byCustomer.get(customer.id) ?? {
        confirmedIds: [],
        pendingCount: 1,
        overflow: true,
        readFailed: true,
      };
      const related = [...new Set([...(graph?.confirmedIds ?? []), ...signal.confirmedIds])]
        .filter((id) => id !== customer.id)
        .sort();
      const slice = related.slice(0, COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT);
      const complementaryFailure = !own || auxiliaryReadFailed;
      if (complementaryFailure && slice.length === 0) {
        result.set(customer.id, decorateReadFailure(customer, quod, ieptb, now));
        continue;
      }
      const ownAnalysis = own ?? unknownDelinquency(customer.id, now);
      const overflow =
        Boolean(graph?.overflow) ||
        signal.overflow ||
        signal.readFailed ||
        complementaryFailure ||
        related.length > COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT;
      const formal = resolveConfirmedPendingProtest({
        occurrences: occurrencesByCustomer.get(customer.id) ?? [],
        openProtestedTitleIds: ownAnalysis.evidence.protestedTitleIds,
        settledProtestedTitleIds: ownAnalysis.evidence.settledProtestedTitleIds ?? [],
      });
      const decision = decideCommercialCredit({
        customerId: customer.id,
        enforcement: "CREDIT_GRANT",
        paymentTerms: "30",
        delinquency: ownAnalysis,
        externalProtest: resolveStoredExternalProtest(protestsByCustomer.get(customer.id) ?? [], now),
        exceptions: exceptionsByCustomer.get(customer.id) ?? [],
        confirmedPendingProtest: formal.confirmedPending,
        suppressedProtestTitleIds: formal.suppressedTitleIds,
        cadastral: { score: customer.cnpjRisk?.score ?? null, verdict: customer.cnpjRisk?.verdict ?? null },
        quod,
        ieptb,
        relatedParties: slice.map((relatedId) => {
          const externalProtest = resolveStoredExternalProtest(protestsByCustomer.get(relatedId) ?? [], now);
          const relatedQuod = quodLoad.readFailed
            ? QUOD_READ_FAILED
            : quodLoad.available
              ? selectQuodCreditEvidence(quodByCustomer.get(relatedId) ?? [], now)
              : QUOD_ABSENT;
          const relatedIeptb = ieptbLoad.readFailed
            ? IEPTB_READ_FAILED
            : ieptbLoad.available
              ? selectIeptbCreditEvidence(ieptbByCustomer.get(relatedId) ?? [], now)
              : IEPTB_ABSENT;
          const exposure = confirmedRelatedExposure({ quod: relatedQuod, ieptb: relatedIeptb, externalProtest });
          return {
            customerId: relatedId,
            delinquency: delinquency.get(relatedId) ?? unknownDelinquency(relatedId, now),
            confirmedProtest: relatedProtest(ieptbByCustomer.get(relatedId) ?? [], now) || externalProtest === "CONFIRMED_CURRENT",
            owesMarket: exposure.owesMarket,
            incomplete: exposure.incomplete,
          };
        }),
        relatedPartyOverflow: overflow,
        pendingRelatedPartyCount: signal.pendingCount + (complementaryFailure ? 1 : 0),
        now,
      });
      result.set(customer.id, presentPortfolioCredit(decision, now));
    }
    return result;
  } catch (error) {
    console.error("portfolio-credit", error instanceof Error ? error.name : "error");
    for (const customer of customers) result.set(customer.id, portfolioCreditReadFailed(now));
    return result;
  }
}

function relatedProtest(rows: readonly StoredIeptbConsultation[], now: Date): boolean {
  const evidence = selectIeptbCreditEvidence(rows, now);
  return evidence.state === "VALID" && evidence.confirmedProtest === true;
}

function unknownDelinquency(customerId: string, now: Date): CommercialDelinquencyAnalysis {
  return {
    status: "UNKNOWN",
    unknownReason: "SYNC_UNAVAILABLE",
    overdueTitleCount: 0,
    overdueAmount: 0,
    openAmount: 0,
    maxDaysOverdue: 0,
    lastSyncedAt: null,
    evidence: {
      source: "NomusAccountsReceivable",
      toleranceDays: 0,
      toleranceUnit: "CALENDAR_DAYS",
      referenceDate: now.toISOString().slice(0, 10),
      cnpj: null,
      nomusPersonId: null,
      identity: "MISSING",
      syncRunStatus: null,
      payloadComplete: null,
      sourceMaxSyncedAt: null,
      includedTitleIds: [],
      overdueTitleIds: [],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
    },
  };
}

function decorateReadFailure(
  customer: PortfolioCreditCustomer,
  quod: CommercialQuodEvidence,
  ieptb: CommercialIeptbEvidence,
  now: Date
): PortfolioCreditPublic {
  const decision = decideCommercialCredit({
    customerId: customer.id,
    enforcement: "CREDIT_GRANT",
    paymentTerms: "30",
    delinquency: unknownDelinquency(customer.id, now),
    cadastral: { score: customer.cnpjRisk?.score ?? null, verdict: customer.cnpjRisk?.verdict ?? null },
    quod,
    ieptb,
    now,
  });
  const presented = presentPortfolioCredit(decision, now);
  presented.decision.readFailed = true;
  presented.decision.reasonLabel = "Leitura indisponível";
  presented.decision.decisionTitle = "CRÉDITO EM ANÁLISE";
  return presented;
}

export async function attachPortfolioCredit<T extends PortfolioCreditCustomer>(
  db: PortfolioDb,
  customers: readonly T[],
  now: Date = new Date()
): Promise<Array<T & { portfolioCredit: PortfolioCreditPublic }>> {
  const snapshots = await loadPortfolioCredit(db, customers, now);
  return customers.map((customer) => ({
    ...customer,
    portfolioCredit: snapshots.get(customer.id) ?? portfolioCreditReadFailed(now),
  }));
}

export async function attachPortfolioCreditToNestedCustomers<
  T extends {
    customerId: string;
    Customer?: {
      id: string;
      taxId?: string | null;
      nomusExternalPersonId?: number | null;
      cnpjRisk?: PortfolioCreditCustomer["cnpjRisk"];
    } | null;
  },
>(db: PortfolioDb, records: readonly T[], now: Date = new Date()): Promise<Array<T & { Customer?: T["Customer"] }>> {
  const byId = new Map<string, PortfolioCreditCustomer>();
  for (const row of records) {
    const customer = row.Customer;
    if (!row.customerId || !customer || customer.id !== row.customerId || byId.has(row.customerId)) continue;
    byId.set(row.customerId, {
      id: customer.id,
      taxId: customer.taxId ?? null,
      nomusExternalPersonId: customer.nomusExternalPersonId ?? null,
      cnpjRisk: customer.cnpjRisk ?? null,
    });
  }
  const snapshots = await loadPortfolioCredit(db, [...byId.values()], now);
  return records.map((row) => {
    if (!row.Customer || row.Customer.id !== row.customerId) return row;
    return {
      ...row,
      Customer: {
        ...row.Customer,
        portfolioCredit: snapshots.get(row.customerId) ?? portfolioCreditReadFailed(now),
      },
    };
  });
}
