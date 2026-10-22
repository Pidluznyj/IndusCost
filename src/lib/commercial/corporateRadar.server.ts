/**
 * Execução do Radar. A leitura não grava crédito, título nem comissão.
 * A sincronização do Nomus segue mesmo quando esta camada falha.
 */

import { classifyCorporateEmail, cnpjRoot, normalizeBrazilPhone, radarProfileVersion, scanCorporateRadar, type RadarCorrelation, type RadarMembership, type RadarParty } from "./corporateRadar.js";
import { corporateAddressKey } from "./corporateRelation.js";

export type RadarSignalRow = {
  id: string;
  pairKey: string;
  status: string;
  evidenceFingerprint: string;
  evidenceSummary: string;
};

export type CorporateRadarStore = {
  commercialCorporateRadarSignal?: {
    findUnique(args: { where: { pairKey: string } }): Promise<RadarSignalRow | null>;
    upsert(args: { where: { pairKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<RadarSignalRow>;
    findMany(args: unknown): Promise<RadarSignalRow[]>;
    updateMany?(args: unknown): Promise<{ count: number }>;
  };
  commercialCorporateRadarProfile?: {
    upsert(args: { where: { customerId: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
    findMany(args: unknown): Promise<Array<{ customerId: string; versionHash?: string | null }>>;
  };
  commercialCorporateRadarRun?: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst?(args: unknown): Promise<{ finishedAt: Date | null } | null>;
  };
};

export type RadarRunReport = {
  mode: "dry-run" | "portfolio" | "incremental" | "periodic";
  dryRun: boolean;
  examined: number;
  created: number;
  updated: number;
  queued: number;
  unchanged: number;
  errors: number;
  skipped: boolean;
  durationMs: number;
  genericKeysSkipped: number;
  samples: RadarCorrelation[];
};

let radarRunning = false;
const queued = new Map<string, string>();
let timer: NodeJS.Timeout | null = null;
let attempts = new Map<string, number>();

export function resetCorporateRadarForTests(): void {
  radarRunning = false;
  queued.clear();
  attempts = new Map();
  if (timer) clearTimeout(timer);
  timer = null;
}

export function radarQueueSize(): number {
  return queued.size;
}

export async function withRadarRetry<T>(work: () => Promise<T>, limit = 2): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("corporate-radar");
}

export async function runCorporateRadar(input: {
  db?: CorporateRadarStore | null;
  parties: readonly RadarParty[];
  memberships?: readonly RadarMembership[];
  seeds?: readonly string[];
  mode: RadarRunReport["mode"];
  dryRun: boolean;
  rejected?: readonly { pairKey: string; fingerprint: string }[];
  closedPairKeys?: readonly string[];
  now?: Date;
  persist?: boolean;
}): Promise<RadarRunReport> {
  if (radarRunning) {
    return emptyReport(input.mode, input.dryRun, true);
  }
  radarRunning = true;
  const started = Date.now();
  try {
    const scan = await withRadarRetry(() =>
      Promise.resolve(
        scanCorporateRadar({
          parties: input.parties,
          memberships: input.memberships,
          seeds: input.seeds,
          rejected: input.rejected,
          closedPairKeys: input.closedPairKeys,
          now: input.now,
        })
      )
    );
    const queue = scan.correlations.filter((row) => row.review || row.propagationEligible);
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    if (input.persist && !input.dryRun && input.db) {
      const saved = await persistRadarSignals(input.db, queue, input.now ?? new Date(), input.mode);
      created = saved.created;
      updated = saved.updated;
      unchanged = saved.unchanged;
      await persistRadarProfiles(input.db, input.seeds ? input.parties.filter((party) => input.seeds!.includes(party.customerId)) : input.parties, input.now ?? new Date());
      await input.db.commercialCorporateRadarRun?.create({
        data: {
          mode: input.mode,
          startedAt: new Date(started),
          finishedAt: new Date(),
          examined: scan.examined,
          created,
          updated,
          queued: queue.length,
          errors: 0,
          durationMs: Date.now() - started,
          checkpoint: input.now ?? new Date(),
          dryRun: false,
        },
      });
    }
    return {
      mode: input.mode,
      dryRun: input.dryRun || !input.persist,
      examined: scan.examined,
      created,
      updated,
      queued: queue.length,
      unchanged,
      errors: 0,
      skipped: false,
      durationMs: Date.now() - started,
      genericKeysSkipped: scan.genericKeysSkipped,
      samples: queue.slice(0, 5),
    };
  } finally {
    radarRunning = false;
  }
}

export async function persistRadarSignals(
  db: CorporateRadarStore,
  correlations: readonly RadarCorrelation[],
  now: Date,
  source: string
): Promise<{ created: number; updated: number; unchanged: number }> {
  const model = db.commercialCorporateRadarSignal;
  if (!model) return { created: 0, updated: 0, unchanged: 0 };
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const row of correlations) {
    if (row.classification === "NONE" || row.classification === "COMPLEMENTARY") continue;
    const current = await model.findUnique({ where: { pairKey: row.pairKey } });
    if (!current) {
      await model.upsert({
        where: { pairKey: row.pairKey },
        create: signalCreate(row, now, source),
        update: signalUpdate(row, now, null),
      });
      created += 1;
      continue;
    }
    if (current.status === "REJECTED" && current.evidenceFingerprint === row.fingerprint) {
      unchanged += 1;
      continue;
    }
    if (current.evidenceFingerprint === row.fingerprint && current.status === "OPEN") {
      unchanged += 1;
      continue;
    }
    const history = {
      at: now.toISOString(),
      fingerprint: current.evidenceFingerprint,
      summary: current.evidenceSummary,
      status: current.status,
    };
    await model.upsert({
      where: { pairKey: row.pairKey },
      create: signalCreate(row, now, source),
      update: signalUpdate(row, now, history),
    });
    updated += 1;
  }
  return { created, updated, unchanged };
}

export function scheduleCorporateRadar(customerId: string, reason: string): void {
  if (!customerId) return;
  queued.set(customerId, reason);
  if (timer || radarRunning) return;
  timer = setTimeout(() => {
    timer = null;
    void flushCorporateRadarQueue().catch((error) => {
      console.error("corporate-radar", error instanceof Error ? error.name : "error");
    });
  }, 200);
  timer.unref?.();
}

export async function flushCorporateRadarQueue(
  db?: CorporateRadarStore,
  parties: readonly RadarParty[] = [],
  memberships: readonly RadarMembership[] = []
): Promise<RadarRunReport | null> {
  const seeds = [...queued.keys()];
  if (seeds.length === 0 && parties.length === 0) return null;
  if (radarRunning) {
    return emptyReport("incremental", false, true);
  }
  for (const id of seeds) queued.delete(id);
  const store = db ?? (await loadRadarStore());
  const loaded = parties.length > 0 ? parties : await loadRadarParties(store, seeds);
  if (!store || loaded.length === 0) {
    for (const id of seeds) queued.set(id, "RETRY");
    return emptyReport("incremental", false, false);
  }
  try {
    const report = await withRadarRetry(() =>
      runCorporateRadar({
        db: store,
        parties: loaded,
        memberships,
        seeds: seeds.length > 0 ? seeds : undefined,
        mode: "incremental",
        dryRun: false,
        persist: true,
      })
    );
    if (queued.size > 0) scheduleCorporateRadar([...queued.keys()][0]!, "RETRY");
    return report;
  } catch (error) {
    console.error("corporate-radar", error instanceof Error ? error.name : "error");
    for (const id of seeds) {
      const count = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, count);
      if (count < 2) queued.set(id, "RETRY");
    }
    return { ...emptyReport("incremental", false, false), errors: seeds.length };
  }
}

async function loadRadarStore(): Promise<CorporateRadarStore | null> {
  try {
    const { prisma } = await import("../prisma.js");
    return prisma as unknown as CorporateRadarStore;
  } catch {
    return null;
  }
}

async function loadRadarParties(db: CorporateRadarStore | null, ids: readonly string[]): Promise<RadarParty[]> {
  const customer = (db as { customer?: { findMany(args: unknown): Promise<RadarParty[]> } } | null)?.customer;
  if (!customer || ids.length === 0) return [];
  try {
    const rows = await customer.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        taxId: true,
        companyName: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      customerId: (row as { id: string }).id,
      cnpj: (row as { taxId: string }).taxId,
      companyName: (row as { companyName: string }).companyName,
      phone: (row as { phone?: string | null }).phone,
      email: (row as { email?: string | null }).email,
      address: (row as { address?: string | null }).address,
      city: (row as { city?: string | null }).city,
      state: (row as { state?: string | null }).state,
      zipCode: (row as { zipCode?: string | null }).zipCode,
      updatedAt: (row as { updatedAt?: Date | null }).updatedAt,
    }));
  } catch {
    return [];
  }
}

