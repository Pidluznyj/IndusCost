import { executePaidIeptbConsultation, publicIeptbStatus } from "@/src/lib/ieptbOnline/query.js";
import type { IeptbConsultationRecord, IeptbStore } from "@/src/lib/ieptbOnline/store.js";
import { executePaidQuodConsultation, publicQuodStatus } from "@/src/lib/quodDossier/query.js";
import type { QuodConsultationRecord, QuodStore } from "@/src/lib/quodDossier/store.js";
import { hintProtestOverlap } from "@/src/lib/ieptbOnline/parse.js";
import {
  formatPackagePrice,
  quodBudgetMonthWindow,
  type CreditIntelligencePackageConfig,
} from "./config.js";
import { composePackageQuote, type PackageQuote, type PackageSourceState } from "./compose.js";

export type PackageExecuteCode =
  | "CONSENT_REQUIRED"
  | "INVALID_CNPJ"
  | "IN_FLIGHT"
  | "UNKNOWN_BILLING"
  | "BUDGET"
  | "PARTIAL"
  | "OK"
  | "DISABLED";

export type PackageExecuteOutcome = {
  code: PackageExecuteCode;
  charged: boolean;
  authorizedCostCents: number;
  quote: PackageQuote;
  quod: QuodConsultationRecord | null;
  ieptb: IeptbConsultationRecord | null;
  overlaps: ReturnType<typeof hintProtestOverlap>;
  complete: boolean;
};

function asState(value: string): PackageSourceState {
  if (
    value === "VALID" ||
    value === "STALE" ||
    value === "IN_PROGRESS" ||
    value === "FAILED" ||
    value === "PARTIAL" ||
    value === "UNKNOWN_BILLING" ||
    value === "UNAVAILABLE" ||
    value === "RESTRICTED"
  ) {
    return value;
  }
  return "NOT_CONSULTED";
}

function overlapFrom(quod: QuodConsultationRecord | null, ieptb: IeptbConsultationRecord | null) {
  const quodCities =
    quod?.sections?.protests.groups.flatMap((group) =>
      group.offices.map((office) => ({ city: office.city, amount: office.amount }))
    ) ?? [];
  const ieptbTitles =
    ieptb?.sections?.states.flatMap((group) =>
      group.offices.flatMap((office) =>
        office.titles.map((title) => ({ city: office.city, amount: title.amount, date: title.protestedAt }))
      )
    ) ?? [];
  return hintProtestOverlap({ quodCities, ieptbTitles });
}

