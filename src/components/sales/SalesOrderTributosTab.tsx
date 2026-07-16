/**
 * Aba Tributos — detalhe do Pedido de Venda e Auditoria 360º.
 * Camada A (destacados na NF). Nunca exibe “pago”.
 */
import React, { useMemo, useState } from "react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type {
  SalesOrderFiscalNfeDto,
  SalesOrderFiscalTaxesPayload,
} from "@/src/lib/sales-orders/salesOrderFiscalTaxesClient";
import { cn } from "@/src/lib/utils";

type Props = {
  fiscalTaxes: SalesOrderFiscalTaxesPayload | null | undefined;
  loading?: boolean;
  error?: string | null;
  denied?: boolean;
  className?: string;
  /** Exibe bloco técnico expandível (auditoria). */
  showTechnical?: boolean;
};

function money(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatFinanceCurrency(value);
}

function Kpi({
  label,
  value,
  help,
  tone,
}: {
  label: string;
  value: string;
  help?: string;
  tone?: "default" | "highlight" | "muted" | "warn";
}): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-2",
        tone === "highlight" && "border-sky-200 bg-sky-50",
        tone === "warn" && "border-amber-200 bg-amber-50",
        tone === "muted" && "border-[#E5E7EB] bg-[#F9FAFB]",
        (!tone || tone === "default") && "border-[#E5E7EB] bg-white"
      )}
      title={help}
    >
      <p className="text-[9px] font-bold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <p className="mt-0.5 text-[13px] font-semibold text-[#111827]">{value}</p>
    </div>
  );
}

