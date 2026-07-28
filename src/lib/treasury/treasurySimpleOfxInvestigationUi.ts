/**
 * Helpers UI — assistente simples OFX / divergência (client-safe).
 */

import {
  TREASURY_SIMPLE_OFX_INVESTIGATION_LABELS,
  TREASURY_SIMPLE_OFX_INVESTIGATION_TITLE,
  TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTION_LABELS,
  TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS,
  type TreasurySimpleOfxUnidentifiedOption,
} from "./domain/treasurySimpleOfxInvestigationRules.js";
import { formatTreasuryBankMoney } from "./treasuryBankMovementsUi.js";

export const TREASURY_SIMPLE_OFX_PAGE_TITLE =
  TREASURY_SIMPLE_OFX_INVESTIGATION_TITLE;

export const TREASURY_SIMPLE_OFX_PAGE_SUBTITLE =
  "Importe o extrato, confirme correspondências e explique o que ficou sem identificação." as const;

export const TREASURY_SIMPLE_OFX_DENIED_MESSAGE =
  "Sem permissão para conferir o banco na Tesouraria." as const;

export const TREASURY_SIMPLE_OFX_LABELS = TREASURY_SIMPLE_OFX_INVESTIGATION_LABELS;

export const TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS_UI =
  TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS.map((id) => ({
    id,
    label: TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTION_LABELS[id],
  }));

export type TreasurySimpleOfxStep =
  | "import"
  | "investigate"
  | "result";

export type TreasurySimpleOfxViewKind =
  | "denied"
  | "loading"
  | "error"
  | "ready";

export function parseTreasurySimpleOfxStep(
  raw: string | null | undefined
): TreasurySimpleOfxStep {
  if (raw === "investigate" || raw === "match") return "investigate";
  if (raw === "result" || raw === "resultado") return "result";
  return "import";
}

export function formatTreasurySimpleOfxMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  return formatTreasuryBankMoney(value);
}

export function isTreasurySimpleOfxUnidentifiedOption(
  value: string
): value is TreasurySimpleOfxUnidentifiedOption {
  return (TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS as readonly string[]).includes(
    value
  );
}

export function resolveTreasurySimpleOfxViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
}): TreasurySimpleOfxViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.hasLoaded) return "loading";
  if (input.error && !input.hasLoaded) return "error";
  return "ready";
}
