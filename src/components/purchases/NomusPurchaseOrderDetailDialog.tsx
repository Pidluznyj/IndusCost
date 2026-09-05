import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, Loader2, Printer, X } from "lucide-react";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";
import { cn, formatCurrency } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { OverlayBadge } from "@/src/components/ui/overlay";
import {
  nomusPurchaseOrderFinancialLabel,
  nomusPurchaseOrderFinancialTone,
  nomusPurchaseOrderStageLabel,
  nomusPurchaseOrderStageTone,
} from "@/src/lib/nomus/nomusPurchaseOrderUi";

type DetailTabId = "geral" | "itens" | "fiscal" | "financeiro" | "nomus";

type SupplierDto = {
  nomusExternalId: number | null;
  nomusName: string | null;
  nomusDocument: string | null;
  resolvedName: string | null;
  resolvedDocument: string | null;
  financialSupplierId: string | null;
  matchMethod: string;
  matchConfidence: string;
  matched: boolean;
  ambiguous: boolean;
};

type Detail360 = {
  order: {
    id: string;
    externalId: number;
    orderNumber: string | null;
    statusRaw: string | null;
    canceled: boolean | null;
    stage: string;
    issuedAt: string | null;
    expectedAt: string | null;
    overdue: boolean;
    paymentTerms: string | null;
    comments: string | null;
    header: Record<string, unknown>;
  };
  supplier: SupplierDto;
  items: Array<{
    id: string;
    lineCode: string | null;
    productExternalId: number | null;
    productCode: string | null;
    description: string | null;
    descriptionSource: string | null;
    unit: string | null;
    orderedQuantity: number | null;
    receivedQuantity: number | null;
    remainingQuantity: number | null;
    unitPrice: number | null;
    discountPercent: number | null;
    discountAmount: number | null;
    surchargePercent: number | null;
    surchargeAmount: number | null;
    totalAmount: number | null;
    deliveryDate: string | null;
    comments: string | null;
    itemStatusCode: number | null;
    itemStatusLabel: string | null;
    unitId: number | null;
    entrySectorId: number | null;
    financialClassificationId: number | null;
    movementTypeId: number | null;
  }>;
  plannedInstallments: Array<{
    index: number;
    dueDate: string | null;
    dueDateRaw: string | null;
    amount: number | null;
    paymentMethodId: number | null;
    bankAccountId: number | null;
    generatesAdvance: boolean | null;
  }>;
  receiving: {
    stage: string;
    itemCount: number;
    waitingRelease: number;
    released: number;
    partial: number;
    received: number;
    receivedWithCut: number;
    canceled: number;
    returnedPartial: number;
    returnedFull: number;
    receivingQuantityAvailable: boolean;
  };
  fiscal: {
    invoices: Array<{
      externalId: number;
      number: string | null;
      series: string | null;
      key: string | null;
      issuedAt: string | null;
      processedAt: string | null;
      issuerDocument: string | null;
      status: number | null;
      operationType: number | null;
      amount: number | null;
      canceled: boolean;
      foundLocally: boolean;
    }>;
    unresolvedLabel: string | null;
  };
  confirmedPayables: Array<{
    externalId: number;
    sourceInvoiceNumber: string | null;
    personName: string | null;
    dueDate: string | null;
    paymentDate: string | null;
    settlementDate: string | null;
    amountPayable: number | null;
    amountPaid: number | null;
    balancePayable: number | null;
    paymentMethodName: string | null;
    hasBoletoDocument: boolean;
    boletoIsPaymentMethodOnly: boolean;
  }>;
  financialSummary: {
    plannedInstallmentsTotal: number | null;
    plannedInstallmentsCount: number;
    financialStatus: string;
    count: number;
    confirmedAmount: number;
    paidAmount: number;
    openAmount: number;
    hasBoletoDocument: boolean;
  };
  relationEvidence: Array<{ method: string; confidence: string; source: string; detail: string }>;
  syncMetadata: {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    syncedAt: string | null;
    payloadHash: string | null;
    createdAtNomus: string | null;
    modifiedAtNomus: string | null;
  };
  rawPayload?: unknown;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value : "—";
  }
  return date.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

