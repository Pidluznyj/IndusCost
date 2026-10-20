import { randomUUID } from "node:crypto";
import { aggregateCnpjIntelligence, resolveAggregateSourceLabel } from "@/src/lib/companyCnpjAggregator.js";
import { CompanyIntelligenceError } from "@/src/lib/companyCnpjErrors.js";
import { buildCommercialInsightsBundle } from "@/src/lib/companyCommercialInsights.js";
import { calculateCommercialRiskScore } from "@/src/lib/companyCommercialRiskScore.js";
import { buildStructuredNormalizedSummary, type NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";

const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
import type { CnpjWeeklyRefreshConfig } from "./config.js";
import { sanitizeCnpjRefreshError } from "./config.js";
import { detectRelevantCadastralChanges, retainTrustedCadastralFields } from "./changes.js";
import { classifyPartyDocuments, partyKindForCnpj } from "./eligibility.js";
import { dueCnpjWeeklyRefreshSlot } from "./schedule.js";
import type {
  CnpjRefreshItemRecord,
  CnpjRefreshRunRecord,
  CnpjRefreshStore,
  CustomerOfficialSnapshot,
  SupplierOfficialSnapshot,
} from "./store.js";
import { createThrottledCnpjFetch } from "./throttle.js";

const SOURCE_LABEL = "brasilapi+publica.cnpj.ws";

export type CnpjRefreshRunnerDeps = {
  store: CnpjRefreshStore;
  config: CnpjWeeklyRefreshConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

function nowOf(deps: CnpjRefreshRunnerDeps): Date {
  return deps.now?.() ?? new Date();
}

function blank(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim();
  return !text || text === "—";
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return String(left ?? "").trim().replace(/\s+/g, " ").toUpperCase() ===
    String(right ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function zipDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function newRun(input: {
  trigger: CnpjRefreshRunRecord["trigger"];
  slot: string | null;
  userId: string | null;
  now: Date;
}): CnpjRefreshRunRecord {
  return {
    id: randomUUID(),
    scheduleSlot: input.slot,
    trigger: input.trigger,
    status: "PENDING",
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    eligibleCount: 0,
    consultedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    partialCount: 0,
    invalidCount: 0,
    missingDocumentCount: 0,
    customerCount: 0,
    supplierCount: 0,
    lastCnpj: null,
    sourceLabel: SOURCE_LABEL,
    statusDetail: "Banco Central fora do escopo cadastral (not_applicable).",
    errorMessage: null,
    requestedByUserId: input.userId,
    createdAt: input.now,
  };
}

async function syncPlan(run: CnpjRefreshRunRecord, deps: CnpjRefreshRunnerDeps): Promise<void> {
  const classified = classifyPartyDocuments(await deps.store.listParties());
  const existing = new Set((await deps.store.listItems(run.id)).map((item) => item.subjectKey));
  const cnpjs = classified.filter((row) => row.kind === "CNPJ");
  const limit = deps.config.maxItems ?? cnpjs.length;
  const selected = cnpjs.slice(0, limit);
  const items: CnpjRefreshItemRecord[] = [];

  for (const row of selected) {
    if (existing.has(row.subjectKey)) continue;
    items.push({
      id: randomUUID(),
      runId: run.id,
      subjectKey: row.subjectKey,
      cnpj: row.cnpj,
      status: "PENDING",
      partyKind: partyKindForCnpj(row.customers, row.suppliers),
      customerId: row.customers[0] ?? null,
      supplierIds: row.suppliers,
      digitLength: 14,
      documentClass: "CNPJ",
      attempts: 0,
      lookupId: null,
      errorCode: null,
      errorMessage: null,
      consultedAt: null,
    });
  }

  for (const row of classified) {
    if (row.kind === "CNPJ" || existing.has(row.subjectKey)) continue;
    items.push({
      id: randomUUID(),
      runId: run.id,
      subjectKey: row.subjectKey,
      cnpj: null,
      status: row.kind === "MISSING" ? "MISSING_DOCUMENT" : "INVALID_DOCUMENT",
      partyKind: row.partyType,
      customerId: row.partyType === "CUSTOMER" ? row.partyId : null,
      supplierIds: row.partyType === "SUPPLIER" ? [row.partyId] : [],
      digitLength: row.digitLength,
      documentClass: row.kind,
      attempts: 0,
      lookupId: null,
      errorCode: row.kind,
      errorMessage: null,
      consultedAt: null,
    });
  }

  if (items.length > 0) await deps.store.insertItems(items);
  const all = await deps.store.listItems(run.id);
  await deps.store.updateRun(run.id, {
    eligibleCount: cnpjs.length,
    invalidCount: all.filter((item) => item.status === "INVALID_DOCUMENT" || item.documentClass === "CPF" || item.documentClass === "INVALID").length,
    missingDocumentCount: all.filter((item) => item.documentClass === "MISSING").length,
    customerCount: new Set(cnpjs.flatMap((row) => row.customers)).size,
    supplierCount: new Set(cnpjs.flatMap((row) => row.suppliers)).size,
    statusDetail:
      deps.config.maxItems != null && cnpjs.length > deps.config.maxItems
        ? `Volume limitado a ${deps.config.maxItems} CNPJ(s) para homologação. Banco Central: not_applicable.`
        : "Banco Central fora do escopo cadastral (not_applicable).",
  });
}

async function tally(runId: string, deps: CnpjRefreshRunnerDeps): Promise<void> {
  const items = await deps.store.listItems(runId);
  const pending = items.some((item) => item.status === "PENDING");
  const failed = items.filter((item) => item.status === "FAILED").length;
  const partial = items.filter((item) => item.status === "PARTIAL").length;
  const consulted = items.filter((item) =>
    item.status === "UPDATED" || item.status === "UNCHANGED" || item.status === "PARTIAL"
  ).length;
  const run = await deps.store.findRun(runId);
  const covered = consulted + failed;
  let status: CnpjRefreshRunRecord["status"] = "COMPLETED";
  if (pending) status = "INTERRUPTED";
  else if (consulted === 0 && failed > 0) status = "FAILED";
  else if (failed > 0 || partial > 0 || (run != null && covered < run.eligibleCount)) status = "PARTIAL";
  await deps.store.updateRun(runId, {
    consultedCount: consulted,
    updatedCount: items.filter((item) => item.status === "UPDATED").length,
    unchangedCount: items.filter((item) => item.status === "UNCHANGED").length,
    failedCount: failed,
    partialCount: partial,
    status,
    finishedAt: pending ? null : nowOf(deps),
  });
}

function officialDivergences(input: {
  cnpj: string;
  customer: CustomerOfficialSnapshot | null;
  suppliers: SupplierOfficialSnapshot[];
  summary: NormalizedCnpjSummary;
}): Array<{ partyKind: string; partyId: string; field: string; officialValue: string | null; consultedValue: string | null }> {
  const rows: Array<{ partyKind: string; partyId: string; field: string; officialValue: string | null; consultedValue: string | null }> = [];
  const compare = (
    partyKind: string,
    partyId: string,
    field: string,
    officialValue: string | null,
    consultedValue: string | null,
    digits = false
  ) => {
    if (blank(consultedValue)) return;
    const same = digits ? zipDigits(officialValue) === zipDigits(consultedValue) : sameText(officialValue, consultedValue);
    if (same) return;
    rows.push({ partyKind, partyId, field, officialValue, consultedValue });
  };
  if (input.customer) {
    compare("CUSTOMER", input.customer.id, "companyName", input.customer.companyName, input.summary.companyName);
    compare("CUSTOMER", input.customer.id, "tradeName", input.customer.tradeName, input.summary.tradeName);
    compare("CUSTOMER", input.customer.id, "address", input.customer.address, input.summary.address);
    compare("CUSTOMER", input.customer.id, "city", input.customer.city, input.summary.city);
    compare("CUSTOMER", input.customer.id, "state", input.customer.state, input.summary.state);
    compare("CUSTOMER", input.customer.id, "zipCode", input.customer.zipCode, input.summary.zipCode, true);
  }
  for (const supplier of input.suppliers) {
    compare("SUPPLIER", supplier.id, "legalName", supplier.legalName, input.summary.companyName);
    compare("SUPPLIER", supplier.id, "tradeName", supplier.tradeName, input.summary.tradeName);
  }
  return rows;
}

async function claim(runId: string, deps: CnpjRefreshRunnerDeps): Promise<boolean> {
  const now = nowOf(deps);
  const known = await deps.store.listRuns(20);
  for (const run of known) {
    if (run.id === runId || run.status !== "RUNNING") continue;
    const fresh = now.getTime() - (run.heartbeatAt?.getTime() ?? 0) < deps.config.heartbeatStaleMs;
    if (!fresh) await deps.store.updateRun(run.id, { status: "INTERRUPTED", finishedAt: now });
  }
  const running = await deps.store.findRunning(now, deps.config.heartbeatStaleMs);
  if (running) return false;
  const current = await deps.store.findRun(runId);
  if (!current || current.status === "COMPLETED") return false;
  if (current.status === "RUNNING") {
    const fresh = now.getTime() - (current.heartbeatAt?.getTime() ?? 0) < deps.config.heartbeatStaleMs;
    if (fresh) return false;
    await deps.store.updateRun(runId, { status: "INTERRUPTED" });
  }
  try {
    await deps.store.updateRun(runId, {
      status: "RUNNING",
      heartbeatAt: now,
      startedAt: current.startedAt ?? now,
      finishedAt: null,
      errorMessage: null,
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "ALREADY_RUNNING") return false;
    throw error;
  }
}

export async function processCnpjRefreshRun(runId: string, deps: CnpjRefreshRunnerDeps): Promise<void> {
  const claimed = await claim(runId, deps);
  if (!claimed) return;
  await deps.store.audit({
    entityType: "CnpjRefreshRun",
    entityId: runId,
    action: "CNPJ_REFRESH_RUN",
    newValue: "RUNNING",
    performedBy: (await deps.store.findRun(runId))?.requestedByUserId ?? null,
  });
  const planned = await deps.store.findRun(runId);
  if (!planned) return;
  try {
    await syncPlan(planned, deps);
  } catch (error) {
    await deps.store.updateRun(runId, {
      status: "FAILED",
      errorMessage: sanitizeCnpjRefreshError(error),
      finishedAt: nowOf(deps),
    });
    return;
  }

  const fetchImpl = createThrottledCnpjFetch(deps.config, {
    fetchImpl: deps.fetchImpl ?? fetch,
    sleep: deps.sleep,
    now: deps.now ? () => deps.now!().getTime() : undefined,
  });
  const sellerUf = (process.env.COMPANY_INTELLIGENCE_SELLER_UF ?? "PR").trim().toUpperCase();
  const items = await deps.store.listItems(runId);

  for (const item of items) {
    if (item.status !== "PENDING" || !item.cnpj) continue;
    const beat = nowOf(deps);
    await deps.store.updateRun(runId, { heartbeatAt: beat, lastCnpj: item.cnpj, status: "RUNNING" });
    try {
      const aggregate = await aggregateCnpjIntelligence({ cnpj: item.cnpj, fetchImpl });
      const previous = await deps.store.latestLookup(item.cnpj);
      const summary = retainTrustedCadastralFields(previous?.summary ?? null, aggregate.summary, aggregate.partialSuccess);
      const risk = calculateCommercialRiskScore(summary);
      const commercial = buildCommercialInsightsBundle(summary, risk, sellerUf);
      const consultedAt = nowOf(deps);
      const lookup = await deps.store.insertLookup({
        cnpj: item.cnpj,
        customerId: item.customerId,
        source: resolveAggregateSourceLabel(aggregate.sources),
        summary: { ...summary, ...buildStructuredNormalizedSummary(summary) },
        riskScore: risk.score,
        riskVerdict: risk.verdict,
        riskDetails: risk,
        commercialInsights: commercial,
        rawJson: {
          ...aggregate.rawEnvelope,
          fieldProvenance: aggregate.fieldProvenance,
          warnings: aggregate.warnings,
          partialSuccess: aggregate.partialSuccess,
        },
        fetchedAt: consultedAt,
        expiresAt: new Date(consultedAt.getTime() + LOOKUP_TTL_MS),
        fetchedByUserId: (await deps.store.findRun(runId))?.requestedByUserId ?? null,
      });
      const changes = detectRelevantCadastralChanges({
        previous: previous?.summary ?? null,
        next: summary,
        previousScore: previous?.riskScore ?? null,
        nextScore: risk.score,
        previousVerdict: previous?.riskVerdict ?? null,
        nextVerdict: risk.verdict,
      });
      if (changes.length > 0) {
        await deps.store.insertChanges(
          changes.map((change) => ({
            id: randomUUID(),
            runId,
            cnpj: item.cnpj!,
            field: change.field,
            previousValue: change.previousValue,
            nextValue: change.nextValue,
            source: lookup.id ? resolveAggregateSourceLabel(aggregate.sources) : null,
            consultedAt,
            detectedAt: consultedAt,
            lookupId: lookup.id,
          }))
        );
      }
      const customer = item.customerId ? await deps.store.readCustomer(item.customerId) : null;
      const suppliers = [];
      for (const supplierId of item.supplierIds) {
        const supplier = await deps.store.readSupplier(supplierId);
        if (supplier) suppliers.push(supplier);
      }
      const divergences = officialDivergences({ cnpj: item.cnpj, customer, suppliers, summary });
      if (divergences.length > 0) {
        await deps.store.insertDivergences(
          divergences.map((row) => ({
            id: randomUUID(),
            runId,
            cnpj: item.cnpj!,
            partyKind: row.partyKind,
            partyId: row.partyId,
            field: row.field,
            officialValue: row.officialValue,
            consultedValue: row.consultedValue,
            detectedAt: consultedAt,
          }))
        );
      }
      await deps.store.updateItem(item.id, {
        status: aggregate.partialSuccess ? "PARTIAL" : changes.length > 0 ? "UPDATED" : "UNCHANGED",
        attempts: item.attempts + 1,
        lookupId: lookup.id,
        consultedAt,
        errorCode: null,
        errorMessage: null,
      });
    } catch (error) {
      const code = error instanceof CompanyIntelligenceError ? error.code : "UPSTREAM_ERROR";
      await deps.store.updateItem(item.id, {
        status: "FAILED",
        attempts: item.attempts + 1,
        errorCode: code,
        errorMessage: sanitizeCnpjRefreshError(error),
        consultedAt: nowOf(deps),
      });
    }
  }

  await tally(runId, deps);
  const finished = await deps.store.findRun(runId);
  await deps.store.audit({
    entityType: "CnpjRefreshRun",
    entityId: runId,
    action: "CNPJ_REFRESH_RUN",
    newValue: finished?.status ?? "FAILED",
    performedBy: finished?.requestedByUserId ?? null,
  });
}

async function createRun(
  input: { trigger: CnpjRefreshRunRecord["trigger"]; slot: string | null; userId: string | null },
  deps: CnpjRefreshRunnerDeps
): Promise<CnpjRefreshRunRecord> {
  const now = nowOf(deps);
  if (input.slot && input.trigger === "SCHEDULED") {
    const existing = await deps.store.findScheduledRun(input.slot);
    if (existing) return existing;
  }
  const run = newRun({ ...input, now });
  try {
    await deps.store.insertRun(run);
    return run;
  } catch (error) {
    if ((error as { code?: string }).code === "SLOT_EXISTS" && input.slot) {
      const existing = await deps.store.findScheduledRun(input.slot);
      if (existing) return existing;
    }
    throw error;
  }
}

export function createCnpjRefreshRunner(deps: CnpjRefreshRunnerDeps) {
  let active: Promise<void> | null = null;
  return {
    get busy() {
      return active != null;
    },
    enqueue(runId: string) {
      if (active) return active;
      active = processCnpjRefreshRun(runId, deps).finally(() => {
        active = null;
      });
      return active;
    },
    async startScheduled(at = nowOf(deps)) {
      const running = await deps.store.findRunning(at, deps.config.heartbeatStaleMs);
      if (running || active) return { action: "running" as const, runId: running?.id ?? null };
      const slot = dueCnpjWeeklyRefreshSlot(at);
      const existing = await deps.store.findScheduledRun(slot);
      if (existing?.status === "COMPLETED") return { action: "completed" as const, runId: existing.id };
      if (existing?.status === "RUNNING") {
        const fresh = at.getTime() - (existing.heartbeatAt?.getTime() ?? 0) < deps.config.heartbeatStaleMs;
        if (fresh) return { action: "running" as const, runId: existing.id };
        await deps.store.updateRun(existing.id, { status: "INTERRUPTED" });
      }
      const run = existing ?? (await createRun({ trigger: "SCHEDULED", slot, userId: null }, deps));
      await this.enqueue(run.id);
      return { action: existing ? ("resume" as const) : ("started" as const), runId: run.id };
    },
    async startManual(userId: string) {
      const at = nowOf(deps);
      const running = await deps.store.findRunning(at, deps.config.heartbeatStaleMs);
      if (running || active) return { ok: false as const, code: "ALREADY_RUNNING" as const, runId: running?.id ?? null };
      const run = await createRun({ trigger: "MANUAL", slot: null, userId }, deps);
      const task = this.enqueue(run.id);
      return { ok: true as const, runId: run.id, task };
    },
    async retryFailures(runId: string, userId: string) {
      const at = nowOf(deps);
      const running = await deps.store.findRunning(at, deps.config.heartbeatStaleMs);
      if (running || active) return { ok: false as const, code: "ALREADY_RUNNING" as const };
      const run = await deps.store.findRun(runId);
      if (!run) return { ok: false as const, code: "NOT_FOUND" as const };
      const failed = (await deps.store.listItems(runId)).filter(
        (item) => item.status === "FAILED" || item.status === "PARTIAL"
      );
      if (failed.length === 0) return { ok: false as const, code: "NOTHING_TO_RETRY" as const };
      for (const item of failed) {
        await deps.store.updateItem(item.id, { status: "PENDING", errorCode: null, errorMessage: null });
      }
      await deps.store.updateRun(runId, {
        status: "PENDING",
        finishedAt: null,
        requestedByUserId: userId,
        trigger: run.trigger === "SCHEDULED" ? "SCHEDULED" : "RETRY_FAILURES",
      });
      await this.enqueue(runId);
      return { ok: true as const, runId, retried: failed.length };
    },
  };
}

export async function ensureScheduledCnpjRefresh(deps: CnpjRefreshRunnerDeps, at = nowOf(deps)) {
  return createCnpjRefreshRunner(deps).startScheduled(at);
}
