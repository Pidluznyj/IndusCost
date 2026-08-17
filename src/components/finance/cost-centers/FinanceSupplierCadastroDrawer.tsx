import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Building2,
  FileSearch,
  Loader2,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { CNPJ_COMPARE_STATUS_LABEL } from "@/src/lib/customerCnpjIntelligenceTypes";
import type {
  FinanceSupplierCnpjLookupPayload,
  FinanceSupplierIntelligencePayload,
  FinancialSupplierProfileDto,
} from "@/src/lib/financeSupplierProfile";
import { buildSupplierApplyPatch } from "@/src/lib/financeSupplierCnpjCompare";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import { SupplierServiceTerminationDialog } from "@/src/components/finance/cost-centers/SupplierServiceTerminationDialog";

export type FinanceSupplierCadastroMode = "create" | "edit";

/**
 * Abas do modal — mesmo padrão do cadastro de Clientes
 * (`CustomerModule`): identificação primeiro, o resto em abas para o modal
 * não virar uma coluna infinita de rolagem.
 */
type SupplierFormTab = "cadastro" | "cnpj" | "financeiro";

/**
 * Classes do padrão de cadastro, iguais às do modal de Clientes — rótulo
 * pequeno em caixa alta, campo com anel de foco no primary. Centralizadas
 * aqui para os dois cadastros não divergirem com o tempo.
 */
const FIELD_LABEL = "text-xs font-bold text-muted-foreground uppercase";
const FIELD_INPUT =
  "w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60";
const SECTION_TITLE =
  "text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2";
const TAB_BUTTON_BASE =
  "px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors";
const TAB_BUTTON_ACTIVE = "bg-card border-border text-foreground";
const TAB_BUTTON_IDLE =
  "bg-transparent border-transparent text-muted-foreground hover:text-foreground";