function display(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}

function money(value: number | null | undefined): string {
  return value == null ? "—" : formatCurrency(value);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

const TABS: Array<{ id: DetailTabId; label: string }> = [
  { id: "geral", label: "Geral" },
  { id: "itens", label: "Itens" },
  { id: "fiscal", label: "Recebimento / Fiscal" },
  { id: "financeiro", label: "Financeiro" },
  { id: "nomus", label: "Dados Nomus" },
];

export function NomusPurchaseOrderDetailDialog({
  open,
  orderId,
  orderCode,
  onClose,
}: {
  open: boolean;
  orderId: string | null;
  orderCode?: string | null;
  onClose: () => void;
}): React.ReactElement | null {
  const { hasPermission } = useAuth();
  const canSeeRaw = hasPermission("settings.nomus.view") || hasPermission("settings.view");
  const [payload, setPayload] = useState<Detail360 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTabId>("geral");

  useEffect(() => {
    if (!open || !orderId) {
      setPayload(null);
      setError(null);
      setActiveTab("geral");
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setActiveTab("geral");
    const qs = canSeeRaw ? "?includeRaw=1" : "";
    void fetchUiSessionCachedJson<Detail360>(`/api/nomus/purchase-orders/${orderId}${qs}`, {
      signal: ac.signal,
      ttlMs: 30_000,
    })
      .then((data) => {
        if (ac.signal.aborted) return;
        setPayload(data);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setPayload(null);
        setError(e instanceof Error ? e.message : "Erro ao carregar detalhe do pedido.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, orderId, canSeeRaw]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const code = payload?.order.orderNumber ?? orderCode ?? "";

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível */
    }
  }, [code]);

  const handlePrint = useCallback(() => {
    if (!payload) return;
    window.print();
  }, [payload]);

  const apSearch =
    payload?.confirmedPayables[0]?.sourceInvoiceNumber ||
    payload?.supplier.resolvedName ||
    payload?.supplier.nomusName ||
    "";

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe do Pedido de Compra Nomus"
      data-testid="nomus-purchase-order-detail-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-[1400px] max-h-[95vh] flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl sm:max-h-[92vh]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] bg-white px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#1e3a8a]">
              Compras · Pedidos Nomus
            </p>
            <h1 className="text-base font-bold text-[#0f172a]">
              Detalhe do Pedido — {code || "…"}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!code}
              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
              data-testid="npo-detail-copy-code"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copiado" : "Copiar número"}
            </button>
            {payload && payload.confirmedPayables.length > 0 ? (
              <a
                href={`/finance/accounts-payable?search=${encodeURIComponent(apSearch)}`}
                className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
              >
                <ExternalLink className="h-3 w-3" />
                Abrir no Contas a Pagar
              </a>
            ) : null}
            <button
              type="button"
              onClick={handlePrint}
              disabled={!payload}
              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
            >
              <Printer className="h-3 w-3" />
              Imprimir / PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
              data-testid="npo-detail-close"
            >
              <X className="h-3 w-3" />
              Fechar
            </button>
          </div>
        </header>

        <nav className="flex flex-wrap gap-1 border-b border-[#E5E7EB] px-4 py-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              data-testid={`npo-tab-${tab.id}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11px] font-semibold",
                activeTab === tab.id
                  ? "bg-[#1e3a8a] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="npo-detail-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando ficha 360º…
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-rose-700" data-testid="npo-detail-error">
              {error}
            </p>
          ) : null}
          {payload && activeTab === "geral" ? <GeralTab payload={payload} /> : null}
          {payload && activeTab === "itens" ? <ItensTab payload={payload} /> : null}
          {payload && activeTab === "fiscal" ? <FiscalTab payload={payload} /> : null}
          {payload && activeTab === "financeiro" ? <FinanceiroTab payload={payload} /> : null}
          {payload && activeTab === "nomus" ? (
            <NomusTab payload={payload} canSeeRaw={canSeeRaw} />
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function GeralTab({ payload }: { payload: Detail360 }) {
  const { order, supplier, financialSummary, items, fiscal } = payload;
  const header = order.header ?? {};
  return (
    <div className="space-y-5" data-testid="npo-tab-panel-geral">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Pedido" value={order.orderNumber ?? `Nomus #${order.externalId}`} />
        <SummaryCard
          label="Fornecedor"
          value={
            <span>
              {supplier.resolvedName ||
                supplier.nomusName ||
                (supplier.nomusExternalId != null
                  ? `Fornecedor Nomus #${supplier.nomusExternalId}`
                  : "—")}
              {supplier.matched ? (
                <OverlayBadge tone="emerald" className="ml-1">
                  Fornecedor identificado
                </OverlayBadge>
              ) : null}
            </span>
          }
        />
        <SummaryCard label="Emissão" value={formatDate(order.issuedAt)} />
        <SummaryCard
          label="Entrega"
          value={
            <span>
              {formatDate(order.expectedAt)}
              {order.overdue ? (
                <OverlayBadge tone="rose" className="ml-1">
                  Atrasado
                </OverlayBadge>
              ) : null}
            </span>
          }
        />
        <SummaryCard
          label="Stage"
          value={
            <OverlayBadge tone={nomusPurchaseOrderStageTone(order.stage)}>
              {nomusPurchaseOrderStageLabel(order.stage)}
            </OverlayBadge>
          }
        />
        <SummaryCard label="Itens" value={String(items.length)} />
        <SummaryCard
          label="Total das parcelas planejadas"
          value={money(financialSummary.plannedInstallmentsTotal)}
        />
        <SummaryCard
          label="Situação fiscal"
          value={fiscal.invoices.length > 0 ? `${fiscal.invoices.length} NF-e` : "Vínculo não identificado"}
        />
        <SummaryCard
          label="Situação financeira"
          value={
            <OverlayBadge tone={nomusPurchaseOrderFinancialTone(financialSummary.financialStatus)}>
              {nomusPurchaseOrderFinancialLabel(financialSummary.financialStatus)}
            </OverlayBadge>
          }
        />
      </div>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">Identificação</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="ID Nomus" value={display(order.externalId)} />
          <Field label="Código do pedido" value={display(order.orderNumber)} />
          <Field label="Empresa" value={display(header.companyId)} />
          <Field label="Tipo de pedido" value={display(header.purchaseOrderTypeId)} />
          <Field label="Data de emissão" value={formatDate(order.issuedAt)} />
          <Field label="Data de entrega padrão" value={formatDate(order.expectedAt)} />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">Fornecedor</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome resolvido" value={display(supplier.resolvedName)} />
          <Field label="Nome original Nomus" value={display(supplier.nomusName)} />
          <Field label="CNPJ/CPF" value={display(supplier.resolvedDocument ?? supplier.nomusDocument)} />
          <Field label="ID Nomus" value={display(supplier.nomusExternalId)} />
          <Field
            label="Cadastro IndusCost"
            value={supplier.financialSupplierId ? "Vinculado" : "Sem cadastro local"}
          />
          <Field
            label="Vínculo"
            value={
              supplier.matched
                ? supplier.matchMethod === "SUPPLIER_ALIAS"
                  ? "ID Nomus"
                  : supplier.matchMethod === "SUPPLIER_DOCUMENT"
                    ? "Documento"
                    : supplier.matchMethod === "SUPPLIER_AP_IDENTITY"
                      ? "Identidade financeira"
                      : "Nome"
                : supplier.ambiguous
                  ? "Ambíguo"
                  : "Não identificado"
            }
          />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">Comprador e contato</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Comprador" value={display(header.buyerPersonId)} />
          <Field label="Contato" value={display(header.contactId)} />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">Logística</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Modalidade" value={display(header.transportModalityLabel ?? header.transportModality)} />
          <Field label="Transportadora" value={display(header.carrierPersonId)} />
          <Field label="Setor de entrada" value={display(header.entrySectorId)} />
          <Field label="Tipo de movimentação" value={display(header.movementTypeId)} />
          <Field label="Frete" value={money(header.freightAmount as number | null)} />
          <Field label="Seguro" value={money(header.insuranceAmount as number | null)} />
          <Field label="Despesas acessórias" value={money(header.otherExpensesAmount as number | null)} />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">Pagamento</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Condição" value={display(header.paymentConditionText ?? order.paymentTerms)} />
          <Field label="ID condição" value={display(header.paymentConditionId)} />
          <Field label="Forma" value={display(header.paymentMethodId)} />
          <Field label="Número de parcelas" value={display(financialSummary.plannedInstallmentsCount)} />
          <Field label="Total planejado" value={money(financialSummary.plannedInstallmentsTotal)} />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">Observações</h2>
        <dl className="grid gap-3">
          <Field label="Observações" value={display(header.comments ?? order.comments)} />
          <Field label="Informações adicionais ao fisco" value={display(header.additionalFiscalInfo)} />
          <Field label="Informações complementares" value={display(header.complementaryInfo)} />
        </dl>
      </section>
    </div>
  );
}

function ItensTab({ payload }: { payload: Detail360 }) {
  return (
    <div className="overflow-x-auto" data-testid="npo-tab-panel-itens">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-left uppercase text-slate-500">
          <tr>
            <th className="px-2 py-2">Item</th>
            <th className="px-2 py-2">Produto</th>
            <th className="px-2 py-2">Descrição</th>
            <th className="px-2 py-2">UN</th>
            <th className="px-2 py-2">Qtd pedida</th>
            <th className="px-2 py-2">Recebida</th>
            <th className="px-2 py-2">Saldo</th>
            <th className="px-2 py-2">Preço</th>
            <th className="px-2 py-2">Desc.</th>
            <th className="px-2 py-2">Acrésc.</th>
            <th className="px-2 py-2">Entrega</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2">Obs.</th>
          </tr>
        </thead>
        <tbody>
          {payload.items.map((item) => (
            <tr key={item.id} className="border-t border-slate-100">
              <td className="px-2 py-2 font-mono">{item.lineCode ?? "—"}</td>
              <td className="px-2 py-2">
                {item.productCode ?? "—"}
                <div className="text-[10px] text-slate-500">Nomus #{item.productExternalId ?? "—"}</div>
              </td>
              <td className="px-2 py-2">
                {item.description ?? "—"}
                {item.descriptionSource === "produto_induscost" ? (
                  <div className="text-[10px] text-slate-500">Descrição local</div>
                ) : null}
              </td>
              <td className="px-2 py-2">{item.unit ?? (item.unitId != null ? `#${item.unitId}` : "—")}</td>
              <td className="px-2 py-2 tabular-nums">{display(item.orderedQuantity)}</td>
              <td className="px-2 py-2 tabular-nums">{display(item.receivedQuantity)}</td>
              <td className="px-2 py-2 tabular-nums">{display(item.remainingQuantity)}</td>
              <td className="px-2 py-2 tabular-nums">{money(item.unitPrice)}</td>
              <td className="px-2 py-2 tabular-nums">
                {item.discountAmount != null ? money(item.discountAmount) : display(item.discountPercent)}
              </td>
              <td className="px-2 py-2 tabular-nums">
                {item.surchargeAmount != null ? money(item.surchargeAmount) : display(item.surchargePercent)}
              </td>
              <td className="px-2 py-2">{display(item.deliveryDate)}</td>
              <td className="px-2 py-2">
                <OverlayBadge tone="slate">
                  {item.itemStatusLabel ?? (item.itemStatusCode != null ? String(item.itemStatusCode) : "—")}
                </OverlayBadge>
              </td>
              <td className="px-2 py-2">{item.comments ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!payload.receiving.receivingQuantityAvailable ? (
        <p className="mt-3 text-xs text-slate-500">
          Quantidade recebida não foi informada pela API. Status 4 não inventa quantidade recebida.
        </p>
      ) : null}
    </div>
  );
}

function FiscalTab({ payload }: { payload: Detail360 }) {
  const r = payload.receiving;
  return (
    <div className="space-y-4" data-testid="npo-tab-panel-fiscal">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Estágio" value={nomusPurchaseOrderStageLabel(r.stage)} />
        <SummaryCard label="Itens" value={String(r.itemCount)} />
        <SummaryCard label="Aguardando" value={String(r.waitingRelease)} />
        <SummaryCard label="Liberados" value={String(r.released)} />
        <SummaryCard label="Parciais" value={String(r.partial)} />
        <SummaryCard label="Recebidos" value={String(r.received)} />
        <SummaryCard label="Com corte" value={String(r.receivedWithCut)} />
        <SummaryCard label="Cancelados" value={String(r.canceled)} />
        <SummaryCard label="Devolvidos parciais" value={String(r.returnedPartial)} />
        <SummaryCard label="Devolvidos totais" value={String(r.returnedFull)} />
      </div>
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">NF-e vinculadas</h2>
        {payload.fiscal.invoices.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-600">
            {payload.fiscal.unresolvedLabel ??
              "Nenhuma NF-e vinculada foi identificada pelos dados disponíveis."}
          </p>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">ID Nomus</th>
                <th className="px-2 py-2">Número</th>
                <th className="px-2 py-2">Série</th>
                <th className="px-2 py-2">Chave</th>
                <th className="px-2 py-2">Emissão</th>
                <th className="px-2 py-2">CNPJ emitente</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Valor</th>
              </tr>
            </thead>
            <tbody>
              {payload.fiscal.invoices.map((nfe) => (
                <tr key={nfe.externalId} className="border-t border-slate-100">
                  <td className="px-2 py-2">{nfe.externalId}</td>
                  <td className="px-2 py-2">{nfe.number ?? (nfe.foundLocally ? "—" : "ID sem registro local")}</td>
                  <td className="px-2 py-2">{nfe.series ?? "—"}</td>
                  <td className="px-2 py-2 font-mono">{nfe.key ?? "—"}</td>
                  <td className="px-2 py-2">{formatDate(nfe.issuedAt ?? nfe.processedAt)}</td>
                  <td className="px-2 py-2">{nfe.issuerDocument ?? "—"}</td>
                  <td className="px-2 py-2">
                    {nfe.canceled ? "Cancelada" : display(nfe.status)}
                  </td>
                  <td className="px-2 py-2">{money(nfe.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function FinanceiroTab({ payload }: { payload: Detail360 }) {
  const now = Date.now();
  return (
    <div className="space-y-6" data-testid="npo-tab-panel-financeiro">
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">
          Planejado no pedido
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          Parcelas do Pedido de Compra. Não são títulos confirmados de Contas a Pagar.
        </p>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <SummaryCard
            label="Total das parcelas planejadas"
            value={money(payload.financialSummary.plannedInstallmentsTotal)}
          />
          <SummaryCard label="Parcelas" value={String(payload.financialSummary.plannedInstallmentsCount)} />
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-left uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Parcela</th>
              <th className="px-2 py-2">Vencimento</th>
              <th className="px-2 py-2">Valor</th>
              <th className="px-2 py-2">Forma</th>
              <th className="px-2 py-2">Conta</th>
              <th className="px-2 py-2">Adiantamento</th>
              <th className="px-2 py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {payload.plannedInstallments.map((row) => {
              const due = row.dueDate ? new Date(row.dueDate).getTime() : null;
              const temporal =
                due == null ? "—" : due < now ? "Vencida" : "A vencer";
              return (
                <tr key={row.index} className="border-t border-slate-100">
                  <td className="px-2 py-2">{row.index + 1}</td>
                  <td className="px-2 py-2">{formatDate(row.dueDate) !== "—" ? formatDate(row.dueDate) : display(row.dueDateRaw)}</td>
                  <td className="px-2 py-2 tabular-nums">{money(row.amount)}</td>
                  <td className="px-2 py-2">{row.paymentMethodId != null ? `#${row.paymentMethodId}` : "—"}</td>
                  <td className="px-2 py-2">{row.bankAccountId != null ? `#${row.bankAccountId}` : "—"}</td>
                  <td className="px-2 py-2">{row.generatesAdvance == null ? "—" : row.generatesAdvance ? "Sim" : "Não"}</td>
                  <td className="px-2 py-2">{temporal}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">
          Contas a Pagar confirmadas
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          Somente títulos com vínculo determinístico NF-e → sourceInvoiceId.
        </p>
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <SummaryCard label="Total confirmado" value={money(payload.financialSummary.confirmedAmount)} />
          <SummaryCard label="Total pago" value={money(payload.financialSummary.paidAmount)} />
          <SummaryCard label="Saldo" value={money(payload.financialSummary.openAmount)} />
          <SummaryCard label="Títulos" value={String(payload.financialSummary.count)} />
        </div>
        {payload.confirmedPayables.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-600">
            Nenhuma Conta a Pagar confirmada foi identificada pelos dados disponíveis. O mesmo
            fornecedor, sozinho, não gera vínculo.
          </p>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Título</th>
                <th className="px-2 py-2">NF origem</th>
                <th className="px-2 py-2">Vencimento</th>
                <th className="px-2 py-2">Valor</th>
                <th className="px-2 py-2">Pago</th>
                <th className="px-2 py-2">Saldo</th>
                <th className="px-2 py-2">Forma</th>
                <th className="px-2 py-2">Pagamento</th>
                <th className="px-2 py-2">Baixa</th>
              </tr>
            </thead>
            <tbody>
              {payload.confirmedPayables.map((row) => (
                <tr key={row.externalId} className="border-t border-slate-100">
                  <td className="px-2 py-2">{row.externalId}</td>
                  <td className="px-2 py-2">{row.sourceInvoiceNumber ?? "—"}</td>
                  <td className="px-2 py-2">{formatDate(row.dueDate)}</td>
                  <td className="px-2 py-2 tabular-nums">{money(row.amountPayable)}</td>
                  <td className="px-2 py-2 tabular-nums">{money(row.amountPaid)}</td>
                  <td className="px-2 py-2 tabular-nums">{money(row.balancePayable)}</td>
                  <td className="px-2 py-2">
                    {row.paymentMethodName ?? "—"}
                    {row.boletoIsPaymentMethodOnly && !row.hasBoletoDocument ? (
                      <div className="text-[10px] text-slate-500">Forma apenas — sem documento de boleto</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">{formatDate(row.paymentDate)}</td>
                  <td className="px-2 py-2">{formatDate(row.settlementDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function NomusTab({ payload, canSeeRaw }: { payload: Detail360; canSeeRaw: boolean }) {
  return (
    <div className="space-y-4" data-testid="npo-tab-panel-nomus">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Primeira sincronização" value={formatDateTime(payload.syncMetadata.firstSeenAt)} />
        <Field label="Última sincronização" value={formatDateTime(payload.syncMetadata.syncedAt)} />
        <Field label="Última visualização na origem" value={formatDateTime(payload.syncMetadata.lastSeenAt)} />
        <Field label="Criado no Nomus" value={formatDateTime(payload.syncMetadata.createdAtNomus)} />
        <Field label="Modificado no Nomus" value={formatDateTime(payload.syncMetadata.modifiedAtNomus)} />
        <Field label="payloadHash" value={display(payload.syncMetadata.payloadHash)} />
        <Field label="Stage canônico" value={nomusPurchaseOrderStageLabel(payload.order.stage)} />
      </dl>
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">Evidência dos vínculos</h2>
        <ul className="space-y-1 text-sm text-slate-700">
          {payload.relationEvidence.map((row, index) => (
            <li key={`${row.method}-${index}`}>
              {row.detail} <span className="text-xs text-slate-500">({row.method} · {row.confidence})</span>
            </li>
          ))}
        </ul>
      </section>
      {canSeeRaw && payload.rawPayload != null ? (
        <details className="rounded-lg border border-dashed border-slate-200 p-3" data-testid="npo-raw-payload">
          <summary className="cursor-pointer text-sm font-medium">Payload Nomus (permissão settings)</summary>
          <pre className="mt-2 max-h-80 overflow-auto text-xs">{JSON.stringify(payload.rawPayload, null, 2)}</pre>
        </details>
      ) : (
        <p className="text-xs text-slate-500" data-testid="npo-raw-gated">
          O JSON bruto do Nomus fica restrito a quem possui settings.nomus.view / settings.view.
        </p>
      )}
    </div>
  );
}
