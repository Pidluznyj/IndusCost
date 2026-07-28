/**
 * Helpers de UI — fechamento diário da Tesouraria.
 */

import type {
  TreasuryDailyClosingDto,
  TreasuryDailyClosingPreviewDto,
} from "./contracts/index.js";
import { todayTreasuryCivilDateInSaoPaulo } from "./contracts/index.js";
import { HttpError } from "@/src/lib/http.js";

export const TREASURY_DAILY_CLOSING_PAGE_TITLE = "Fechamento diário" as const;
export const TREASURY_DAILY_CLOSING_PAGE_SUBTITLE =
  "Preview, checklist, ressalvas e histórico versionado do caixa do dia." as const;

export const TREASURY_DAILY_CLOSING_409_MESSAGE =
  "A fonte de dados mudou desde o preview (conflito 409). Atualize o preview, revise bloqueios/pendências e confirme novamente." as const;

export const TREASURY_DAILY_CLOSING_STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto",
  CLOSED: "Fechado",
  REOPENED: "Reaberto",
};

export type TreasuryDailyClosingViewKind =
  | "denied"
  | "loading"
  | "error"
  | "ready";

export function resolveTreasuryDailyClosingViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  hasPreview: boolean;
}): TreasuryDailyClosingViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.hasPreview) return "loading";
  if (input.error && !input.hasPreview) return "error";
  return "ready";
}

export function formatTreasuryDailyClosingMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatTreasuryDailyClosingCivilDate(
  civil: string | null | undefined
): string {
  if (!civil) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil.trim());
  if (!m) return civil;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export type TreasuryDailyClosingChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  critical: boolean;
};

export function buildTreasuryDailyClosingChecklist(
  preview: TreasuryDailyClosingPreviewDto | null,
  caveatDrafts: Record<string, string>
): TreasuryDailyClosingChecklistItem[] {
  if (!preview) {
    return [
      {
        id: "preview",
        label: "Preview carregado",
        ok: false,
        critical: true,
      },
    ];
  }
  const caveatsOk =
    preview.requiredCaveatCodes.length === 0 ||
    preview.requiredCaveatCodes.every(
      (code) => (caveatDrafts[code] ?? "").trim().length > 0
    );
  return [
    {
      id: "preview",
      label: "Preview atualizado com hash da fonte",
      ok: preview.sourceHash.length >= 16,
      critical: true,
    },
    {
      id: "blocks",
      label: "Sem bloqueios absolutos",
      ok: preview.absoluteBlocks.length === 0,
      critical: true,
    },
    {
      id: "caveats",
      label:
        preview.requiredCaveatCodes.length === 0
          ? "Nenhuma ressalva obrigatória"
          : "Ressalvas preenchidas para pendências",
      ok: caveatsOk,
      critical: preview.requiredCaveatCodes.length > 0,
    },
    {
      id: "close-path",
      label: preview.canCloseWithoutCaveats
        ? "Pode fechar sem ressalvas"
        : preview.canCloseWithCaveats
          ? "Pode fechar com ressalvas"
          : "Fechamento indisponível",
      ok: preview.canCloseWithCaveats,
      critical: true,
    },
  ];
}

export function isTreasuryDailyClosingChecklistReady(
  items: TreasuryDailyClosingChecklistItem[]
): boolean {
  return items.every((i) => i.ok);
}

export function buildTreasuryDailyClosingCaveatPayload(
  requiredCodes: string[],
  drafts: Record<string, string>
): Array<{ code: string; message: string; severity: "WARNING" }> {
  return requiredCodes
    .map((code) => ({
      code,
      message: (drafts[code] ?? "").trim(),
      severity: "WARNING" as const,
    }))
    .filter((c) => c.message.length > 0);
}

export function resolveTreasuryDailyClosingConflictMessage(
  err: unknown
): string | null {
  if (err instanceof HttpError && err.status === 409) {
    return TREASURY_DAILY_CLOSING_409_MESSAGE;
  }
  return null;
}

export type TreasuryDailyClosingVersionDiffRow = {
  field: string;
  label: string;
  left: string;
  right: string;
  changed: boolean;
};

const VERSION_COMPARE_FIELDS: Array<{
  field: keyof TreasuryDailyClosingDto;
  label: string;
}> = [
  { field: "version", label: "Versão" },
  { field: "status", label: "Status" },
  { field: "sourceHash", label: "Hash da fonte" },
  { field: "openingBalance", label: "Saldo inicial" },
  { field: "realizedInflows", label: "Entradas realizadas" },
  { field: "realizedOutflows", label: "Saídas realizadas" },
  { field: "pendenciesAmount", label: "Pendências" },
  { field: "closingBalance", label: "Saldo final" },
  { field: "observedBalance", label: "Saldo observado" },
  { field: "reconciledBalance", label: "Saldo conciliado" },
  { field: "differenceAmount", label: "Diferença" },
  { field: "exceptionsCount", label: "Exceções (qtd)" },
  { field: "caveatsCount", label: "Ressalvas (qtd)" },
];

export function compareTreasuryDailyClosingVersions(
  left: TreasuryDailyClosingDto | null,
  right: TreasuryDailyClosingDto | null
): TreasuryDailyClosingVersionDiffRow[] {
  if (!left || !right) return [];
  return VERSION_COMPARE_FIELDS.map(({ field, label }) => {
    const l = String(left[field] ?? "—");
    const r = String(right[field] ?? "—");
    return {
      field,
      label,
      left: l,
      right: r,
      changed: l !== r,
    };
  });
}

export function todayTreasuryCivilDateLocal(): string {
  return todayTreasuryCivilDateInSaoPaulo();
}