function NfeDetailPanel({
  nfe,
  onClose,
}: {
  nfe: SalesOrderFiscalNfeDto;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      className="rounded-xl border border-sky-200 bg-sky-50/40 p-3"
      data-testid="sales-order-tributos-nfe-detail"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[12px] font-bold text-[#0f172a]">
          NF {nfe.numero ?? "—"}
          {nfe.serie ? ` / Série ${nfe.serie}` : ""}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[#E5E7EB] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#374151]"
        >
          Fechar
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi label="Chave" value={nfe.chave ?? "—"} />
        <Kpi
          label="Emissão"
          value={nfe.emissionDate ? formatFinanceDate(nfe.emissionDate) : "—"}
        />
        <Kpi label="Status" value={nfe.statusLabel} />
        <Kpi label="Produtos" value={money(nfe.productsValue)} />
        <Kpi label="Descontos" value={money(nfe.discountsValue)} />
        <Kpi label="Frete" value={money(nfe.freightValue)} />
        <Kpi label="Seguro" value={money(nfe.insuranceValue)} />
        <Kpi label="Outras despesas" value={money(nfe.otherExpensesValue)} />
        <Kpi label="Tributos (header)" value={money(nfe.taxesTotalHeader)} tone="highlight" />
        <Kpi label="Total NF" value={money(nfe.totalValue)} tone="highlight" />
      </div>
      {nfe.compositionIncomplete ? (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          Composição não totalmente disponível
        </p>
      ) : null}
      {nfe.headerTaxes.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-[#6B7280]">
                <th className="py-1 pr-2 font-semibold">Tributo</th>
                <th className="py-1 pr-2 font-semibold text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {nfe.headerTaxes.map((t) => (
                <tr key={t.taxType} className="border-b border-[#F3F4F6]">
                  <td className="py-1 pr-2">{t.label}</td>
                  <td className="py-1 pr-2 text-right font-semibold">
                    {money(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function SalesOrderTributosTab({
  fiscalTaxes,
  loading,
  error,
  denied,
  className,
  showTechnical = true,
}: Props): JSX.Element {
  const [selectedNfeId, setSelectedNfeId] = useState<number | null>(null);
  const [techOpen, setTechOpen] = useState(false);

  const selectedNfe = useMemo(() => {
    if (selectedNfeId == null || !fiscalTaxes) return null;
    return (
      fiscalTaxes.nfes.find((n) => n.nfeExternalId === selectedNfeId) ??
      fiscalTaxes.cancelledNfes.find((n) => n.nfeExternalId === selectedNfeId) ??
      null
    );
  }, [fiscalTaxes, selectedNfeId]);

  if (loading) {
    return (
      <div
        className={cn("py-10 text-center text-[12px] text-[#6B7280]", className)}
        data-testid="sales-order-tributos-loading"
      >
        Carregando tributos documentais…
      </div>
    );
  }

  if (denied) {
    return (
      <div
        className={cn(
          "rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900",
          className
        )}
        data-testid="sales-order-tributos-denied"
      >
        Você não tem permissão para ver tributos / faturamento deste pedido.
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800",
          className
        )}
        data-testid="sales-order-tributos-error"
      >
        {error}
      </div>
    );
  }

  if (!fiscalTaxes) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-4 py-8 text-center text-[12px] text-[#6B7280]",
          className
        )}
        data-testid="sales-order-tributos-empty"
      >
        Tributos documentais indisponíveis para este pedido.
      </div>
    );
  }

  const { summary, highlightedTaxes, nfes, cancelledNfes, itemTaxLines, technical } =
    fiscalTaxes;
  const hasAnyNfe = nfes.length + cancelledNfes.length > 0;

  if (!hasAnyNfe) {
    return (
      <div className={cn("space-y-3", className)} data-testid="sales-order-tributos-tab">
        <section className="rounded-xl border border-[#E5E7EB] bg-white p-3">
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#1e3a8a]">
            Resumo fiscal do pedido
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi label="Valor ativo do pedido" value={money(summary.orderActiveValue)} />
            <Kpi label="A faturar" value={money(summary.amountToInvoice)} tone="highlight" />
            <Kpi label="NF válidas" value={formatFinanceInteger(0)} />
            <Kpi label="NF canceladas" value={formatFinanceInteger(0)} />
          </div>
        </section>
        <div
          className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-4 py-8 text-center text-[12px] text-[#6B7280]"
          data-testid="sales-order-tributos-no-nfe"
        >
          Nenhuma NF-e vinculada a este pedido. Tributos documentais aparecem após o
          faturamento.
        </div>
        <p className="text-[10px] text-[#6B7280]">
          Fonte: {summary.sourceLabel}
          {summary.lastParsedAt
            ? ` · Última leitura XML: ${formatFinanceDateTime(summary.lastParsedAt)}`
            : ""}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)} data-testid="sales-order-tributos-tab">
      {/* A — Resumo fiscal */}
      <section
        className="rounded-xl border border-[#E5E7EB] bg-white p-3"
        data-testid="sales-order-tributos-summary"
      >
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#1e3a8a]">
          Resumo fiscal do pedido
        </h3>
        <p className="mb-2 text-[11px] text-[#6B7280]">
          Destacados nas NF válidas (XML NF-e). Não inclui impostos pagos nem apuração
          periódica.
        </p>
        {summary.compositionIncomplete ? (
          <p
            className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900"
            data-testid="sales-order-tributos-composition-incomplete"
          >
            {summary.compositionIncompleteReason ??
              "Composição não totalmente disponível"}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Kpi label="Valor ativo do pedido" value={money(summary.orderActiveValue)} />
          <Kpi
            label="Produtos (NF válidas)"
            value={money(summary.productsValue)}
            help="Produtos líquidos (vProd − vDesc) nas NF válidas"
          />
          <Kpi label="Descontos" value={money(summary.discountsValue)} />
          <Kpi label="Frete" value={money(summary.freightValue)} />
          <Kpi label="Seguro" value={money(summary.insuranceValue)} />
          <Kpi label="Outras despesas" value={money(summary.otherExpensesValue)} />
          <Kpi
            label="Total NF válidas"
            value={money(summary.nfeValidTotal)}
            tone="highlight"
          />
          <Kpi
            label="A faturar"
            value={money(summary.amountToInvoice)}
            help="max(0, valor ativo − total NF válidas)"
            tone="highlight"
          />
          <Kpi
            label="Saldo financeiro (CR)"
            value={
              summary.financialBalance == null
                ? "Sem CR gerado"
                : money(summary.financialBalance)
            }
            help="Aberto oficial do Contas a Receber — não é residual fiscal"
            tone="muted"
          />
          <Kpi
            label="NF válidas"
            value={formatFinanceInteger(summary.validNfeCount)}
          />
          <Kpi
            label="NF canceladas"
            value={formatFinanceInteger(summary.cancelledNfeCount)}
            tone={summary.cancelledNfeCount > 0 ? "warn" : "muted"}
          />
        </div>
        <p className="mt-2 text-[10px] text-[#6B7280]">
          Fonte: {summary.sourceLabel}
          {summary.lastParsedAt
            ? ` · Última leitura XML: ${formatFinanceDateTime(summary.lastParsedAt)}`
            : " · Leitura XML ainda não registrada"}
          {summary.parserVersion ? ` · Parser ${summary.parserVersion}` : ""}
        </p>
      </section>

      {/* B — Tributos destacados */}
      <section
        className="rounded-xl border border-[#E5E7EB] bg-white p-3"
        data-testid="sales-order-tributos-highlighted"
      >
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#1e3a8a]">
          Tributos destacados nas NF válidas
        </h3>
        <p className="mb-2 text-[11px] text-[#6B7280]">
          Apenas linhas de cabeçalho (HEADER). Não somar com itens. Não confundir com
          imposto pago.
        </p>
        {highlightedTaxes.length === 0 ? (
          <p className="text-[12px] text-[#6B7280]">
            Nenhum tributo tipado disponível nas NF válidas.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {highlightedTaxes.map((t) => (
              <Kpi
                key={t.taxType}
                label={t.label}
                value={money(t.amount)}
                tone="highlight"
              />
            ))}
          </div>
        )}
      </section>

      {/* C — Notas fiscais */}
      <section
        className="rounded-xl border border-[#E5E7EB] bg-white p-3"
        data-testid="sales-order-tributos-nfes"
      >
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#1e3a8a]">
          Notas fiscais
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-[#6B7280]">
                <th className="py-1.5 pr-2 font-semibold">Número</th>
                <th className="py-1.5 pr-2 font-semibold">Série</th>
                <th className="py-1.5 pr-2 font-semibold">Emissão</th>
                <th className="py-1.5 pr-2 font-semibold">Status</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Produtos</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Desc.</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Frete</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Despesas</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Tributos</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Total NF</th>
                <th className="py-1.5 pr-2 font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody>
              {nfes.map((n) => (
                <tr
                  key={n.nfeExternalId}
                  className="border-b border-[#F3F4F6]"
                  data-testid={`sales-order-tributos-nfe-row-${n.nfeExternalId}`}
                >
                  <td className="py-1.5 pr-2 font-semibold">{n.numero ?? "—"}</td>
                  <td className="py-1.5 pr-2">{n.serie ?? "—"}</td>
                  <td className="py-1.5 pr-2">
                    {n.emissionDate ? formatFinanceDate(n.emissionDate) : "—"}
                  </td>
                  <td className="py-1.5 pr-2">{n.statusLabel}</td>
                  <td className="py-1.5 pr-2 text-right">{money(n.productsValue)}</td>
                  <td className="py-1.5 pr-2 text-right">{money(n.discountsValue)}</td>
                  <td className="py-1.5 pr-2 text-right">{money(n.freightValue)}</td>
                  <td className="py-1.5 pr-2 text-right">
                    {money(n.otherExpensesValue)}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    {money(n.taxesTotalHeader)}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-semibold">
                    {money(n.totalValue)}
                  </td>
                  <td className="py-1.5 pr-2">
                    <button
                      type="button"
                      className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900"
                      onClick={() => setSelectedNfeId(n.nfeExternalId)}
                    >
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {cancelledNfes.length > 0 ? (
          <div className="mt-3" data-testid="sales-order-tributos-cancelled">
            <p className="mb-1 text-[11px] font-semibold text-rose-800">
              NF canceladas (fora dos totalizadores válidos)
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-rose-100 text-[#6B7280]">
                    <th className="py-1 pr-2 font-semibold">Número</th>
                    <th className="py-1 pr-2 font-semibold">Status</th>
                    <th className="py-1 pr-2 font-semibold text-right">Total</th>
                    <th className="py-1 pr-2 font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {cancelledNfes.map((n) => (
                    <tr key={n.nfeExternalId} className="border-b border-rose-50">
                      <td className="py-1 pr-2">{n.numero ?? "—"}</td>
                      <td className="py-1 pr-2">{n.statusLabel}</td>
                      <td className="py-1 pr-2 text-right">{money(n.totalValue)}</td>
                      <td className="py-1 pr-2">
                        <button
                          type="button"
                          className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-900"
                          onClick={() => setSelectedNfeId(n.nfeExternalId)}
                        >
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {selectedNfe ? (
          <div className="mt-3">
            <NfeDetailPanel
              nfe={selectedNfe}
              onClose={() => setSelectedNfeId(null)}
            />
          </div>
        ) : null}
      </section>

      {/* D — Itens e tributação */}
      <section
        className="rounded-xl border border-[#E5E7EB] bg-white p-3"
        data-testid="sales-order-tributos-items"
      >
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#1e3a8a]">
          Itens e tributação
        </h3>
        <p className="mb-2 text-[11px] text-[#6B7280]">
          Linhas ITEM do XML. Valores aqui não entram de novo no resumo de destacados
          (HEADER).
        </p>
        {itemTaxLines.length === 0 ? (
          <p className="text-[12px] text-[#6B7280]">
            Sem linhas de tributo por item disponíveis.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-[#6B7280]">
                  <th className="py-1.5 pr-2 font-semibold">NF</th>
                  <th className="py-1.5 pr-2 font-semibold">Item</th>
                  <th className="py-1.5 pr-2 font-semibold">Produto</th>
                  <th className="py-1.5 pr-2 font-semibold">Código</th>
                  <th className="py-1.5 pr-2 font-semibold">NCM</th>
                  <th className="py-1.5 pr-2 font-semibold">CFOP</th>
                  <th className="py-1.5 pr-2 font-semibold">CST/CSOSN</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Qtd</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Valor</th>
                  <th className="py-1.5 pr-2 font-semibold">Tributo</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Base</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Alíq.</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Valor trib.</th>
                </tr>
              </thead>
              <tbody>
                {itemTaxLines.map((line) => (
                  <tr key={line.lineKey} className="border-b border-[#F3F4F6]">
                    <td className="py-1 pr-2">{line.nfeNumero ?? "—"}</td>
                    <td className="py-1 pr-2">{line.itemNumber ?? "—"}</td>
                    <td className="py-1 pr-2 max-w-[140px] truncate">
                      {line.productName ?? "—"}
                    </td>
                    <td className="py-1 pr-2">{line.productSku ?? "—"}</td>
                    <td className="py-1 pr-2">{line.ncm ?? "—"}</td>
                    <td className="py-1 pr-2">{line.cfop ?? "—"}</td>
                    <td className="py-1 pr-2">
                      {line.cst ?? line.csosn ?? "—"}
                    </td>
                    <td className="py-1 pr-2 text-right">
                      {line.quantity != null
                        ? line.quantity.toLocaleString("pt-BR", {
                            maximumFractionDigits: 4,
                          })
                        : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right">{money(line.itemValue)}</td>
                    <td className="py-1 pr-2">{line.label}</td>
                    <td className="py-1 pr-2 text-right">{money(line.baseAmount)}</td>
                    <td className="py-1 pr-2 text-right">
                      {line.rate != null
                        ? `${line.rate.toLocaleString("pt-BR", {
                            maximumFractionDigits: 4,
                          })}%`
                        : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right font-semibold">
                      {money(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showTechnical ? (
        <section
          className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3"
          data-testid="sales-order-tributos-technical"
        >
          <button
            type="button"
            className="text-[11px] font-bold uppercase tracking-wide text-[#4B5563]"
            onClick={() => setTechOpen((v) => !v)}
          >
            {techOpen ? "▾" : "▸"} Auditoria técnica (tributos)
          </button>
          {techOpen ? (
            <div className="mt-2 space-y-1 text-[11px] text-[#4B5563]">
              <p>{technical.source}</p>
              <p>{technical.note}</p>
              <p>Não somar HEADER e ITEM: {String(technical.doNotSumHeaderAndItem)}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
