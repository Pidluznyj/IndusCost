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
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { CNPJ_COMPARE_STATUS_LABEL } from "@/src/lib/customerCnpjIntelligenceTypes";
import type {
  FinanceSupplierCnpjLookupPayload,
  FinanceSupplierIntelligencePayload,
  FinancialSupplierProfileDto,
} from "@/src/lib/financeSupplierProfile";
import { buildSupplierApplyPatch } from "@/src/lib/financeSupplierCnpjCompare";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";

export type FinanceSupplierCadastroMode = "create" | "edit";

type Props = {
  open: boolean;
  mode: FinanceSupplierCadastroMode;
  supplierId: string | null;
  onClose: () => void;
  onChanged?: () => void;
  /** Em duplicidade no create, abre o cadastro existente no mesmo drawer. */
  onOpenExisting?: (supplierId: string) => void;
  canManage: boolean;
  canDelete: boolean;
};

type CnpjPanelPayload = FinanceSupplierIntelligencePayload | FinanceSupplierCnpjLookupPayload;

function resetFormFields(setters: {
  setLegalName: (v: string) => void;
  setTradeName: (v: string) => void;
  setDocument: (v: string) => void;
  setDisplayName: (v: string) => void;
  setCnpjInput: (v: string) => void;
}) {
  setters.setLegalName("");
  setters.setTradeName("");
  setters.setDocument("");
  setters.setDisplayName("");
  setters.setCnpjInput("");
}

