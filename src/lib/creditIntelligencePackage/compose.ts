import { IEPTB_ONLINE_PRODUCT } from "@/src/lib/ieptbOnline/config.js";
import { QUOD_DOSSIER_PRODUCT } from "@/src/lib/quodDossier/config.js";
import { formatPackagePrice } from "./config.js";

export type PackageSourceState =
  | "NOT_CONSULTED"
  | "VALID"
  | "STALE"
  | "IN_PROGRESS"
  | "FAILED"
  | "PARTIAL"
  | "UNKNOWN_BILLING"
  | "UNAVAILABLE"
  | "RESTRICTED";

export type PackageSourceAction = "CACHE" | "QUERY" | "SKIP";

export type PackageQuoteLine = {
  product: string;
  action: PackageSourceAction;
  state: PackageSourceState;
  unitPriceCents: number;
  billedCents: number;
  note: string;
};

export type PackageQuote = {
  quod: PackageQuoteLine;
  ieptb: PackageQuoteLine;
  totalCents: number;
  totalLabel: string;
  complete: boolean;
  blockedReason: "IN_FLIGHT" | "UNKNOWN_BILLING" | "DISABLED" | null;
};

const QUERY_STATES: PackageSourceState[] = ["NOT_CONSULTED", "STALE", "FAILED", "PARTIAL"];

function line(input: {
  product: string;
  enabled: boolean;
  state: PackageSourceState;
  unitPriceCents: number;
  forceRefresh: boolean;
}): PackageQuoteLine {
  if (!input.enabled) {
    return {
      product: input.product,
      action: "SKIP",
      state: input.state === "NOT_CONSULTED" ? "UNAVAILABLE" : input.state,
      unitPriceCents: input.unitPriceCents,
      billedCents: 0,
      note: "Produto desabilitado neste ambiente. Nenhuma consulta será disparada.",
    };
  }
  if (input.state === "IN_PROGRESS") {
    return {
      product: input.product,
      action: "SKIP",
      state: input.state,
      unitPriceCents: input.unitPriceCents,
      billedCents: 0,
      note: "Já existe uma consulta em andamento para este CNPJ.",
    };
  }
  if (input.state === "UNKNOWN_BILLING") {
    return {
      product: input.product,
      action: "SKIP",
      state: input.state,
      unitPriceCents: input.unitPriceCents,
      billedCents: 0,
      note: "Cobrança anterior indeterminada. Não reenviar automaticamente.",
    };
  }
  if (input.state === "VALID" && !input.forceRefresh) {
    return {
      product: input.product,
      action: "CACHE",
      state: input.state,
      unitPriceCents: input.unitPriceCents,
      billedCents: 0,
      note: "Consulta válida reutilizada. Nova cobrança: R$ 0,00.",
    };
  }
  if (input.forceRefresh || QUERY_STATES.includes(input.state) || input.state === "VALID") {
    return {
      product: input.product,
      action: "QUERY",
      state: input.state,
      unitPriceCents: input.unitPriceCents,
      billedCents: input.unitPriceCents,
      note: input.forceRefresh
        ? "Reconsulta antecipada autorizada. Gera nova cobrança."
        : `Nova consulta prevista: ${formatPackagePrice(input.unitPriceCents)}.`,
    };
  }
  return {
    product: input.product,
    action: "SKIP",
    state: input.state,
    unitPriceCents: input.unitPriceCents,
    billedCents: 0,
    note: "Fonte indisponível nesta operação.",
  };
}

export function composePackageQuote(input: {
  quodEnabled: boolean;
  ieptbEnabled: boolean;
  quodPriceCents: number;
  ieptbPriceCents: number;
  quodState: PackageSourceState;
  ieptbState: PackageSourceState;
  forceRefresh?: boolean;
}): PackageQuote {
  const forceRefresh = input.forceRefresh === true;
  const quod = line({
    product: QUOD_DOSSIER_PRODUCT,
    enabled: input.quodEnabled,
    state: input.quodState,
    unitPriceCents: input.quodPriceCents,
    forceRefresh,
  });
  const ieptb = line({
    product: IEPTB_ONLINE_PRODUCT,
    enabled: input.ieptbEnabled,
    state: input.ieptbState,
    unitPriceCents: input.ieptbPriceCents,
    forceRefresh,
  });
  const totalCents = quod.billedCents + ieptb.billedCents;
  const blockedReason =
    quod.state === "IN_PROGRESS" || ieptb.state === "IN_PROGRESS"
      ? "IN_FLIGHT"
      : quod.state === "UNKNOWN_BILLING" || ieptb.state === "UNKNOWN_BILLING"
        ? "UNKNOWN_BILLING"
        : !input.ieptbEnabled || !input.quodEnabled
          ? "DISABLED"
          : null;
  return {
    quod,
    ieptb,
    totalCents,
    totalLabel: formatPackagePrice(totalCents),
    complete: quod.state === "VALID" && ieptb.state === "VALID",
    blockedReason,
  };
}
