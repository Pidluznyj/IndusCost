import React, { useEffect, useState } from "react";
import {
  X,
  Loader2,
  User,
  Calendar,
  FileText,
  Truck,
  Package,
  Building2,
  Percent,
  DollarSign,
  TrendingUp,
  Wallet,
  Receipt,
  Edit2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type { Proposal, ProposalItem, ProposalStatus } from "@/src/types/commercial";

const STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ANALYSIS: "Em Análise",
  SENT: "Enviada",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  EXPIRED: "Expirada",
  CANCELED: "Cancelada",
};

function safeNum(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

type Props = {
  open: boolean;
  proposalId: string | null;
  onClose: () => void;
  /** Abre o fluxo de edição já existente (mesma proposta). */
  onEdit?: (id: string) => void;
};

export function ProposalAnalysisModal({ open, proposalId, onClose, onEdit }: Props) {
  const [data, setData] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !proposalId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJsonOk<Proposal & { items?: ProposalItem[] }>(`/api/proposals/${proposalId}`)
      .then((res) => {
        if (!cancelled) setData(res as Proposal);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, proposalId]);

  const items = data?.items ?? [];

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.2 }}
            className="bg-card w-full max-w-5xl max-h-[92vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-analysis-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border bg-accent/40 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 flex items-start gap-3">
                <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center text-primary shrink-0">
                  <FileText className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h2 id="proposal-analysis-title" className="text-lg font-bold leading-tight">
                    Análise da proposta
                  </h2>
                  {data && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      <span className="font-mono font-semibold text-primary">#{data.number}</span>
                      {data.title ? (
                        <span className="text-foreground/90"> · {data.title}</span>
                      ) : null}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {proposalId && onEdit && data && (
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(proposalId);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
                  >
                    <Edit2 className="h-4 w-4" />
                    Editar
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-accent transition-colors"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {loading && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm">Carregando dados da proposta…</p>
                </div>
              )}

              {error && !loading && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  {error}
                </div>
              )}

              {!loading && !error && data && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide",
                        data.status === "APPROVED"
                          ? "bg-green-500/15 text-green-700 dark:text-green-400"
                          : data.status === "REJECTED" || data.status === "CANCELED"
                            ? "bg-red-500/10 text-red-700 dark:text-red-400"
                            : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                      )}
                    >
                      {STATUS_LABEL[data.status] ?? data.status}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Criada em {new Date(data.createdAt).toLocaleString("pt-BR")}
                    </span>
                    {data.updatedAt && data.updatedAt !== data.createdAt && (
                      <span className="text-xs text-muted-foreground">
                        · Atualizada {new Date(data.updatedAt).toLocaleString("pt-BR")}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    <KpiCard
                      icon={Wallet}
                      label="Valor líquido"
                      value={formatCurrency(safeNum(data.totalNetValue))}
                      tone="primary"
                    />
                    <KpiCard
                      icon={DollarSign}
                      label="Custo total"
                      value={formatCurrency(safeNum(data.totalCost))}
                    />
                    <KpiCard
                      icon={TrendingUp}
                      label="Margem"
                      value={formatCurrency(safeNum(data.totalMarginValue))}
                      sub={`${formatNumber(safeNum(data.totalMarginPerc), 2)}% sobre líquido`}
                      tone={
                        safeNum(data.totalMarginPerc) >= 20
                          ? "green"
                          : safeNum(data.totalMarginPerc) >= 10
                            ? "amber"
                            : "red"
                      }
                    />
                    <KpiCard
                      icon={Receipt}
                      label="Descontos"
                      value={formatCurrency(safeNum(data.totalDiscount))}
                    />
                    <KpiCard
                      icon={Percent}
                      label="Impostos"
                      value={formatCurrency(safeNum(data.totalTaxes))}
                    />
                    <KpiCard
                      icon={Building2}
                      label="Comissão"
                      value={formatCurrency(safeNum(data.totalCommission))}
                    />
                    <KpiCard
                      icon={Truck}
                      label="Frete"
                      value={formatCurrency(safeNum(data.totalFreight))}
                    />
                    <KpiCard
                      icon={Package}
                      label="Itens"
                      value={String(items.length)}
                      sub={`Bruto ${formatCurrency(safeNum(data.totalGrossValue))}`}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-border bg-accent/20 p-4 space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <User className="h-4 w-4" /> Cliente
                      </h3>
                      <p className="font-semibold text-sm">{data.Customer?.companyName ?? "—"}</p>
                      {data.Customer?.tradeName && (
                        <p className="text-xs text-muted-foreground">{data.Customer.tradeName}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground font-mono">{data.Customer?.taxId}</p>
                      {data.Customer?.city && (
                        <p className="text-xs text-muted-foreground">
                          {data.Customer.city}
                          {data.Customer.state ? ` / ${data.Customer.state}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border border-border bg-accent/20 p-4 space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Truck className="h-4 w-4" /> Condições
                      </h3>
                      <dl className="grid grid-cols-1 gap-2 text-xs">
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Responsável</dt>
                          <dd className="font-medium text-right">{data.responsible || "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Validade</dt>
                          <dd className="font-medium text-right">{data.validityDays ?? "—"} dias</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Pagamento</dt>
                          <dd className="font-medium text-right max-w-[60%]">{data.paymentTerms || "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Método</dt>
                          <dd className="font-medium text-right">{data.paymentMethod || "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Frete</dt>
                          <dd className="font-medium text-right">{data.freightCondition || "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Prazo entrega</dt>
                          <dd className="font-medium text-right">{data.deliveryTimeDays ?? "—"} dias</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Local</dt>
                          <dd className="font-medium text-right max-w-[60%]">{data.deliveryLocation || "—"}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  {data.notes && String(data.notes).trim() !== "" && (
                    <div className="rounded-xl border border-border p-4 bg-card">
                      <h3 className="text-xs font-bold uppercase text-muted-foreground mb-2">Observações</h3>
                      <p className="text-sm whitespace-pre-wrap text-foreground/90">{data.notes}</p>
                    </div>
                  )}
                  {data.internalNotes && String(data.internalNotes).trim() !== "" && (
                    <div className="rounded-xl border border-dashed border-amber-500/40 p-4 bg-amber-500/5">
                      <h3 className="text-xs font-bold uppercase text-amber-800 dark:text-amber-200 mb-2">
                        Notas internas
                      </h3>
                      <p className="text-sm whitespace-pre-wrap text-foreground/90">{data.internalNotes}</p>
                    </div>
                  )}

                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-3 bg-accent/40 border-b border-border">
                      <h3 className="text-sm font-bold flex items-center gap-2">
                        <Package className="h-4 w-4" /> Itens ({items.length})
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-accent/30 border-b border-border">
                            <th className="p-2.5 font-semibold">Produto</th>
                            <th className="p-2.5 font-semibold text-right">Qtd</th>
                            <th className="p-2.5 font-semibold text-right">Custo un.</th>
                            <th className="p-2.5 font-semibold text-right">Negociado</th>
                            <th className="p-2.5 font-semibold text-right">Desc.</th>
                            <th className="p-2.5 font-semibold text-right">Margem %</th>
                            <th className="p-2.5 font-semibold text-right">Líquido linha</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {items.map((row, idx) => {
                            const qty = safeNum(row.quantity);
                            const neg = safeNum(row.negotiatedPrice);
                            const disc = safeNum(row.discountValue);
                            const netLine = qty * neg - disc;
                            return (
                              <tr key={row.id ?? idx} className="hover:bg-accent/20">
                                <td className="p-2.5">
                                  <p className="font-medium text-foreground">
                                    {row.Product?.name ?? "—"}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground font-mono">
                                    {row.Product?.sku ?? row.productId}
                                  </p>
                                </td>
                                <td className="p-2.5 text-right tabular-nums">{formatNumber(qty, 4)}</td>
                                <td className="p-2.5 text-right tabular-nums">
                                  {formatCurrency(safeNum(row.unitCost))}
                                </td>
                                <td className="p-2.5 text-right tabular-nums">
                                  {formatCurrency(neg)}
                                </td>
                                <td className="p-2.5 text-right tabular-nums">
                                  {formatCurrency(disc)}
                                </td>
                                <td className="p-2.5 text-right tabular-nums font-medium">
                                  {formatNumber(safeNum(row.marginPerc), 2)}%
                                </td>
                                <td className="p-2.5 text-right font-semibold tabular-nums">
                                  {formatCurrency(netLine)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "primary" | "green" | "amber" | "red";
}) {
  const ring =
    tone === "primary"
      ? "border-primary/30 bg-primary/5"
      : tone === "green"
        ? "border-green-500/25 bg-green-500/5"
        : tone === "amber"
          ? "border-amber-500/25 bg-amber-500/5"
          : tone === "red"
            ? "border-red-500/25 bg-red-500/5"
            : "border-border bg-card";

  return (
    <div className={cn("rounded-xl border p-3 flex flex-col gap-1 min-h-[88px]", ring)}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
        {label}
      </div>
      <p className="text-base font-black tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>}
    </div>
  );
}
