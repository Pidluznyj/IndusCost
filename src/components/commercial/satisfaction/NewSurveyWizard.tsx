/**
 * Assistente de nova pesquisa — 4 etapas: dados → questionário → clientes →
 * revisão/publicação.
 *
 * O questionário V1 é histórico e imutável: a etapa 2 é informativa, e é assim
 * de propósito — mexer nele quebraria a comparabilidade da série.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import {
  satisfactionApi,
  type SatisfactionCustomerOption,
} from "./satisfactionApi.js";
import {
  CustomerAutocompleteFilter,
  type EntityAutocompleteSelection,
} from "@/src/components/common/CustomerAutocompleteFilter";

type Props = {
  onClose: () => void;
  onCreated: (campaignId: string) => void;
};

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "Dados da pesquisa",
  2: "Questionário",
  3: "Clientes",
  4: "Revisão",
};

/** Os seis critérios do V1 — exibidos para conferência, nunca editáveis. */
const V1_CRITERIA = [
  "Atendimento comercial e telefônico",
  "Tempo de resposta a cotações e Pedidos",
  "Cumprimento do prazo de entrega",
  "Conformidade do Pedido",
  "Qualidade do Produto",
  "Suporte Técnico",
];

export function NewSurveyWizard({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [referenceStart, setReferenceStart] = useState("");
  const [referenceEnd, setReferenceEnd] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [allowGeneralLink, setAllowGeneralLink] = useState(false);

  const [customerSearch, setCustomerSearch] = useState("");
  // Autocomplete de cliente: seleção filtra por id exato; texto livre cai na
  // busca textual (nome/CNPJ) que o endpoint de audiência já faz.
  const [customerSelection, setCustomerSelection] =
    useState<EntityAutocompleteSelection | null>(null);
  const [onlyWithOrders, setOnlyWithOrders] = useState(false);
  const [customers, setCustomers] = useState<SatisfactionCustomerOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    setError(null);
    try {
      const result = await satisfactionApi.listCustomers({
        search: customerSearch || null,
        customerId: customerSelection?.id ?? null,
        onlyWithOrders,
        from: onlyWithOrders ? referenceStart || null : null,
        to: onlyWithOrders ? referenceEnd || null : null,
      });
      setCustomers(result.customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar clientes.");
    } finally {
      setLoadingCustomers(false);
    }
  }, [customerSearch, customerSelection, onlyWithOrders, referenceEnd, referenceStart]);

  useEffect(() => {
    if (step === 3) void loadCustomers();
  }, [step, loadCustomers]);

  const step1Valid = name.trim().length > 0 && referenceStart && referenceEnd;

  const toggleCustomer = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await satisfactionApi.createCampaign({
        name: name.trim(),
        referenceStart: new Date(referenceStart).toISOString(),
        referenceEnd: new Date(referenceEnd).toISOString(),
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
        allowGeneralLink,
      });
      const campaignId = created.campaign.id;
      if (selected.size > 0) {
        await satisfactionApi.setAudience(campaignId, [...selected]);
      }
      onCreated(campaignId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a pesquisa.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Nova pesquisa de satisfação"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <h2 className="text-[17px] font-bold text-[#0F172A]">Nova pesquisa</h2>
            <p className="text-[13px] text-[#64748B]">
              Etapa {step} de 4 — {STEP_LABELS[step]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#64748B] hover:bg-[#F1F5F9]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex gap-1 px-5 pt-3">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-[#1D4ED8]" : "bg-[#E2E8F0]"}`}
            />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="mb-4 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]">
              {error}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <label className="block">
                <span className="text-[13px] font-semibold text-[#334155]">
                  Nome da pesquisa <span className="text-[#B91C1C]">*</span>
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px]"
                  placeholder="Ex.: Satisfação de Clientes 2026"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[13px] font-semibold text-[#334155]">
                    Período avaliado — início <span className="text-[#B91C1C]">*</span>
                  </span>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px]"
                    value={referenceStart}
                    onChange={(e) => setReferenceStart(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-[13px] font-semibold text-[#334155]">
                    Período avaliado — fim <span className="text-[#B91C1C]">*</span>
                  </span>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px]"
                    value={referenceEnd}
                    onChange={(e) => setReferenceEnd(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[13px] font-semibold text-[#334155]">
                  Encerrar respostas em (opcional)
                </span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px]"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                />
                <span className="mt-1 block text-[12px] text-[#94A3B8]">
                  Depois desta data o formulário público deixa de aceitar respostas.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={allowGeneralLink}
                  onChange={(e) => setAllowGeneralLink(e.target.checked)}
                />
                <span className="text-[13px] text-[#334155]">
                  Gerar também um <strong>link geral</strong> (WhatsApp/QR)
                  <span className="block text-[12px] text-[#94A3B8]">
                    No link geral o cliente informa os próprios dados, então a taxa de
                    resposta não é atribuível a um convite específico.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <div className="rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-[13px] text-[#1E40AF]">
                O questionário histórico (V1) é imutável — é o que mantém as pesquisas
                comparáveis ao longo dos anos. Uma revisão futura nasce como nova versão,
                sem alterar esta.
              </div>
              <div className="rounded-md border border-[#E2E8F0]">
                <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
                  Identificação
                </div>
                <ul className="divide-y divide-[#F1F5F9] text-[13px] text-[#334155]">
                  <li className="px-3 py-2">Cliente (nome da empresa) — obrigatório</li>
                  <li className="px-3 py-2">CNPJ — opcional</li>
                  <li className="px-3 py-2">Telefone/celular para contato — obrigatório</li>
                  <li className="px-3 py-2">Data — obrigatório</li>
                  <li className="px-3 py-2">Responsável pelo preenchimento — obrigatório</li>
                </ul>
              </div>
              <div className="rounded-md border border-[#E2E8F0]">
                <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
                  Critérios avaliados — escala 1 a 5
                </div>
                <ul className="divide-y divide-[#F1F5F9] text-[13px] text-[#334155]">
                  {V1_CRITERIA.map((criterion) => (
                    <li key={criterion} className="px-3 py-2">
                      {criterion}
                    </li>
                  ))}
                </ul>
                <p className="border-t border-[#E2E8F0] px-3 py-2 text-[12px] text-[#64748B]">
                  1 Ruim · 2 Regular · 3 Bom · 4 Ótimo · 5 Excelente
                </p>
              </div>
              <div className="rounded-md border border-[#E2E8F0] px-3 py-2 text-[13px] text-[#334155]">
                Comentário aberto — obrigatório
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div
                  className="min-w-[260px] flex-1"
                  data-testid="satisfaction-wizard-customer-filter"
                >
                  <CustomerAutocompleteFilter
                    label="Cliente (nome ou CNPJ)"
                    placeholder="Buscar por nome ou CNPJ…"
                    allowFreeText
                    value={customerSelection}
                    onChange={(selection) => {
                      // Seleção do autocomplete → filtro por id exato; texto
                      // livre (Enter sem selecionar) → busca textual, mesmo
                      // comportamento do campo anterior. loadCustomers refaz
                      // pela mudança de deps.
                      setCustomerSelection(selection);
                      setCustomerSearch(
                        selection?.id ? "" : (selection?.name ?? "")
                      );
                    }}
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-[13px] text-[#334155]">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={onlyWithOrders}
                    onChange={(e) => setOnlyWithOrders(e.target.checked)}
                  />
                  Só quem comprou no período
                </label>
              </div>

              <div className="flex items-center justify-between rounded-md bg-[#F8FAFC] px-3 py-2 text-[13px]">
                <span className="font-semibold text-[#0F172A]">
                  {selected.size} cliente(s) selecionado(s)
                </span>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="font-semibold text-[#1D4ED8] hover:underline"
                    onClick={() => setSelected(new Set(customers.map((c) => c.id)))}
                  >
                    Selecionar os {customers.length} listados
                  </button>
                  {selected.size > 0 ? (
                    <button
                      type="button"
                      className="font-semibold text-[#64748B] hover:underline"
                      onClick={() => setSelected(new Set())}
                    >
                      Limpar
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="max-h-[320px] overflow-y-auto rounded-md border border-[#E2E8F0]">
                {loadingCustomers ? (
                  <p className="px-3 py-6 text-center text-[13px] text-[#64748B]">
                    Carregando clientes…
                  </p>
                ) : customers.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[13px] text-[#64748B]">
                    Nenhum cliente encontrado com esses filtros.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#F1F5F9]">
                    {customers.map((customer) => (
                      <li key={customer.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[#F8FAFC]">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selected.has(customer.id)}
                            onChange={() => toggleCustomer(customer.id)}
                          />
                          <span className="flex-1">
                            <span className="block text-[13px] font-medium text-[#0F172A]">
                              {customer.companyName}
                            </span>
                            <span className="block text-[12px] text-[#94A3B8]">
                              {customer.taxId}
                              {customer.responsibleCommercialName
                                ? ` · ${customer.responsibleCommercialName}`
                                : ""}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-3 text-[14px]">
              <dl className="divide-y divide-[#F1F5F9] rounded-md border border-[#E2E8F0]">
                {[
                  ["Nome", name || "—"],
                  [
                    "Período avaliado",
                    referenceStart && referenceEnd
                      ? `${new Date(referenceStart).toLocaleDateString("pt-BR")} — ${new Date(referenceEnd).toLocaleDateString("pt-BR")}`
                      : "—",
                  ],
                  [
                    "Encerramento",
                    closesAt ? new Date(closesAt).toLocaleDateString("pt-BR") : "Sem data limite",
                  ],
                  ["Questionário", "CUSTOMER_SATISFACTION_V1 (histórico, imutável)"],
                  ["Clientes selecionados", `${selected.size}`],
                  ["Link geral", allowGeneralLink ? "Sim" : "Não"],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-4 px-3 py-2">
                    <dt className="w-48 shrink-0 text-[13px] font-semibold text-[#64748B]">
                      {label}
                    </dt>
                    <dd className="text-[13px] text-[#0F172A]">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="rounded-md bg-[#F8FAFC] px-3 py-2 text-[12px] text-[#64748B]">
                A pesquisa será criada como <strong>rascunho</strong>. Você ainda poderá ajustar
                a audiência antes de publicar — a publicação é que congela o questionário e
                emite os links.
              </p>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#E2E8F0] px-5 py-4">
          <button
            type="button"
            className="rounded-md px-3 py-2 text-[14px] font-semibold text-[#64748B] hover:bg-[#F1F5F9]"
            onClick={() => (step === 1 ? onClose() : setStep((step - 1) as Step))}
          >
            {step === 1 ? "Cancelar" : "Voltar"}
          </button>
          {step < 4 ? (
            <button
              type="button"
              disabled={step === 1 && !step1Valid}
              className="rounded-md bg-[#1D4ED8] px-5 py-2 text-[14px] font-semibold text-white hover:bg-[#1E40AF] disabled:bg-[#94A3B8]"
              onClick={() => setStep((step + 1) as Step)}
            >
              Continuar
            </button>
          ) : (
            <button
              type="button"
              disabled={saving || !step1Valid}
              className="inline-flex items-center gap-2 rounded-md bg-[#047857] px-5 py-2 text-[14px] font-semibold text-white hover:bg-[#065F46] disabled:bg-[#94A3B8]"
              onClick={() => void handleCreate()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Criar rascunho
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