/** Data curta pt-BR; "—" quando a origem não informou. */
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

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
  /** Resumo AP, regras e aliases com contagem de títulos — só no contexto Centro de Custos. */
  showFinancialSummary?: boolean;
  canViewServiceTermination?: boolean;
  canCreateServiceTermination?: boolean;
  canFinalizeServiceTermination?: boolean;
  canExportServiceTermination?: boolean;
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
  showFinancialSummary = true,
  canViewServiceTermination = false,
  canCreateServiceTermination = false,
  canFinalizeServiceTermination = false,
  canExportServiceTermination = false,
}: Props) {
  const portalContainer = usePortalContainer();
  const [formTab, setFormTab] = useState<SupplierFormTab>("cadastro");
  const [terminationOpen, setTerminationOpen] = useState(false);
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
    setFormTab("cadastro");
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
  const showFinanceTab = !isCreate && Boolean(profile) && showFinancialSummary;
  const canSubmit = canManage && (isCreate || !isInactive);

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    void saveProfile();
  };

  /** Leva o documento do cadastro para a aba de consulta, sem redigitar. */
  const goToCnpjTab = () => {
    if (document.trim() && !cnpjInput.trim()) setCnpjInput(document.trim());
    setFormTab("cnpj");
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      data-testid="finance-supplier-cadastro-drawer"
      data-mode={mode}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        {/* Cabeçalho — mesmo padrão do cadastro de Clientes. */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-accent/30 p-6">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-xl font-bold">
              <Building2 className="h-5 w-5 text-primary" />
              {isCreate ? "Novo fornecedor" : "Editar fornecedor"}
            </h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {isCreate
                ? "Cadastro manual na base consolidada de fornecedores — consulta CNPJ opcional."
                : "Dados cadastrais consolidados — não altera títulos AP originais."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isCreate && supplierId && canViewServiceTermination ? (
              <button
                type="button"
                data-testid="finance-supplier-service-termination-button"
                onClick={() => setTerminationOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                title="Cálculo gerencial do encerramento de prestação de serviço — não é rescisão CLT."
              >
                <FileSearch className="h-4 w-4 text-primary" />
                Encerramento de prestação
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 transition-colors hover:bg-accent"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-1 border-b border-border px-6 pt-4">
          <button
            type="button"
            data-testid="finance-supplier-tab-cadastro"
            onClick={() => setFormTab("cadastro")}
            className={cn(
              TAB_BUTTON_BASE,
              formTab === "cadastro" ? TAB_BUTTON_ACTIVE : TAB_BUTTON_IDLE
            )}
          >
            Dados cadastrais
          </button>
          <button
            type="button"
            data-testid="finance-supplier-tab-cnpj"
            onClick={goToCnpjTab}
            className={cn(
              TAB_BUTTON_BASE,
              formTab === "cnpj" ? TAB_BUTTON_ACTIVE : TAB_BUTTON_IDLE
            )}
          >
            Consulta CNPJ
          </button>
          {showFinanceTab ? (
            <button
              type="button"
              data-testid="finance-supplier-tab-financeiro"
              onClick={() => setFormTab("financeiro")}
              className={cn(
                TAB_BUTTON_BASE,
                formTab === "financeiro" ? TAB_BUTTON_ACTIVE : TAB_BUTTON_IDLE
              )}
            >
              Financeiro (AP)
            </button>
          ) : null}
        </div>

        {/* Avisos — visíveis em qualquer aba. */}
        {error || message ? (
          <div className="space-y-2 border-b border-border px-6 py-3">
            {error ? (
              <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-2">
                  <p>{error}</p>
                  {duplicateSupplierId && onOpenExisting ? (
                    <button
                      type="button"
                      data-testid="finance-supplier-open-existing-button"
                      className="rounded-lg border border-red-300 bg-background px-3 py-1.5 text-xs font-semibold text-red-800"
                      onClick={() => onOpenExisting(duplicateSupplierId)}
                    >
                      Abrir cadastro existente
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {message ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {message}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Corpo */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !showForm ? (
          <div className="flex-1 px-6 py-10 text-center text-sm text-muted-foreground">
            Não foi possível carregar o cadastro deste fornecedor.
          </div>
        ) : formTab === "cadastro" ? (
          <form
            id="finance-supplier-cadastro-form"
            onSubmit={submitForm}
            className="flex-1 space-y-8 overflow-y-auto p-6"
          >
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              {/* Identificação */}
              <div className="space-y-4">
                <h4 className={SECTION_TITLE}>
                  <Building2 className="h-4 w-4" /> Identificação
                </h4>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className={FIELD_LABEL}>Nome exibido</label>
                    <input
                      type="text"
                      className={FIELD_INPUT}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={formDisabled}
                      data-testid="finance-supplier-display-name-input"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Nome que aparece nas listas e relatórios de Contas a Pagar.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className={FIELD_LABEL}>Razão social</label>
                    <input
                      type="text"
                      className={FIELD_INPUT}
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      disabled={formDisabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={FIELD_LABEL}>Nome fantasia</label>
                    <input
                      type="text"
                      className={FIELD_INPUT}
                      value={tradeName}
                      onChange={(e) => setTradeName(e.target.value)}
                      disabled={formDisabled}
                    />
                  </div>
                </div>
              </div>

              {/* Documento e situação */}
              <div className="space-y-4">
                <h4 className={SECTION_TITLE}>
                  <FileSearch className="h-4 w-4" /> Documento e situação
                </h4>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className={FIELD_LABEL}>CNPJ / documento</label>
                    <input
                      type="text"
                      className={cn(FIELD_INPUT, "font-mono")}
                      placeholder="00.000.000/0000-00"
                      value={document}
                      onChange={(e) => setDocument(e.target.value)}
                      disabled={formDisabled}
                      data-testid="finance-supplier-document-input"
                    />
                    <button
                      type="button"
                      onClick={goToCnpjTab}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      Consultar na Receita →
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className={FIELD_LABEL}>Status</label>
                    <div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                          isInactive
                            ? "bg-red-500/10 text-red-600"
                            : "bg-green-500/10 text-green-600"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            isInactive ? "bg-red-600" : "bg-green-600"
                          )}
                        />
                        {isCreate ? "Ativo (novo)" : isInactive ? "Inativo" : "Ativo"}
                      </span>
                    </div>
                    {isInactive ? (
                      <p className="text-[11px] text-muted-foreground">
                        Cadastro inativado — edição bloqueada. Títulos, alocações e regras
                        seguem preservados.
                      </p>
                    ) : null}
                  </div>
                  {!isCreate && profile ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className={FIELD_LABEL}>Cadastrado em</label>
                        <p className="text-sm">{formatDate(profile.createdAt)}</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className={FIELD_LABEL}>Atualizado em</label>
                        <p className="text-sm">{formatDate(profile.updatedAt)}</p>
                      </div>
                      {showFinancialSummary ? (
                        <>
                          <div className="space-y-1.5">
                            <label className={FIELD_LABEL}>1ª ocorrência (AP)</label>
                            <p className="text-sm">{formatDate(profile.firstSeenAt)}</p>
                          </div>
                          <div className="space-y-1.5">
                            <label className={FIELD_LABEL}>Última ocorrência (AP)</label>
                            <p className="text-sm">{formatDate(profile.lastSeenAt)}</p>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </form>
        ) : formTab === "cnpj" ? (
          <div className="flex-1 space-y-6 overflow-y-auto p-6">
            <div className="space-y-4">
              <h4 className={SECTION_TITLE}>
                <FileSearch className="h-4 w-4" /> Consulta CNPJ
              </h4>
              <p className="text-xs text-muted-foreground">
                {isCreate
                  ? "Opcional. Informe o CNPJ e consulte para preencher o formulário. Você também pode cadastrar manualmente sem consultar."
                  : "Mesma rotina de Clientes (publica.cnpj.ws). Endereço e contatos públicos são exibidos para comparação; apenas razão social, fantasia e CNPJ (se vazio) podem ser aplicados ao cadastro consolidado."}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <label className={FIELD_LABEL}>CNPJ para consulta</label>
                  <input
                    type="text"
                    className={cn(FIELD_INPUT, "font-mono")}
                    placeholder="00.000.000/0000-00"
                    value={cnpjInput}
                    onChange={(e) => setCnpjInput(e.target.value)}
                    disabled={formDisabled}
                    data-testid="finance-supplier-cnpj-input"
                  />
                </div>
                <button
                  type="button"
                  data-testid="finance-supplier-consult-cnpj-button"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  disabled={
                    cnpjLoading || formDisabled || cnpjInput.replace(/\D/g, "").length !== 14
                  }
                  onClick={() => void loadCnpj(false)}
                >
                  Consultar CNPJ
                </button>
                {cnpjData ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
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
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {cnpjError}
                </div>
              ) : null}

              {cnpjLoading && !cnpjData ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : null}
            </div>

            {cnpjData ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-accent/20 p-4">
                  <p className="text-base font-bold">{cnpjData.summary.companyName}</p>
                  <p className="text-sm text-muted-foreground">
                    {cnpjData.summary.tradeName ?? "—"} · {cnpjData.summary.cnpjFormatted}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Situação: {cnpjData.summary.registrationStatus ?? "—"} ·{" "}
                    {new Date(cnpjData.fetchedAt).toLocaleString("pt-BR")}
                  </p>
                </div>

                {cnpjData.comparison ? (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="border-b border-border bg-accent/30 px-4 py-2.5 text-sm font-bold">
                      Dados divergentes ({cnpjData.comparison.suggestedUpdates} aplicáveis)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            <th className="px-3 py-2 font-semibold">Campo</th>
                            <th className="px-3 py-2 font-semibold">Atual</th>
                            <th className="px-3 py-2 font-semibold">Receita</th>
                            <th className="px-3 py-2 font-semibold">Status</th>
                            <th className="px-3 py-2 text-center font-semibold">Aplicar</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {cnpjData.comparison.fields.map((f) => (
                            <tr
                              key={f.field}
                              className={cn(
                                "align-top transition-colors hover:bg-accent/20",
                                f.selectable && "bg-primary/[0.03]"
                              )}
                            >
                              <td className="px-3 py-2 font-medium whitespace-nowrap">
                                {f.label}
                              </td>
                              <td className="px-3 py-2">{f.erpValue ?? "—"}</td>
                              <td className="px-3 py-2">{f.apiValue ?? "—"}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                                {CNPJ_COMPARE_STATUS_LABEL[f.status] ?? f.status}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {f.selectable && canManage ? (
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-primary"
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
                    {canSubmit ? (
                      <div className="border-t border-border p-4">
                        <button
                          type="button"
                          data-testid="finance-supplier-apply-cnpj-button"
                          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
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
          </div>
        ) : (
          <div
            className="flex-1 space-y-6 overflow-y-auto p-6"
            data-testid="finance-supplier-financial-summary"
          >
            <div className="space-y-4">
              <h4 className={SECTION_TITLE}>
                <Wallet className="h-4 w-4" /> Resumo financeiro (AP)
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-accent/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Títulos vinculados
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {profile?.titlesCount ?? 0}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-accent/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Valor total visto
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {formatFinanceCurrency(profile?.totalAmountSeen ?? 0)}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-accent/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Alocações CC
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {profile?.allocationCount ?? 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className={SECTION_TITLE}>Regras de centro de custo ativas</h4>
              {profile && profile.activeRules.length > 0 ? (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {profile.activeRules.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <span className="truncate">{rule.costCenterName}</span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {rule.percentage}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem regra de centro de custo ativa.
                </p>
              )}
            </div>

            {profile && profile.aliases.length > 0 ? (
              <div className="space-y-3">
                <h4 className={SECTION_TITLE}>Aliases ({profile.aliases.length})</h4>
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="min-w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-3 py-2 font-semibold">Nome de origem</th>
                        <th className="px-3 py-2 font-semibold">Documento</th>
                        <th className="px-3 py-2 text-right font-semibold">Títulos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {profile.aliases.slice(0, 12).map((alias) => (
                        <tr key={alias.id}>
                          <td className="px-3 py-2">{alias.originalName ?? "—"}</td>
                          <td className="px-3 py-2 font-mono">
                            {alias.originalDocument ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {alias.titlesCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {profile.aliases.length > 12 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Mostrando 12 de {profile.aliases.length} aliases.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {/* Rodapé fixo — ação destrutiva à esquerda, salvar à direita. */}
        <div className="flex items-center justify-between gap-3 border-t border-border p-6">
          <div>
            {!isCreate && canDelete && profile && !isInactive ? (
              <button
                type="button"
                data-testid="finance-supplier-delete-button"
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 transition-colors hover:bg-red-100 disabled:opacity-50"
                disabled={deleting}
                onClick={() => void deactivateSupplier()}
              >
                <Trash2 className="h-4 w-4" />
                Excluir fornecedor (inativar cadastro)
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-6 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              Cancelar
            </button>
            {canSubmit ? (
              <button
                type="submit"
                form="finance-supplier-cadastro-form"
                data-testid="finance-supplier-save-cadastro-button"
                className="rounded-lg bg-primary px-8 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={saving}
                onClick={() => {
                  // O botão vive fora do <form> (rodapé fixo) e as abas
                  // desmontam o formulário: fora da aba de cadastro o submit
                  // nativo não dispara, então salvamos direto.
                  if (formTab !== "cadastro") void saveProfile();
                }}
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
          </div>
        </div>
      </motion.div>
      {supplierId && terminationOpen ? (
        <SupplierServiceTerminationDialog
          open={terminationOpen}
          supplierId={supplierId}
          supplierName={displayName || profile?.displayName || "Fornecedor"}
          onClose={() => setTerminationOpen(false)}
          canCreate={canCreateServiceTermination}
          canFinalize={canFinalizeServiceTermination}
          canExport={canExportServiceTermination}
        />
      ) : null}
    </div>,
    portalContainer
  );
}