export function FinanceSupplierCadastroDrawer({
  open,
  mode,
  supplierId,
  onClose,
  onChanged,
  onOpenExisting,
  canManage,
  canDelete,
}: Props) {
  const portalContainer = usePortalContainer();
  const [profile, setProfile] = useState<FinancialSupplierProfileDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicateSupplierId, setDuplicateSupplierId] = useState<string | null>(null);

  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [document, setDocument] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  const [cnpjInput, setCnpjInput] = useState("");
  const [cnpjData, setCnpjData] = useState<CnpjPanelPayload | null>(null);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const isCreate = mode === "create";
  const isInactive = profile?.status === "INACTIVE";
  const formDisabled = !canManage || (!isCreate && isInactive);

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
    if (!open) return;
    setCnpjData(null);
    setCnpjError(null);
    setMessage(null);
    setError(null);
    setDuplicateSupplierId(null);
    if (isCreate) {
      setProfile(null);
      setLoading(false);
      resetFormFields({
        setLegalName,
        setTradeName,
        setDocument,
        setDisplayName,
        setCnpjInput,
      });
      return;
    }
    if (!supplierId) return;
    void loadProfile();
  }, [open, isCreate, supplierId, loadProfile]);

  const saveProfile = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    setDuplicateSupplierId(null);
    try {
      const body = {
        displayName,
        legalName: legalName.trim() || null,
        tradeName: tradeName.trim() || null,
        document: document.trim() || null,
      };
      if (isCreate) {
        await fetchJsonOk<FinancialSupplierProfileDto>("/api/finance/suppliers", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setMessage("Fornecedor cadastrado.");
        onChanged?.();
        onClose();
        return;
      }
      if (!supplierId) return;
      const data = await fetchJsonOk<FinancialSupplierProfileDto>(
        `/api/finance/suppliers/${supplierId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      setProfile(data);
      setMessage("Cadastro atualizado.");
      onChanged?.();
    } catch (e: unknown) {
      if (e instanceof HttpError) {
        setError(e.message);
        if (e.code === "DUPLICATE_DOCUMENT" && e.existingSupplierId) {
          setDuplicateSupplierId(e.existingSupplierId);
        }
      } else {
        setError(e instanceof Error ? e.message : "Erro ao salvar cadastro.");
      }
    } finally {
      setSaving(false);
    }
  };

  const loadCnpj = async (refresh = false) => {
    setCnpjLoading(true);
    setCnpjError(null);
    setMessage(null);
    try {
      const digits = cnpjInput.replace(/\D/g, "");
      if (isCreate) {
        const draftParams = new URLSearchParams();
        draftParams.set("cnpj", digits);
        if (displayName.trim()) draftParams.set("displayName", displayName.trim());
        if (legalName.trim()) draftParams.set("legalName", legalName.trim());
        if (tradeName.trim()) draftParams.set("tradeName", tradeName.trim());
        if (document.trim()) draftParams.set("document", document.trim());

        let payload: FinanceSupplierCnpjLookupPayload;
        if (refresh) {
          payload = await fetchJsonOk("/api/finance/suppliers/cnpj-lookup/refresh", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cnpj: cnpjInput,
              displayName: displayName.trim() || undefined,
              legalName: legalName.trim() || undefined,
              tradeName: tradeName.trim() || undefined,
              document: document.trim() || undefined,
            }),
          });
        } else {
          payload = await fetchJsonOk(
            `/api/finance/suppliers/cnpj-lookup?${draftParams.toString()}`,
            { credentials: "include" }
          );
        }
        setCnpjData(payload);
        setSelectedFields(
          payload.comparison?.fields.filter((f) => f.selectable).map((f) => f.field) ?? []
        );
        return;
      }

      if (!supplierId) return;
      let payload: FinanceSupplierIntelligencePayload;
      if (refresh) {
        payload = await fetchJsonOk(
          `/api/finance/suppliers/${supplierId}/company-intelligence/refresh`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(digits.length === 14 ? { cnpj: cnpjInput } : {}),
          }
        );
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

  const applyCnpjToCreateForm = () => {
    if (!cnpjData || !canManage) return;
    const draft = {
      displayName: displayName.trim() || null,
      legalName: legalName.trim() || null,
      tradeName: tradeName.trim() || null,
      document: document.trim() || null,
    };
    const hasFilled =
      Boolean(draft.displayName) ||
      Boolean(draft.legalName) ||
      Boolean(draft.tradeName) ||
      Boolean(draft.document);
    const patch = buildSupplierApplyPatch(draft, cnpjData.summary, selectedFields);
    if (Object.keys(patch).length === 0) {
      setCnpjError("Nenhum campo selecionado pode ser aplicado ao formulário.");
      return;
    }
    const wouldOverwrite = selectedFields.some((field) => {
      if (field === "legalName" && draft.legalName) return true;
      if (field === "tradeName" && draft.tradeName) return true;
      if (field === "document" && draft.document) return true;
      return false;
    });
    if (hasFilled && wouldOverwrite) {
      if (
        !confirm(
          "Deseja substituir os dados atuais do formulário pelos dados encontrados na consulta CNPJ?"
        )
      ) {
        return;
      }
    }
    if (patch.legalName) setLegalName(patch.legalName);
    if (patch.tradeName) setTradeName(patch.tradeName);
    if (patch.document) {
      setDocument(patch.document);
      setCnpjInput(patch.document);
    }
    if (patch.displayName) setDisplayName(patch.displayName);
    setMessage("Dados da consulta CNPJ aplicados ao formulário.");
    setCnpjError(null);
  };

  const applyCnpjFields = async () => {
    if (isCreate) {
      applyCnpjToCreateForm();
      return;
    }
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

  if (!open || !portalContainer) return null;
  if (!isCreate && !supplierId) return null;

  const showForm = isCreate || Boolean(profile);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/40"
      data-testid="finance-supplier-cadastro-drawer"
      data-mode={mode}
    >
      <div className={cn(financeBiCardClass, "flex h-full w-full max-w-2xl flex-col shadow-xl")}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {isCreate ? "Novo fornecedor" : "Editar fornecedor"}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {isCreate
                ? "Cadastro manual na base consolidada de fornecedores — consulta CNPJ opcional."
                : "Dados cadastrais consolidados — não altera títulos AP originais."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {error ? (
            <div className="space-y-2">
              <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {error}
              </div>
              {duplicateSupplierId && onOpenExisting ? (
                <button
                  type="button"
                  data-testid="finance-supplier-open-existing-button"
                  className="rounded-lg border px-3 py-2 text-sm font-semibold"
                  onClick={() => onOpenExisting(duplicateSupplierId)}
                >
                  Abrir cadastro existente
                </button>
              ) : null}
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
          ) : showForm ? (
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
                      disabled={formDisabled}
                      data-testid="finance-supplier-display-name-input"
                    />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-muted-foreground">Razão social</span>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      disabled={formDisabled}
                    />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-muted-foreground">Nome fantasia</span>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={tradeName}
                      onChange={(e) => setTradeName(e.target.value)}
                      disabled={formDisabled}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground">CNPJ / documento</span>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={document}
                      onChange={(e) => setDocument(e.target.value)}
                      disabled={formDisabled}
                      data-testid="finance-supplier-document-input"
                    />
                  </label>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground">Status</span>
                    <p className="text-sm font-semibold">
                      {isCreate ? "ACTIVE" : profile?.status ?? "—"}
                    </p>
                  </div>
                </div>
                {canManage && (isCreate || !isInactive) ? (
                  <button
                    type="button"
                    data-testid="finance-supplier-save-cadastro-button"
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    disabled={saving}
                    onClick={() => void saveProfile()}
                  >
                    {saving
                      ? isCreate
                        ? "Cadastrando…"
                        : "Salvando…"
                      : isCreate
                        ? "Cadastrar fornecedor"
                        : "Salvar alterações"}
                  </button>
                ) : null}
              </section>

              {!isCreate && profile ? (
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
              ) : null}

              {!isCreate && profile && profile.aliases.length > 0 ? (
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
                  {isCreate
                    ? "Opcional. Informe o CNPJ e consulte para preencher o formulário. Você também pode cadastrar manualmente sem consultar."
                    : "Mesma rotina de Clientes (publica.cnpj.ws). Endereço e contatos públicos são exibidos para comparação; apenas razão social, fantasia e CNPJ (se vazio) podem ser aplicados ao cadastro consolidado."}
                </p>
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="flex-1 min-w-[180px]">
                    <span className="text-xs text-muted-foreground">CNPJ para consulta</span>
                    <input
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                      placeholder="00.000.000/0000-00"
                      value={cnpjInput}
                      onChange={(e) => setCnpjInput(e.target.value)}
                      disabled={formDisabled}
                      data-testid="finance-supplier-cnpj-input"
                    />
                  </label>
                  <button
                    type="button"
                    data-testid="finance-supplier-consult-cnpj-button"
                    className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    disabled={
                      cnpjLoading ||
                      formDisabled ||
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
                        {canManage && (isCreate || !isInactive) ? (
                          <div className="p-3 border-t">
                            <button
                              type="button"
                              data-testid="finance-supplier-apply-cnpj-button"
                              className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                              disabled={cnpjLoading || selectedFields.length === 0}
                              onClick={() => void applyCnpjFields()}
                            >
                              {isCreate
                                ? "Preencher formulário com selecionados"
                                : "Aplicar dados selecionados"}
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

        {!isCreate && canDelete && profile?.status !== "INACTIVE" ? (
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
    portalContainer
  );
}