export async function executeCreditIntelligencePackage(input: {
  quodStore: QuodStore;
  ieptbStore: IeptbStore;
  config: CreditIntelligencePackageConfig;
  customerId: string;
  companyName: string;
  cnpj: string;
  consent: boolean;
  idempotencyKey: string;
  userId: string;
  role: string;
  forceRefresh?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<PackageExecuteOutcome> {
  const now = input.now ?? new Date();
  const quodRow = await input.quodStore.findLatestSucceeded(input.customerId);
  const ieptbRow = await input.ieptbStore.findLatestSucceeded(input.customerId);
  const quodState = asState(publicQuodStatus(quodRow, now).state);
  const ieptbPublic = publicIeptbStatus(ieptbRow, now).state;
  const ieptbState = asState(ieptbPublic);
  const quote = composePackageQuote({
    quodEnabled: input.config.quod.enabled,
    ieptbEnabled: input.config.ieptb.enabled,
    quodPriceCents: input.config.quod.unitPriceCents,
    ieptbPriceCents: input.config.ieptb.unitPriceCents,
    quodState,
    ieptbState,
    forceRefresh: input.forceRefresh === true,
  });

  const empty = (code: PackageExecuteCode): PackageExecuteOutcome => ({
    code,
    charged: false,
    authorizedCostCents: quote.totalCents,
    quote,
    quod: quodRow,
    ieptb: ieptbRow,
    overlaps: overlapFrom(quodRow, ieptbRow),
    complete: quote.complete,
  });

  if (input.consent !== true) return empty("CONSENT_REQUIRED");
  if (!/^\d{14}$/.test(input.cnpj)) return empty("INVALID_CNPJ");
  if (quote.blockedReason === "IN_FLIGHT") return empty("IN_FLIGHT");
  if (quote.blockedReason === "UNKNOWN_BILLING") return empty("UNKNOWN_BILLING");
  if (quote.quod.action !== "QUERY" && quote.ieptb.action !== "QUERY") {
    return {
      code: "OK",
      charged: false,
      authorizedCostCents: 0,
      quote,
      quod: quodRow,
      ieptb: ieptbRow,
      overlaps: overlapFrom(quodRow, ieptbRow),
      complete: quote.complete,
    };
  }

  const month = quodBudgetMonthWindow(now);
  if (input.config.monthlyLimitCents > 0) {
    const spent =
      (await input.quodStore.monthSpend(month.start, month.end)) +
      (await input.ieptbStore.monthSpend(month.start, month.end));
    if (spent + quote.totalCents > input.config.monthlyLimitCents) return empty("BUDGET");
  }

  let quod = quodRow;
  let ieptb = ieptbRow;
  let charged = false;
  let quodCode: string | null = null;
  let ieptbCode: string | null = null;

  if (quote.quod.action === "QUERY") {
    const outcome = await executePaidQuodConsultation({
      store: input.quodStore,
      config: input.config.quod,
      customerId: input.customerId,
      companyName: input.companyName,
      cnpj: input.cnpj,
      consent: true,
      idempotencyKey: `${input.idempotencyKey}:quod`,
      userId: input.userId,
      role: input.role,
      forceRefresh: input.forceRefresh === true,
      now,
      fetchImpl: input.fetchImpl,
    });
    quodCode = outcome.code;
    if (outcome.row) quod = outcome.row;
    charged = charged || outcome.charged;
  }

  if (quote.ieptb.action === "QUERY") {
    const outcome = await executePaidIeptbConsultation({
      store: input.ieptbStore,
      config: input.config.ieptb,
      customerId: input.customerId,
      companyName: input.companyName,
      cnpj: input.cnpj,
      consent: true,
      idempotencyKey: `${input.idempotencyKey}:ieptb`,
      userId: input.userId,
      role: input.role,
      forceRefresh: input.forceRefresh === true,
      now,
      fetchImpl: input.fetchImpl,
    });
    ieptbCode = outcome.code;
    if (outcome.row) ieptb = outcome.row;
    charged = charged || outcome.charged;
  }

  const nextQuote = composePackageQuote({
    quodEnabled: input.config.quod.enabled,
    ieptbEnabled: input.config.ieptb.enabled,
    quodPriceCents: input.config.quod.unitPriceCents,
    ieptbPriceCents: input.config.ieptb.unitPriceCents,
    quodState: asState(publicQuodStatus(quod, now).state),
    ieptbState: asState(publicIeptbStatus(ieptb, now).state),
  });
  const failed =
    (quote.quod.action === "QUERY" && quodCode && quodCode !== "OK" && quodCode !== "CACHE_VALID" && quodCode !== "IDEMPOTENT") ||
    (quote.ieptb.action === "QUERY" && ieptbCode && ieptbCode !== "OK" && ieptbCode !== "CACHE_VALID" && ieptbCode !== "IDEMPOTENT");
  const budgetFail = quodCode === "BUDGET" || ieptbCode === "BUDGET";
  return {
    code: budgetFail ? "BUDGET" : failed || !nextQuote.complete ? "PARTIAL" : "OK",
    charged,
    authorizedCostCents: quote.totalCents,
    quote: nextQuote,
    quod,
    ieptb,
    overlaps: overlapFrom(quod, ieptb),
    complete: nextQuote.complete,
  };
}

export function packagePriceSummary(quote: PackageQuote): {
  quod: string;
  ieptb: string;
  total: string;
} {
  return {
    quod: formatPackagePrice(quote.quod.billedCents),
    ieptb: formatPackagePrice(quote.ieptb.billedCents),
    total: quote.totalLabel,
  };
}
