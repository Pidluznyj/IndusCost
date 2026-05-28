import React, { useCallback, useState } from "react";
import { AlertCircle, Info, Layers, Loader2, Search } from "lucide-react";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { parseApiErrorMessage } from "@/src/lib/http";
import { cn, formatNumberAdaptive } from "@/src/lib/utils";
import type {
  BomUsageAmbiguityCandidate,
  BomUsageResult,
  BomUsageSearchKind,
} from "@/src/lib/productBomUsage";

type SearchOutcome =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; data: BomUsageResult }
  | { type: "not_found"; message: string; searchedCode: string }
  | {
      type: "ambiguous";
      message: string;
      searchedCode: string;
      candidates: BomUsageAmbiguityCandidate[];
    }
  | { type: "error"; message: string };

function displayText(value: string | null | undefined): string {
  if (value == null) return "—";
  const trimmed = value.trim();
  return trimmed || "—";
}

function displayNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatNumberAdaptive(value);
}

function displayBool(value: boolean | null | undefined): string {
  if (value == null) return "—";
  return value ? "Sim" : "Não";
}

function formatSyncAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function itemKindLabel(kind: BomUsageResult["itemKind"]): string {
  switch (kind) {
    case "MATERIAL":
      return "Matéria-prima";
    case "COMPONENT":
      return "Componente";
    default:
      return "Produto";
  }
}

function parentTypeLabel(type: string | null | undefined): string {
  if (type === "COMPONENT") return "Componente";
  if (type === "PRODUCT") return "Produto";
  return displayText(type);
}