export async function observeCustomerSyncRadar(work: () => Promise<void>): Promise<"ok" | "failed"> {
  try {
    await work();
    return "ok";
  } catch (error) {
    console.error("corporate-radar-sync", error instanceof Error ? error.name : "error");
    return "failed";
  }
}

export function selectPeriodicSeeds(parties: readonly RadarParty[], memberships: readonly RadarMembership[], since: Date | null): string[] {
  if (!since) return parties.map((party) => party.customerId);
  const ids = new Set<string>();
  for (const party of parties) {
    if (party.updatedAt && party.updatedAt.getTime() > since.getTime()) ids.add(party.customerId);
  }
  for (const row of memberships) {
    if (row.consultedAt && Date.parse(row.consultedAt) > since.getTime()) ids.add(row.subjectCustomerId);
  }
  return [...ids];
}

async function persistRadarProfiles(db: CorporateRadarStore, parties: readonly RadarParty[], now: Date): Promise<void> {
  const model = db.commercialCorporateRadarProfile;
  if (!model) return;
  for (const party of parties) {
    const email = classifyCorporateEmail(party.email);
    await model.upsert({
      where: { customerId: party.customerId },
      create: profileData(party, email, now),
      update: profileData(party, email, now),
    });
  }
}

function profileData(party: RadarParty, email: ReturnType<typeof classifyCorporateEmail>, now: Date): Record<string, unknown> {
  return {
    customerId: party.customerId,
    cnpjRoot: cnpjRoot(party.cnpj),
    phoneKey: normalizeBrazilPhone(party.phone),
    emailKey: email.emailClass === "CORPORATE" ? email.email : null,
    emailDomain: email.emailClass === "CORPORATE" ? email.domain : null,
    addressKey: corporateAddressKey(party),
    versionHash: radarProfileVersion(party),
    evaluatedAt: now,
  };
}

