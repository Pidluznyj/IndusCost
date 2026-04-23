import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { Proposal, ProposalItem } from "@/src/types/commercial";

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatCurrency(value: unknown): string {
  const n = safeNum(value, 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("pt-BR");
}

export const ProposalPrintView = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<(Proposal & { items?: ProposalItem[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Proposta inválida.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchJsonOk<Proposal & { items?: ProposalItem[] }>(`/api/proposals/${id}`)
      .then((data) => {
        if (!data) {
          setError("Proposta não encontrada.");
          setProposal(null);
          return;
        }
        setProposal(data);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Não foi possível carregar a proposta.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const issueDate = useMemo(() => formatDate(proposal?.createdAt), [proposal?.createdAt]);
  const items = useMemo(() => proposal?.items ?? [], [proposal?.items]);

  return (
    <div className="proposal-print-page min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="proposal-print-no-print mx-auto mb-4 flex max-w-5xl items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/proposals")}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
        >
          <Printer className="h-4 w-4" />
          Imprimir / PDF
        </button>
      </div>

      <article className="proposal-print-sheet mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {loading ? (
          <div className="py-24 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Carregando proposta…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : !proposal ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Proposta não localizada.
          </div>
        ) : (
          <div className="space-y-8">
            <header className="proposal-print-break border-b border-slate-200 pb-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">IndusCost</p>
                  <h1 className="mt-2 text-2xl font-bold text-slate-900">Proposta Comercial</h1>
                  <p className="mt-1 text-sm text-slate-600">{proposal.title?.trim() || "Sem título informado"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <p className="font-semibold text-slate-700">Proposta #{proposal.number}</p>
                  <p className="text-slate-600">Data de emissão: {issueDate}</p>
                  <p className="text-slate-600">
                    Status: <span className="font-medium">{proposal.status}</span>
                  </p>
                </div>
              </div>
            </header>

            <section className="proposal-print-break grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cliente</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {proposal.Customer?.companyName || proposal.Customer?.tradeName || "Cliente não informado"}
                </p>
                {proposal.Customer?.taxId ? <p className="text-sm text-slate-600">CPF/CNPJ: {proposal.Customer.taxId}</p> : null}
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Condições comerciais</p>
                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  {proposal.validityDays ? <p>Validade: {proposal.validityDays} dia(s)</p> : null}
                  {proposal.paymentTerms ? <p>Pagamento: {proposal.paymentTerms}</p> : null}
                  {proposal.paymentMethod ? <p>Método: {proposal.paymentMethod}</p> : null}
                  {proposal.deliveryTimeDays ? <p>Prazo de entrega: {proposal.deliveryTimeDays} dia(s)</p> : null}
                  {proposal.freightCondition ? <p>Frete: {proposal.freightCondition}</p> : null}
                  {proposal.deliveryLocation ? <p>Local de entrega: {proposal.deliveryLocation}</p> : null}
                </div>
              </div>
            </section>

            <section className="proposal-print-break overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-700">
                    <th className="px-4 py-3 font-semibold">Item</th>
                    <th className="px-4 py-3 font-semibold">Produto</th>
                    <th className="px-4 py-3 font-semibold text-right">Quantidade</th>
                    <th className="px-4 py-3 font-semibold text-right">Preço unitário</th>
                    <th className="px-4 py-3 font-semibold text-right">Total linha</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                        Nenhum item informado nesta proposta.
                      </td>
                    </tr>
                  ) : (
                    items.map((item, idx) => {
                      const qty = safeNum(item.quantity);
                      const unit = safeNum(item.negotiatedPrice);
                      return (
                        <tr key={item.id ?? `${idx}-${item.productId}`} className="border-t border-slate-100">
                          <td className="px-4 py-3 text-slate-600">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{item.Product?.name || "Produto"}</p>
                            <p className="text-xs text-slate-500">{item.Product?.sku || "SKU não informado"}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-700">{qty.toLocaleString("pt-BR")}</td>
                          <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(unit)}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                            {formatCurrency(qty * unit)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </section>

            <section className="proposal-print-break grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Observações</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {proposal.notes?.trim() ? proposal.notes : "Sem observações registradas."}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Totais</p>
                <div className="mt-2 space-y-2 text-sm">
                  <div className="flex items-center justify-between text-slate-700">
                    <span>Valor bruto</span>
                    <span className="font-mono">{formatCurrency(proposal.totalGrossValue)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-700">
                    <span>Descontos</span>
                    <span className="font-mono">-{formatCurrency(proposal.totalDiscount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-base font-bold text-slate-900">
                    <span>Total líquido</span>
                    <span className="font-mono">{formatCurrency(proposal.totalNetValue)}</span>
                  </div>
                </div>
              </div>
            </section>

            <footer className="border-t border-slate-200 pt-6 text-xs text-slate-500">
              <p>
                Documento gerado pelo IndusCost em {new Date().toLocaleString("pt-BR")}. Esta proposta é destinada ao
                processo comercial e pode ser salva em PDF pelo navegador.
              </p>
            </footer>
          </div>
        )}
      </article>
    </div>
  );
};