async function fetchBomUsage(
  code: string,
  kind?: BomUsageSearchKind
): Promise<SearchOutcome> {
  const trimmed = code.trim();
  if (!trimmed) {
    return {
      type: "not_found",
      searchedCode: "",
      message: "Informe um código para buscar.",
    };
  }

  const params = new URLSearchParams({ code: trimmed });
  if (kind) params.set("kind", kind);

  const res = await fetch(`/api/products/bom-usage?${params.toString()}`, {
    credentials: "include",
  });

  if (res.ok) {
    const data = (await res.json()) as BomUsageResult;
    return { type: "success", data };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (res.status === 404) {
    return {
      type: "not_found",
      searchedCode: typeof body.searchedCode === "string" ? body.searchedCode : trimmed.toUpperCase(),
      message:
        typeof body.message === "string"
          ? body.message
          : await parseApiErrorMessage(res),
    };
  }

  if (res.status === 409) {
    return {
      type: "ambiguous",
      searchedCode: typeof body.searchedCode === "string" ? body.searchedCode : trimmed.toUpperCase(),
      message:
        typeof body.message === "string"
          ? body.message
          : "Código ambíguo entre produto/componente e matéria-prima.",
      candidates: Array.isArray(body.candidates)
        ? (body.candidates as BomUsageAmbiguityCandidate[])
        : [],
    };
  }

  return {
    type: "error",
    message: await parseApiErrorMessage(res),
  };
}

export const ProductBomWhereUsedDashboard: React.FC = () => {
  const [searchCode, setSearchCode] = useState("");
  const [outcome, setOutcome] = useState<SearchOutcome>({ type: "idle" });

  const runSearch = useCallback(async (code: string, kind?: BomUsageSearchKind) => {
    setOutcome({ type: "loading" });
    try {
      const result = await fetchBomUsage(code, kind);
      setOutcome(result);
    } catch (err) {
      setOutcome({
        type: "error",
        message: err instanceof Error ? err.message : "Erro ao consultar uso na estrutura.",
      });
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(searchCode);
  };

  const success = outcome.type === "success" ? outcome.data : null;

  return (
    <ContextualDashboardLayout
      moduleLabel="Engenharia — onde é usado"
      backPath="/products"
      backLabel="Voltar para Engenharia"
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Layers className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-foreground">Onde é usado</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Consulte em quais produtos um componente ou matéria-prima é usado diretamente na
            estrutura ProductBOM.
          </p>
          <p className="inline-flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            Esta visão mostra apenas uso direto na ProductBOM, não uso recursivo em submontagens.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-4 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-end"
        >
          <div className="flex-1 space-y-1">
            <label htmlFor="bom-usage-code" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Código
            </label>
            <input
              id="bom-usage-code"
              type="text"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              placeholder="Ex.: 115.01-- ou 301.08AA"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            disabled={outcome.type === "loading"}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {outcome.type === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Buscar
          </button>
        </form>

        {outcome.type === "loading" && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Consultando estruturas…
          </div>
        )}

        {outcome.type === "error" && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-900 dark:text-red-100">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {outcome.message}
          </div>
        )}

        {outcome.type === "not_found" && (
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            {outcome.message}
          </div>
        )}

        {outcome.type === "ambiguous" && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">{outcome.message}</p>
            <p className="text-xs text-muted-foreground">
              Código pesquisado: <span className="font-mono">{outcome.searchedCode}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {outcome.candidates.map((c) => (
                <button
                  key={`${c.kind}-${c.id}`}
                  type="button"
                  onClick={() => void runSearch(searchCode, c.kind)}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-left text-sm shadow-sm hover:bg-accent transition-colors"
                >
                  <span className="font-semibold">{c.kind === "MATERIAL" ? "Matéria-prima" : "Produto/Componente"}</span>
                  <span className="block text-muted-foreground">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {success && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Item encontrado</p>
                <p className="font-semibold font-mono">{success.item.code}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tipo</p>
                <p className="font-medium">{itemKindLabel(success.itemKind)}</p>
                {success.itemKind !== "MATERIAL" && "type" in success.item && (
                  <p className="text-xs text-muted-foreground">{parentTypeLabel(success.item.type)}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Descrição</p>
                <p className="font-medium">
                  {success.itemKind === "MATERIAL" && "unit" in success.item
                    ? `${displayText(success.item.description)} (${displayText(success.item.unit)})`
                    : "name" in success.item
                      ? displayText(success.item.name)
                      : "—"}
                </p>
                {success.itemKind !== "MATERIAL" && "description" in success.item && success.item.description && (
                  <p className="text-muted-foreground text-xs mt-0.5">{success.item.description}</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Usos diretos</p>
                <p className="text-2xl font-bold tabular-nums">{success.directUsageCount}</p>
              </div>
            </div>

            {success.usages.length === 0 ? (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhum produto utiliza este item diretamente na ProductBOM.
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Produto pai</th>
                        <th className="px-3 py-2 font-semibold">Nome / descrição</th>
                        <th className="px-3 py-2 font-semibold">Tipo</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold text-right">Quantidade</th>
                        <th className="px-3 py-2 font-semibold text-right">Perda</th>
                        <th className="px-3 py-2 font-semibold">Fonte</th>
                        <th className="px-3 py-2 font-semibold">Nomus</th>
                        <th className="px-3 py-2 font-semibold">Exceção local</th>
                        <th className="px-3 py-2 font-semibold">Código Nomus</th>
                        <th className="px-3 py-2 font-semibold">Última sync</th>
                      </tr>
                    </thead>
                    <tbody>
                      {success.usages.map((row) => (
                        <tr
                          key={row.bomLineId}
                          className={cn("border-b border-border/60 last:border-0 hover:bg-muted/20")}
                        >
                          <td className="px-3 py-2 font-mono font-medium">{displayText(row.parentSku)}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{displayText(row.parentName)}</div>
                            {row.parentDescription && (
                              <div className="text-xs text-muted-foreground">{row.parentDescription}</div>
                            )}
                          </td>
                          <td className="px-3 py-2">{parentTypeLabel(row.parentType)}</td>
                          <td className="px-3 py-2">{displayText(row.parentStatus)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{displayNumber(row.quantity)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{displayNumber(row.lossPercentage)}</td>
                          <td className="px-3 py-2">{displayText(row.sourceSystem)}</td>
                          <td className="px-3 py-2">{displayBool(row.isNomusControlled)}</td>
                          <td className="px-3 py-2">{displayBool(row.localException)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{displayText(row.nomusComponentCode)}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{formatSyncAt(row.lastNomusSyncAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ContextualDashboardLayout>
  );
};