function signalCreate(row: RadarCorrelation, now: Date, source: string): Record<string, unknown> {
  return {
    pairKey: row.pairKey,
    customerId: row.customerId,
    relatedCustomerId: row.relatedCustomerId,
    classification: row.classification,
    patternCodes: row.patterns.map((pattern) => pattern.code).join(","),
    evidenceFingerprint: row.fingerprint,
    evidenceSummary: row.evidenceSummary,
    direction: row.direction,
    source,
    status: row.classification === "REJECTED" ? "REJECTED" : "OPEN",
    priorityRank: row.priorityRank,
    detectedAt: now,
    evaluatedAt: now,
    evidenceHistory: [],
  };
}

function signalUpdate(row: RadarCorrelation, now: Date, previous: Record<string, string> | null): Record<string, unknown> {
  return {
    classification: row.classification,
    patternCodes: row.patterns.map((pattern) => pattern.code).join(","),
    evidenceFingerprint: row.fingerprint,
    evidenceSummary: row.evidenceSummary,
    direction: row.direction,
    status: row.classification === "REJECTED" ? "REJECTED" : "OPEN",
    priorityRank: row.priorityRank,
    evaluatedAt: now,
    ...(previous ? { evidenceHistory: [previous] } : {}),
  };
}

function emptyReport(mode: RadarRunReport["mode"], dryRun: boolean, skipped: boolean): RadarRunReport {
  return {
    mode,
    dryRun,
    examined: 0,
    created: 0,
    updated: 0,
    queued: 0,
    unchanged: 0,
    errors: 0,
    skipped,
    durationMs: 0,
    genericKeysSkipped: 0,
    samples: [],
  };
}
