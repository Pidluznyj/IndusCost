/**
 * Gerenciar convites de uma pesquisa.
 *
 * O botão "Copiar link" ROTACIONA o token: como o banco guarda apenas o hash,
 * o texto em claro não pode ser relido. A UI avisa isso explicitamente para o
 * operador não achar que copiou o mesmo link de antes.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Link2, RotateCw } from "lucide-react";
import {
  formatDate,
  INVITATION_STATUS_LABELS,
  satisfactionApi,
  type SatisfactionInvitationRow,
} from "./satisfactionApi.js";

const STATUS_BADGE: Record<SatisfactionInvitationRow["status"], string> = {
  NOT_OPENED: "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]",
  OPENED: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]",
  STARTED: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
  COMPLETED: "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]",
  REVOKED: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]",
};

export function SatisfactionInvitationsPage() {
  const { campaignId = "" } = useParams();
  const [rows, setRows] = useState<SatisfactionInvitationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await satisfactionApi.listInvitations(campaignId, {
        page,
        pageSize,
        status: statusFilter || null,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os convites.");
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyLink = async (invitation: SatisfactionInvitationRow) => {
    if (
      invitation.hasActiveLink &&
      !window.confirm(
        "Este convite já tem um link ativo.\n\nGerar um novo link INVALIDA o anterior — quem tiver o link antigo não conseguirá mais responder.\n\nDeseja continuar?"
      )
    ) {
      return;
    }
    setBusyId(invitation.id);
    setError(null);
    try {
      const link = await satisfactionApi.issueLink(invitation.id);
      await navigator.clipboard?.writeText(link.url);
      setNotice(
        link.rotated
          ? `Novo link de ${invitation.customerName} copiado. O anterior foi invalidado.`
          : `Link de ${invitation.customerName} copiado.`
      );
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o link.");
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (invitation: SatisfactionInvitationRow) => {
    if (!window.confirm(`Revogar o convite de ${invitation.customerName}? O link deixa de funcionar imediatamente.`)) {
      return;
    }
    setBusyId(invitation.id);
    try {
      await satisfactionApi.revokeInvitation(invitation.id);
      setNotice(`Convite de ${invitation.customerName} revogado.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível revogar.");
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <Link
        to="/commercial/satisfaction"
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#1D4ED8] hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para Satisfação
      </Link>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#E2E8F0] bg-white p-4">
        <label className="flex flex-col text-[12px] font-semibold text-[#475569]">
          Situação
          <select
            className="mt-1 rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px] font-normal"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(INVITATION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="ml-auto text-[13px] text-[#64748B]">{total} convite(s)</p>
      </div>

      {notice ? (
        <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-[14px] text-[#065F46]" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] text-[#B91C1C]" role="alert">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-[13px]">
            <thead className="bg-[#F8FAFC] text-[12px] uppercase tracking-wide text-[#64748B]">
              <tr>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Responsável comercial</th>
                <th className="px-4 py-3 font-semibold">Situação</th>
                <th className="px-4 py-3 font-semibold">Aberto em</th>
                <th className="px-4 py-3 font-semibold">Iniciado em</th>
                <th className="px-4 py-3 font-semibold">Respondido em</th>
                <th className="px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-3">
                      <div className="h-5 animate-pulse rounded bg-[#F1F5F9]" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[14px] text-[#64748B]">
                    Nenhum convite nesta pesquisa. Defina a audiência enquanto ela é rascunho.
                  </td>
                </tr>
              ) : (
                rows.map((invitation) => (
                  <tr key={invitation.id} className="hover:bg-[#F8FAFC]">
                    <td className="px-4 py-3 font-medium text-[#0F172A]">
                      {invitation.customerName}
                      {invitation.linkPrefix ? (
                        <span className="ml-2 rounded bg-[#F1F5F9] px-1.5 py-0.5 font-mono text-[11px] text-[#64748B]">
                          {invitation.linkPrefix}…
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[#475569]">
                      {invitation.responsibleCommercialName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[12px] font-semibold ${STATUS_BADGE[invitation.status]}`}
                      >
                        {INVITATION_STATUS_LABELS[invitation.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#475569]">{formatDate(invitation.firstOpenedAt)}</td>
                    <td className="px-4 py-3 text-[#475569]">{formatDate(invitation.startedAt)}</td>
                    <td className="px-4 py-3 text-[#475569]">{formatDate(invitation.completedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-3 text-[12px] font-semibold">
                        {invitation.status !== "REVOKED" && invitation.status !== "COMPLETED" ? (
                          <button
                            type="button"
                            disabled={busyId === invitation.id}
                            className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline disabled:opacity-50"
                            onClick={() => void copyLink(invitation)}
                          >
                            {invitation.hasActiveLink ? (
                              <RotateCw className="h-3.5 w-3.5" />
                            ) : (
                              <Link2 className="h-3.5 w-3.5" />
                            )}
                            {invitation.hasActiveLink ? "Regenerar link" : "Gerar link"}
                          </button>
                        ) : null}
                        {invitation.responseId ? (
                          <Link
                            className="text-[#1D4ED8] hover:underline"
                            to={`/commercial/satisfaction/responses/${invitation.responseId}`}
                          >
                            Ver resposta
                          </Link>
                        ) : null}
                        {invitation.status !== "REVOKED" ? (
                          <button
                            type="button"
                            disabled={busyId === invitation.id}
                            className="inline-flex items-center gap-1 text-[#B91C1C] hover:underline disabled:opacity-50"
                            onClick={() => void revoke(invitation)}
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Revogar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > pageSize ? (
          <div className="flex items-center justify-between border-t border-[#E2E8F0] px-4 py-3 text-[13px]">
            <span className="text-[#64748B]">
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-[#CBD5E1] px-3 py-1 font-semibold text-[#334155] disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                className="rounded-md border border-[#CBD5E1] px-3 py-1 font-semibold text-[#334155] disabled:opacity-40"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
