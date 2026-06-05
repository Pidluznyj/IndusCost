import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Copy,
  Loader2,
  RefreshCw,
  Shield,
  X,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import type { Customer } from "@/src/types/commercial";

type CompareField = {
  field: string;
  label: string;
  erpValue: string | null;
  apiValue: string | null;
  status: string;
  suggestedValue: string | null;
  selectable: boolean;
};

type IntelligencePayload = {
  lookupId: string;
  cnpj: string;
  source: string;
  fetchedAt: string;
  expiresAt: string;
  fromCache: boolean;
  summary: {
    cnpjFormatted: string;
    companyName: string;
    tradeName: string | null;
    registrationStatus: string | null;
    openedAt: string | null;
    companySize: string | null;
    legalNature: string | null;
    shareCapital: number | null;
    mainCnae: { code: string; description: string } | null;
    secondaryCnaes: { code: string; description: string }[];
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    phone: string | null;
    email: string | null;
    stateTaxIds: { number: string; state: string | null; status: string | null }[];
    partners: { name: string; role: string | null }[];
  };
  risk: {
    score: number;
    verdict: string;
    riskLevel: string;
    saleRecommendation: string;
    explanation: string[];
    blockedByRegistration: boolean;
  };
  commercial: {
    insights: { code: string; title: string; description: string }[];
    crossSell: { category: string; suggestions: string[] }[];
    taxAlerts: { code: string; level: string; message: string }[];
    disclaimer: string;
  };
  comparison: {
    fields: CompareField[];
    equalCount: number;
    differentCount: number;
    suggestedUpdates: number;
  } | null;
  customerDraft: Record<string, string> | null;
  filledFieldCount: number;
  rawJson: unknown;
};

type Props = {
  open: boolean;
  onClose: () => void;
  customerId?: string | null;
  initialCnpj?: string;
  onCustomerUpdated?: () => void;
  onCreatePrefill?: (draft: Partial<Customer>) => void;
  onOpenExistingCustomer?: (customerId: string) => void;
};

const COMPARE_STATUS_LABEL: Record<string, string> = {
  EQUAL: "Igual",
  DIFFERENT: "Diferente",
  EMPTY_ERP: "Vazio no ERP",
  EMPTY_API: "Vazio na API",
  SUGGESTED: "Novo dado sugerido",
};

