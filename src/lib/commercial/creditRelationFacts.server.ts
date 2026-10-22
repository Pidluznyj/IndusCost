/**
 * Sinais de relacionamento usados pela decisão de crédito.
 * A carteira e o detalhe chamam esta leitura para o mesmo instante.
 * Indício de telefone, e-mail ou endereço não vira vínculo confirmado.
 * Não consulta bureau e não grava crédito.
 */
import { normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import { COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT } from "./commercialCreditDecision.js";
import {
  collectRadarCreditSignals,
  loadCorporateRelationAssessment,
} from "./corporateRelation.server.js";
import { visibleCorporateCandidates, type CorporateCandidate } from "./corporateRelation.js";
import { scanCorporateRadar } from "./corporateRadar.js";
import { loadRadarCatalog, loadSameRootPeerMap } from "./corporateRadarCatalog.server.js";

export type CreditRelationSignal = {
  confirmedIds: string[];
  pendingCount: number;
  overflow: boolean;
  readFailed: boolean;
};

type RejectedLink = { relatedCustomerId: string; fingerprint: string | null };

function uniqueIds(values: readonly string[], selfId: string): string[] {
  return [...new Set(values.filter((id) => id && id !== selfId))].sort();
}

export async function loadCreditRelationSignals(
  db: object,
  customers: readonly { id: string; taxId?: string | null }[],
  now: Date,
  rejectedByCustomer: ReadonlyMap<string, readonly RejectedLink[]> = new Map(),
  options?: { examineLimit?: number; maxCatalogRows?: number }
): Promise<{ byCustomer: Map<string, CreditRelationSignal>; readFailed: boolean }> {
  const byCustomer = new Map<string, CreditRelationSignal>();
  if (customers.length === 0) return { byCustomer, readFailed: false };

  const [roots, catalog] = await Promise.all([
    loadSameRootPeerMap(db, customers, { examineLimit: options?.examineLimit }),
    loadRadarCatalog(db, { maxRows: options?.maxCatalogRows }),
  ]);
  const catalogFailed = roots.readFailed || catalog.readFailed || !catalog.complete;
  const named = new Map(catalog.parties.map((party) => [party.customerId, party]));
  const scan =
    catalogFailed || catalog.parties.length === 0
      ? null
      : scanCorporateRadar({
          parties: catalog.parties,
          seeds: customers.map((customer) => customer.id),
          now,
        });

  const needsQsa = await customersWithStoredRelation(db, customers);
  const probeFailed = needsQsa.readFailed;

  for (const customer of customers) {
    const rejected = rejectedByCustomer.get(customer.id) ?? [];
    let qsaRelations: string[] = [];
    let qsaCandidates: CorporateCandidate[] = [];
    let customerFailed = catalogFailed || roots.readFailed || probeFailed;
    if (!probeFailed && needsQsa.ids.has(customer.id)) {
      try {
        const assessment = await loadCorporateRelationAssessment(
          db as never,
          {
            customerId: customer.id,
            cnpj: normalizeCnpj(customer.taxId) || null,
            now,
            rejected,
          },
          { includeRadar: false, radarCatalog: catalog }
        );
        qsaRelations = assessment.relations.map((relation) => relation.relatedCustomerId);
        qsaCandidates = assessment.candidates;
        if (assessment.radarReadFailed) customerFailed = true;
      } catch (error) {
        console.error("credit-relation-qsa", error instanceof Error ? error.name : "error");
        customerFailed = true;
      }
    }
    const confirmed = new Set(qsaRelations);
    const radar = scan
      ? collectRadarCreditSignals(scan, customer.id, named, confirmed, now)
      : { relations: [], candidates: [] };
    const sameRoot = roots.peers.get(customer.id) ?? [];
    const rootIncomplete = roots.overflowCustomerIds.has(customer.id);
    const confirmedIds = uniqueIds(
      [...qsaRelations, ...radar.relations.map((relation) => relation.relatedCustomerId), ...sameRoot],
      customer.id
    );
    const pending = visibleCorporateCandidates(
      [...qsaCandidates, ...radar.candidates].filter(
        (candidate) => candidate.subjectCustomerId === customer.id && !confirmedIds.includes(candidate.relatedCustomerId)
      ),
      rejected
    );
    byCustomer.set(customer.id, {
      confirmedIds,
      pendingCount: pending.length + (customerFailed ? 1 : 0),
      overflow:
        customerFailed ||
        rootIncomplete ||
        sameRoot.length > COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT ||
        confirmedIds.length > COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT,
      readFailed: customerFailed,
    });
  }
  return { byCustomer, readFailed: catalogFailed || roots.readFailed || probeFailed };
}

async function customersWithStoredRelation(
  db: object,
  customers: readonly { id: string; taxId?: string | null }[]
): Promise<{ ids: Set<string>; readFailed: boolean }> {
  const ids = new Set<string>();
  const membership = (db as {
    commercialCorporateMembership?: { findMany?(args: unknown): Promise<Array<{ subjectCnpj?: string | null; subjectCustomerId?: string | null }>> };
  }).commercialCorporateMembership;
  const lookup = (db as {
    customerCnpjLookup?: {
      findMany?(args: unknown): Promise<Array<{ customerId?: string | null; cnpj?: string | null }>>;
      findFirst?(args: unknown): Promise<{ customerId?: string | null; cnpj?: string | null } | null>;
    };
  }).customerCnpjLookup;
  if (!membership?.findMany && !lookup?.findMany && !lookup?.findFirst) return { ids, readFailed: false };
  const customerIds = customers.map((customer) => customer.id);
  const cnpjs = [...new Set(customers.map((customer) => normalizeCnpj(customer.taxId)).filter((value) => value.length === 14))];
  try {
    if (membership?.findMany) {
      const or: object[] = [];
      if (customerIds.length > 0) or.push({ subjectCustomerId: { in: customerIds } });
      if (cnpjs.length > 0) or.push({ subjectCnpj: { in: cnpjs } });
      const rows = or.length === 0 ? [] : await membership.findMany({ where: { OR: or } });
      const byCnpj = new Map(customers.map((customer) => [normalizeCnpj(customer.taxId), customer.id]));
      for (const row of rows) {
        if (row.subjectCustomerId && customerIds.includes(row.subjectCustomerId)) ids.add(row.subjectCustomerId);
        const owner = byCnpj.get(normalizeCnpj(row.subjectCnpj));
        if (owner) ids.add(owner);
      }
    }
    if (lookup?.findMany) {
      const or: object[] = [];
      if (customerIds.length > 0) or.push({ customerId: { in: customerIds } });
      if (cnpjs.length > 0) or.push({ cnpj: { in: cnpjs } });
      const rows = or.length === 0 ? [] : await lookup.findMany({ where: { OR: or }, select: { customerId: true, cnpj: true } });
      const byCnpj = new Map(customers.map((customer) => [normalizeCnpj(customer.taxId), customer.id]));
      for (const row of rows) {
        if (row.customerId && customerIds.includes(row.customerId)) ids.add(row.customerId);
        const owner = byCnpj.get(normalizeCnpj(row.cnpj));
        if (owner) ids.add(owner);
      }
    } else if (lookup?.findFirst) {
      for (const customer of customers) {
        const cnpj = normalizeCnpj(customer.taxId);
        const row = await lookup.findFirst({
          where: { OR: [{ customerId: customer.id }, ...(cnpj ? [{ cnpj }] : [])] },
          orderBy: { fetchedAt: "desc" },
        });
        if (row) ids.add(customer.id);
      }
    }
    return { ids, readFailed: false };
  } catch (error) {
    console.error("credit-relation-probe", error instanceof Error ? error.name : "error");
    return { ids, readFailed: true };
  }
}
