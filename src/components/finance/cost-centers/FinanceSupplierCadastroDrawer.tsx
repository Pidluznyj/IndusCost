import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Building2,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { CNPJ_COMPARE_STATUS_LABEL } from "@/src/lib/customerCnpjIntelligenceTypes";
import type { FinancialSupplierProfileDto } from "@/src/lib/financeSupplierProfile";
import type { FinanceSupplierIntelligencePayload } from "@/src/lib/financeSupplierProfile";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  supplierId: string | null;
  onClose: () => void;
  onChanged?: () => void;
  canManage: boolean;
  canDelete: boolean;
};

export function FinanceSupplierCadastroDrawer({
  open,
  supplierId,
  onClose,
  onChanged,
  canManage,
  canDelete,
}: Props) {
  const [profile, setProfile] = useState<FinancialSupplierProfileDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [document, setDocument] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  const [cnpjInput, setCnpjInput] = useState("");
  const [cnpjData, setCnpjData] = useState<FinanceSupplierIntelligencePayload | null>(null);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<FinancialSupplierProfileDto>(
        `/api/finance/suppliers/${supplierId}`,
        { credentials: "include" }
      );
      setProfile(data);
      setLegalName(data.legalName ?? "");
      setTradeName(data.tradeName ?? "");
      setDocument(data.document ?? "");
      setDisplayName(data.displayName);
      setCnpjInput(data.document ?? "");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar fornecedor.");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    if (!open || !supplierId) return;
    setCnpjData(null);
    setCnpjError(null);
    setMessage(null);
    void loadProfile();
  }, [open, supplierId, loadProfile]);

  const saveProfile = async () => {
    if (!supplierId || !canManage) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const data = await fetchJsonOk<FinancialSupplierProfileDto>(
        `/api/finance/suppliers/${supplierId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            legalName: legalName.trim() || null,
            tradeName: tradeName.trim() || null,
            document: document.trim() || null,
          }),
        }
      );
      setProfile(data);
      setMessage("Cadastro atualizado.");
      onChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar cadastro.");
    } finally {
      setSaving(false);
    }
  };

  const loadCnpj = async (refresh = false) => {
    if (!supplierId) return;
    setCnpjLoading(true);
    setCnpjError(null);
    setMessage(null);
    try {
      const digits = cnpjInput.replace(/\D/g, "");
      let payload: FinanceSupplierIntelligencePayload;
      if (refresh) {
        payload = await fetchJsonOk(`/api/finance/suppliers/${supplierId}/company-intelligence/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(digits.length === 14 ? { cnpj: cnpjInput } : {}),
        });
      } else {
        const query = digits.length === 14 ? `?cnpj=${encodeURIComponent(digits)}` : "";
        payload = await fetchJsonOk(
          `/api/finance/suppliers/${supplierId}/company-intelligence${query}`,
          { credentials: "include" }
        );
      }
      setCnpjData(payload);
      setSelectedFields(
        payload.comparison?.fields.filter((f) => f.selectable).map((f) => f.field) ?? []
      );
    } catch (e: unknown) {
      setCnpjError(e instanceof Error ? e.message : "Erro na consulta CNPJ.");
    } finally {
      setCnpjLoading(false);
    }
  };

  const applyCnpjFields = async () => {
    if (!supplierId || !cnpjData || !canManage) return;
    if (
      !confirm(
        "Confirmar aplicação dos campos selecionados da consulta CNPJ? Títulos AP e regras não serão alterados."
      )
    ) {
      return;
    }
    setCnpjLoading(true);
    setCnpjError(null);
    try {
      const result = await fetchJsonOk<{ supplier: FinancialSupplierProfileDto }>(
        `/api/finance/suppliers/${supplierId}/apply-company-intelligence`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lookupId: cnpjData.lookupId,
            selectedFields,
          }),
        }
      );
      setProfile(result.supplier);
      setLegalName(result.supplier.legalName ?? "");
      setTradeName(result.supplier.tradeName ?? "");
      setDocument(result.supplier.document ?? "");
      setDisplayName(result.supplier.displayName);
      setCnpjInput(result.supplier.document ?? cnpjInput);
      setMessage("Dados da consulta CNPJ aplicados ao cadastro.");
      onChanged?.();
      await loadCnpj(false);
    } catch (e: unknown) {
      setCnpjError(e instanceof Error ? e.message : "Erro ao aplicar dados.");
    } finally {
      setCnpjLoading(false);
    }
  };

  const deactivateSupplier = async () => {
    if (!supplierId || !canDelete) return;
    if (
      !confirm(
        "Inativar o cadastro consolidado deste fornecedor?\n\n" +
          "• Títulos de Contas a Pagar NÃO serão apagados\n" +
          "• Alocações e histórico financeiro serão preservados\n" +
          "• Regras e aliases permanecem no sistema\n" +
          "• O fornecedor deixa de aparecer na lista consolidada ativa"
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const result = await fetchJsonOk<{ message: string }>(
        `/api/finance/suppliers/${supplierId}`,
        { method: "DELETE", credentials: "include" }
      );
      setMessage(result.message);
      onChanged?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao excluir fornecedor.");
    } finally {
      setDeleting(false);
    }
  };

  if (!open || !supplierId) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      data-testid="finance-supplier-cadastro-drawer"
    >
      <div className={cn(financeBiCardClass, "flex h-full w-full max-w-2xl flex-col shadow-xl")}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Cadastro do fornecedor
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Dados cadastrais consolidados — não altera títulos AP originais.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {error ? (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {message}
            </div>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : profile ? (
            <>
              <section className="space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Dados cadastrais
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-muted-foreground">Nome exibido</span>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={!canManage || profile.status === "INACTIVE"}
                    />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-muted-foreground">Razão social</span>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      disabled={!canManage || profile.status === "INACTIVE"}
                    />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-muted-foreground">Nome fantasia</span>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={tradeName}
                      onChange={(e) => setTradeName(e.target.value)}
                      disabled={!canManage || profile.status === "INACTIVE"}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground">CNPJ / documento</span>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={document}
                      onChange={(e) => setDocument(e.target.value)}
                      disabled={!canManage || profile.status === "INACTIVE"}
                    />
                  </label>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground">Status</span>
                    <p className="text-sm font-semibold">{profile.status}</p>
                  </div>
                </div>
                {canManage && profile.status !== "INACTIVE" ? (
                  <button
                    type="button"
                    data-testid="finance-supplier-save-cadastro-button"
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    disabled={saving}
                    onClick={() => void saveProfile()}
                  >
                    {saving ? "Salvando…" : "Salvar cadastro"}
                  </button>
                ) : null}
              </section>

              <section className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Resumo financeiro (AP)
                </h3>
                <p>Títulos vinculados: {profile.titlesCount}</p>
                <p>Valor total visto: {formatFinanceCurrency(profile.totalAmountSeen)}</p>
                <p>Alocações CC: {profile.allocationCount}</p>
                {profile.activeRules.length > 0 ? (
                  <div>
                    <p className="font-semibold mt-2">Regras ativas</p>
                    <ul className="list-disc pl-4 text-xs text-muted-foreground">
                      {profile.activeRules.map((rule) => (
                        <li key={rule.id}>
                          {rule.costCenterName} ({rule.percentage}%)
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Sem regra de centro de custo ativa.</p>
                )}
              </section>

              {profile.aliases.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                    Aliases ({profile.aliases.length})
                  </h3>
                  <ul className="text-xs space-y-1 text-muted-foreground">
                    {profile.aliases.slice(0, 8).map((alias) => (
                      <li key={alias.id}>
                        {alias.originalName ?? "—"} · {alias.originalDocument ?? "—"} ·{" "}
                        {alias.titlesCount} título(s)
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Consulta CNPJ
                </h3>
                <p className="text-xs text-muted-foreground">
                  Mesma rotina de Clientes (publica.cnpj.ws). Endereço e contatos públicos são
                  exibidos para comparação; apenas razão social, fantasia e CNPJ (se vazio) podem
                  ser aplicados ao cadastro consolidado.
                </p>
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="flex-1 min-w-[180px]">
                    <span className="text-xs text-muted-foreground">CNPJ para consulta</span>
                    <input
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                      placeholder="00.000.000/0000-00"
                      value={cnpjInput}
                      onChange={(e) => setCnpjInput(e.target.value)}
                      disabled={!canManage || profile.status === "INACTIVE"}
                    />
                  </label>
                  <button
                    type="button"
                    data-testid="finance-supplier-consult-cnpj-button"
                    className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    disabled={
                      cnpjLoading ||
                      !canManage ||
                      profile.status === "INACTIVE" ||
                      cnpjInput.replace(/\D/g, "").length !== 14
                    }
                    onClick={() => void loadCnpj(false)}
                  >
                    Consultar CNPJ
                  </button>
                  {cnpjData ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"
                      disabled={cnpjLoading}
                      onClick={() => void loadCnpj(true)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Atualizar
                    </button>
                  ) : null}
                </div>

                {cnpjError ? (
                  <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    {cnpjError}
                  </div>
                ) : null}

                {cnpjLoading && !cnpjData ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : null}

                {cnpjData ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border p-3 text-sm">
                      <p className="font-semibold">{cnpjData.summary.companyName}</p>
                      <p className="text-muted-foreground">
                        {cnpjData.summary.tradeName ?? "—"} · {cnpjData.summary.cnpjFormatted}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Situação: {cnpjData.summary.registrationStatus ?? "—"} ·{" "}
                        {new Date(cnpjData.fetchedAt).toLocaleString("pt-BR")}
                      </p>
                    </div>

                    {cnpjData.comparison ? (
                      <div className="rounded-lg border overflow-hidden">
                        <div className="bg-muted/50 px-3 py-2 font-semibold text-sm">
                          Dados divergentes ({cnpjData.comparison.suggestedUpdates} aplicáveis)
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-xs">
                            <thead>
                              <tr className="border-b">
                                <th className="px-2 py-2 text-left">Campo</th>
                                <th className="px-2 py-2 text-left">Atual</th>
                                <th className="px-2 py-2 text-left">Receita</th>
                                <th className="px-2 py-2 text-left">Status</th>
                                <th className="px-2 py-2 text-left">Aplicar</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cnpjData.comparison.fields.map((f) => (
                                <tr key={f.field} className="border-b">
                                  <td className="px-2 py-2">{f.label}</td>
                                  <td className="px-2 py-2">{f.erpValue ?? "—"}</td>
                                  <td className="px-2 py-2">{f.apiValue ?? "—"}</td>
                                  <td className="px-2 py-2">
                                    {CNPJ_COMPARE_STATUS_LABEL[f.status] ?? f.status}
                                  </td>
                                  <td className="px-2 py-2">
                                    {f.selectable && canManage ? (
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
                        {canManage && profile.status !== "INACTIVE" ? (
                          <div className="p-3 border-t">
                            <button
                              type="button"
                              data-testid="finance-supplier-apply-cnpj-button"
                              className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                              disabled={cnpjLoading || selectedFields.length === 0}
                              onClick={() => void applyCnpjFields()}
                            >
                              Aplicar dados selecionados
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </div>

        {canDelete && profile?.status !== "INACTIVE" ? (
          <div className="border-t px-4 py-3">
            <button
              type="button"
              data-testid="finance-supplier-delete-button"
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
              disabled={deleting}
              onClick={() => void deactivateSupplier()}
            >
              <Trash2 className="h-4 w-4" />
              Excluir fornecedor (inativar cadastro)
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