function JsonTree({ node, depth = 0 }: { node: ReturnType<typeof flatten>; depth?: number }) {
  return (
    <div className={cn(depth > 0 && "ml-4 border-l pl-3 border-slate-200")}>
      <div className="text-sm py-0.5">
        <span className="font-medium text-slate-700">{node.key}: </span>
        <span className="text-slate-600">{node.display}</span>
      </div>
      {node.children?.map((child, i) => (
        <div key={`${node.key}-${i}`}>
          <JsonTree node={child} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

type FlatNode = { key: string; display: string; children?: FlatNode[] };

function flatten(value: unknown, key = "root"): FlatNode {
  if (value == null) return { key, display: "—" };
  if (typeof value === "boolean") return { key, display: value ? "Sim" : "Não" };
  if (typeof value === "number") return { key, display: String(value) };
  if (typeof value === "string") return { key, display: value.trim() || "—" };
  if (Array.isArray(value)) {
    return {
      key,
      display: `${value.length} item(ns)`,
      children: value.map((item, i) => flatten(item, `[${i}]`)),
    };
  }
  return {
    key,
    display: `${Object.keys(value as object).length} campo(s)`,
    children: Object.entries(value as Record<string, unknown>).map(([k, v]) => flatten(v, k)),
  };
}

export function CustomerCnpjIntelligencePanel({
  open,
  onClose,
  customerId = null,
  initialCnpj = "",
  onCustomerUpdated,
  onCreatePrefill,
  onOpenExistingCustomer,
}: Props) {
  const [cnpjInput, setCnpjInput] = useState(initialCnpj);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<IntelligencePayload | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        let payload: IntelligencePayload;
        if (customerId) {
          const url = refresh
            ? `/api/customers/${customerId}/company-intelligence/refresh`
            : `/api/customers/${customerId}/company-intelligence${refresh ? "?refresh=true" : ""}`;
          if (refresh) {
            payload = await fetchJsonOk(url, { method: "POST" });
          } else {
            payload = await fetchJsonOk(url);
          }
        } else {
          const digits = cnpjInput.replace(/\D/g, "");
          payload = await fetchJsonOk(
            `/api/company-intelligence/cnpj/${digits}${refresh ? "?refresh=true" : ""}`
          );
        }
        setData(payload);
        setSelectedFields(
          payload.comparison?.fields.filter((f) => f.selectable).map((f) => f.field) ?? []
        );
      } catch (e: unknown) {
        const err = e as { message?: string; existingCustomerId?: string };
        setError(err.message ?? "Erro na consulta.");
      } finally {
        setLoading(false);
      }
    },
    [customerId, cnpjInput]
  );

  useEffect(() => {
    if (!open) return;
    setCnpjInput(initialCnpj);
    setData(null);
    setError(null);
    if (customerId || initialCnpj.replace(/\D/g, "").length === 14) {
      void load(false);
    }
  }, [open, customerId, initialCnpj]);

  const verdictClass = useMemo(() => {
    if (!data) return "bg-slate-100 text-slate-800";
    if (data.risk.verdict === "VENDA BLOQUEADA") return "bg-red-100 text-red-900 border-red-200";
    if (data.risk.verdict === "APENAS PAGAMENTO ANTECIPADO") {
      return "bg-amber-100 text-amber-900 border-amber-200";
    }
    if (data.risk.verdict === "VENDA CONDICIONADA") {
      return "bg-yellow-50 text-yellow-900 border-yellow-200";
    }
    return "bg-emerald-100 text-emerald-900 border-emerald-200";
  }, [data]);

  const copyJson = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(JSON.stringify(data.rawJson, null, 2));
    setMessage("JSON copiado.");
  };

  const applySelected = async () => {
    if (!customerId || !data) return;
    if (!confirm("Confirmar atualização dos campos selecionados no cadastro do cliente?")) return;
    setLoading(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/customers/${customerId}/apply-company-intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookupId: data.lookupId, selectedFields }),
      });
      setMessage("Cadastro atualizado com os campos selecionados.");
      onCustomerUpdated?.();
      await load(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao aplicar dados.");
    } finally {
      setLoading(false);
    }
  };

  const createFromLookup = async () => {
    if (!data) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJsonOk<{ customer: Customer; existingCustomerId?: string }>(
        "/api/customers/from-company-intelligence",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lookupId: data.lookupId }),
        }
      );
      setMessage("Cliente cadastrado com sucesso.");
      onCustomerUpdated?.();
      onClose();
      return res;
    } catch (e: unknown) {
      const err = e as { message?: string; existingCustomerId?: string };
      if (err.existingCustomerId) {
        setError(`${err.message} Abra o cliente existente para continuar.`);
        onOpenExistingCustomer?.(err.existingCustomerId);
      } else {
        setError(err.message ?? "Erro ao cadastrar cliente.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-2 sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Consulta CNPJ / Inteligência Comercial
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Dados públicos via publica.cnpj.ws — apoio à decisão comercial.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {!customerId && (
            <div className="flex flex-wrap gap-2 items-end">
              <label className="flex-1 min-w-[200px]">
                <span className="text-sm text-slate-600">CNPJ</span>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="00.000.000/0000-00"
                  value={cnpjInput}
                  onChange={(e) => setCnpjInput(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={loading || cnpjInput.replace(/\D/g, "").length !== 14}
                onClick={() => void load(false)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                Consultar
              </button>
            </div>
          )}

          {error && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {message}
            </div>
          )}

          {loading && !data && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          )}

          {data && (
            <>
              <div className="rounded-lg border bg-slate-50 p-3 flex flex-wrap gap-3 justify-between">
                <div>
                  <p className="font-semibold">{data.summary.companyName}</p>
                  <p className="text-sm text-slate-600">
                    {data.summary.tradeName ?? "—"} · {data.summary.cnpjFormatted}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Situação: {data.summary.registrationStatus ?? "—"} · Consulta:{" "}
                    {new Date(data.fetchedAt).toLocaleString("pt-BR")} · Fonte: {data.source}
                    {data.fromCache ? " (cache)" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs inline-flex items-center gap-1"
                    onClick={() => void load(true)}
                    disabled={loading}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Atualizar
                  </button>
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs inline-flex items-center gap-1"
                    onClick={() => void copyJson()}
                  >
                    <Copy className="h-3.5 w-3.5" /> Copiar JSON
                  </button>
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => setShowRaw((v) => !v)}
                  >
                    {showRaw ? "Ocultar JSON" : "Ver JSON bruto"}
                  </button>
                </div>
              </div>

              <div className={cn("rounded-lg border p-4", verdictClass)}>
                <div className="flex items-center gap-2 font-semibold">
                  <Shield className="h-5 w-5" />
                  Score: {data.risk.score}/100 · {data.risk.verdict}
                </div>
                <p className="text-sm mt-1">
                  Risco: {data.risk.riskLevel} — {data.risk.saleRecommendation}
                </p>
                <ul className="mt-2 text-xs space-y-0.5 opacity-90">
                  {data.risk.explanation.map((line) => (
                    <li key={line}>• {line}</li>
                  ))}
                </ul>
                <p className="text-xs mt-2 italic opacity-80">{data.commercial.disclaimer}</p>
              </div>

              <section className="grid gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded-lg border p-3 space-y-1">
                  <h3 className="font-semibold mb-2">Resumo cadastral</h3>
                  <p>Abertura: {data.summary.openedAt ?? "—"}</p>
                  <p>Porte: {data.summary.companySize ?? "—"}</p>
                  <p>Natureza: {data.summary.legalNature ?? "—"}</p>
                  <p>
                    Capital:{" "}
                    {data.summary.shareCapital != null
                      ? data.summary.shareCapital.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : "—"}
                  </p>
                  <p>CNAE: {data.summary.mainCnae?.description ?? "—"}</p>
                  <p>
                    Endereço: {data.summary.address ?? "—"}
                    {data.summary.city ? `, ${data.summary.city}/${data.summary.state}` : ""}
                  </p>
                  <p>CEP: {data.summary.zipCode ?? "—"}</p>
                  <p>Tel: {data.summary.phone ?? "—"} · E-mail: {data.summary.email ?? "—"}</p>
                </div>
                <div className="rounded-lg border p-3 space-y-2">
                  <h3 className="font-semibold">Inteligência comercial</h3>
                  {data.commercial.insights.map((i) => (
                    <div key={i.code} className="text-xs">
                      <p className="font-medium">{i.title}</p>
                      <p className="text-slate-600">{i.description}</p>
                    </div>
                  ))}
                  {data.commercial.crossSell.map((c) => (
                    <div key={c.category} className="text-xs border-t pt-2">
                      <p className="font-medium">{c.category}</p>
                      <p className="text-slate-600">{c.suggestions.join(" · ")}</p>
                    </div>
                  ))}
                  {data.commercial.taxAlerts.map((a) => (
                    <p
                      key={a.code}
                      className={cn(
                        "text-xs rounded px-2 py-1",
                        a.level === "warning"
                          ? "bg-amber-50 text-amber-900"
                          : "bg-slate-50 text-slate-700"
                      )}
                    >
                      {a.message}
                    </p>
                  ))}
                </div>
              </section>

              {data.comparison && (
                <section className="rounded-lg border overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 font-semibold text-sm">
                    Comparação ERP × API ({data.comparison.suggestedUpdates} sugestões)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b bg-white">
                          <th className="px-2 py-2 text-left">Campo</th>
                          <th className="px-2 py-2 text-left">ERP</th>
                          <th className="px-2 py-2 text-left">API</th>
                          <th className="px-2 py-2 text-left">Status</th>
                          <th className="px-2 py-2 text-left">Atualizar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.comparison.fields.map((f) => (
                          <tr key={f.field} className="border-b">
                            <td className="px-2 py-2">{f.label}</td>
                            <td className="px-2 py-2">{f.erpValue ?? "—"}</td>
                            <td className="px-2 py-2">{f.apiValue ?? "—"}</td>
                            <td className="px-2 py-2">{COMPARE_STATUS_LABEL[f.status] ?? f.status}</td>
                            <td className="px-2 py-2">
                              {f.selectable ? (
                                <input
                                  type="checkbox"
                                  checked={selectedFields.includes(f.field)}
                                  onChange={(e) =>
                                    setSelectedFields((prev) =>
                                      e.target.checked
                                        ? [...prev, f.field]
                                        : prev.filter((x) => x !== f.field)
                                    )
                                  }
                                />
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {customerId && (
                    <div className="p-3 border-t">
                      <button
                        type="button"
                        disabled={loading || selectedFields.length === 0}
                        onClick={() => void applySelected()}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                      >
                        Atualizar cadastro com campos selecionados
                      </button>
                    </div>
                  )}
                </section>
              )}

              {!customerId && data.customerDraft && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white"
                    onClick={() => {
                      if (onCreatePrefill) {
                        onCreatePrefill(data.customerDraft as Partial<Customer>);
                        onClose();
                      } else {
                        void createFromLookup();
                      }
                    }}
                  >
                    Cadastrar cliente com esses dados
                  </button>
                </div>
              )}

              <section className="rounded-lg border p-3">
                <div className="flex justify-between items-center gap-2">
                  <h3 className="font-semibold text-sm">
                    Todos os dados retornados ({data.filledFieldCount} campos preenchidos)
                  </h3>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => setSimOpen((v) => !v)}
                  >
                    {simOpen ? "Ocultar simulador" : "Simulador de cenários (Fase 2)"}
                  </button>
                </div>
                {showRaw ? (
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-900 text-slate-100 p-3 text-xs">
                    {JSON.stringify(data.rawJson, null, 2)}
                  </pre>
                ) : (
                  <div className="mt-2 max-h-64 overflow-auto">
                    <JsonTree node={flatten(data.rawJson)} />
                  </div>
                )}
                {simOpen && (
                  <p className="text-xs text-slate-500 mt-2">
                    Simulador analítico completo disponível via API/backend (
                    <code>simulateCommercialRisk</code>) — UI avançada na Fase 2.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
