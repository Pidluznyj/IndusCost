import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clock,
  Loader2,
  Save,
  UserCircle2,
  History,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "@/src/components/shared/SearchableSelect";
import type {
  ActiveCommercialSellerOption,
  CustomerCommercialOwnerPayload,
} from "@/src/lib/crmCustomerCommercialOwnerTypes";

const SOURCE_LABELS = {
  MANUAL: "Manual",
  NOMUS_INFERRED: "Nomus (inferido dos pedidos)",
  NONE: "Sem responsável",
} as const;

function formatIdsLabel(owner: CustomerCommercialOwnerPayload["owner"]): string | null {
  if (owner.sellerAliasExternalIds.length > 0) {
    return `IDs Nomus ${owner.sellerAliasExternalIds.join(", ")}`;
  }
  if (owner.sellerExternalId != null) {
    return `ID Nomus ${owner.sellerExternalId}`;
  }
  return null;
}

function formatConfidence(confidence: "HIGH" | "MEDIUM" | null): string | null {
  if (confidence === "HIGH") return "Alta confiança";
  if (confidence === "MEDIUM") return "Média confiança";
  return null;
}

type Props = {
  customerId: string;
};

export function CustomerCommercialOwnerTab({ customerId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CustomerCommercialOwnerPayload | null>(null);
  const [sellers, setSellers] = useState<ActiveCommercialSellerOption[]>([]);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [dirty, setDirty] = useState(false);

  const loadPayload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<CustomerCommercialOwnerPayload>(
        `/api/crm/customers/${customerId}/commercial-owner`
      );
      setPayload(data);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar responsável comercial.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (!payload) return;
    const keySource = payload.manualAssignment ?? (payload.owner.source === "MANUAL" ? payload.owner : null);
    if (keySource?.sellerIdentityKey) {
      const match = sellers.find((s) => s.sellerIdentityKey === keySource.sellerIdentityKey);
      setSelectedKey(match?.optionKey ?? "");
    } else {
      setSelectedKey("");
    }
  }, [payload, sellers]);

  const loadSellers = useCallback(async () => {
    setSellersLoading(true);
    try {
      const data = await fetchJsonOk<{ rows: ActiveCommercialSellerOption[] }>(
        "/api/crm/commercial-sellers/active"
      );
      setSellers(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      console.error(e);
    } finally {
      setSellersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSellers();
  }, [loadSellers]);

  useEffect(() => {
    if (customerId) void loadPayload();
  }, [customerId, loadPayload]);

  const sellerOptions = useMemo(
    () =>
      sellers.map((s) => ({
        value: s.optionKey,
        label: s.canonicalName,
        sublabel: s.sublabel,
        searchTerms: [
          s.canonicalName,
          s.sellerIdentityKey,
          ...s.aliasExternalSellerIds.map(String),
        ].join(" "),
      })),
    [sellers]
  );

  const handleSave = async () => {
    if (!payload?.canEdit || !selectedKey) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await fetchJsonOk<CustomerCommercialOwnerPayload>(
        `/api/crm/customers/${customerId}/commercial-owner`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sellerOptionKey: selectedKey }),
        }
      );
      setPayload(updated);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar responsável comercial.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !payload) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando responsável comercial…
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        {error ?? "Não foi possível carregar os dados."}
      </div>
    );
  }

  const idsLabel = formatIdsLabel(payload.owner);
  const confidenceLabel = formatConfidence(payload.owner.confidence);

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-accent/20 p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <UserCircle2 className="h-4 w-4" />
          Responsável atual
        </div>
        <div className="text-lg font-semibold">
          {payload.owner.sellerCanonicalName ?? "Sem responsável comercial definido"}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {idsLabel ? <span>{idsLabel}</span> : null}
          {confidenceLabel ? <span>{confidenceLabel}</span> : null}
          <span>Origem: {SOURCE_LABELS[payload.owner.source]}</span>
        </div>
        {payload.owner.source === "MANUAL" && payload.owner.updatedAt ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Última alteração:{" "}
            {new Date(payload.owner.updatedAt).toLocaleString("pt-BR")}
            {payload.owner.updatedByName ? ` · ${payload.owner.updatedByName}` : ""}
          </div>
        ) : null}
        {payload.inferredFromNomus && payload.manualAssignment ? (
          <p className="text-xs text-muted-foreground border-t border-border pt-3">
            Responsável manual tem prioridade sobre o inferido do Nomus (
            {payload.inferredFromNomus.sellerCanonicalName}).
          </p>
        ) : null}
        {!payload.manualAssignment && payload.inferredFromNomus ? (
          <p className="text-xs text-muted-foreground border-t border-border pt-3">
            Sem definição manual — usando responsável inferido dos pedidos Nomus.
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <label className="text-xs font-bold text-muted-foreground uppercase">
          Responsável comercial
        </label>
        {!payload.canEdit ? (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            Somente Gestor Comercial ou Administrador pode alterar o responsável comercial do
            cliente.
          </div>
        ) : null}
        <SearchableSelect
          value={selectedKey}
          onChange={(v) => {
            setSelectedKey(v);
            setDirty(true);
          }}
          options={sellerOptions}
          placeholder={sellersLoading ? "Carregando vendedores…" : "Buscar por nome ou ID Nomus…"}
          disabled={!payload.canEdit || sellersLoading}
          emptyLabel="Nenhum vendedor consolidado encontrado"
        />
        {payload.canEdit ? (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={saving || !dirty || !selectedKey}
              onClick={() => void handleSave()}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold",
                "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              )}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar responsável
            </button>
            {dirty ? (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground px-2 py-2"
                onClick={() => {
                  setDirty(false);
                  void loadPayload();
                }}
              >
                Cancelar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {payload.auditHistory.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <History className="h-4 w-4" />
            Histórico de alterações
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-accent/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Data</th>
                  <th className="text-left px-3 py-2 font-semibold">Usuário</th>
                  <th className="text-left px-3 py-2 font-semibold">Anterior</th>
                  <th className="text-left px-3 py-2 font-semibold">Novo</th>
                </tr>
              </thead>
              <tbody>
                {payload.auditHistory.map((row, idx) => (
                  <tr key={`${row.performedAt}-${idx}`} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(row.performedAt).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 py-2">{row.performedBy ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.previousLabel ?? "—"}</td>
                    <td className="px-3 py-2">{row.newLabel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
