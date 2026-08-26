/**
 * Satisfação — aba "Pesquisas".
 *
 * Grid paginado + assistente de nova pesquisa. As ações oferecidas em cada
 * linha derivam do estado da campanha (`campaignActions`): a UI nunca mostra
 * um botão que o backend recusaria.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Link2, Plus, Search, Trash2 } from "lucide-react";
import {
  campaignActions,
  CAMPAIGN_STATUS_LABELS,
  formatDate,
  formatPercent,
  formatRating,
  satisfactionApi,
  type SatisfactionCampaignRow,
  type SatisfactionCampaignStatus,
} from "./satisfactionApi.js";
import { NewSurveyWizard } from "./NewSurveyWizard.js";
import {
  SatisfactionLinkDialog,
  type SatisfactionLinkDialogData,
} from "./SatisfactionLinkDialog.js";

const STATUS_BADGE: Record<SatisfactionCampaignStatus, string> = {
  DRAFT: "border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]",
  SCHEDULED: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
  OPEN: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]",
  CLOSED: "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]",
  ARCHIVED: "border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]",
};

type Props = {
  campaigns: SatisfactionCampaignRow[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  onSearch: (search: string, status: string) => void;
  onRefresh: () => void;
  canManage: boolean;
  canPublish: boolean;
  /** Exclusão lógica é EXCLUSIVA do Super administrador — nunca por permissão comum. */
  isSuperAdmin: boolean;
};

export function SatisfactionSurveysPanel(props: Props) {
  const [draftSearch, setDraftSearch] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<SatisfactionLinkDialogData | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Confirmação forte da exclusão: o usuário precisa DIGITAR o código da
  // pesquisa — um window.confirm seria fraco demais para uma ação que
  // derruba links públicos na hora.
  const [deleteTarget, setDeleteTarget] = useState<SatisfactionCampaignRow | null>(null);
  const [deleteCode, setDeleteCode] = useState("");

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 6000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>, successMessage: string) => {
      setBusyId(id);
      setActionError(null);
      try {
        await action();
        setFeedback(successMessage);
        props.onRefresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Não foi possível concluir a ação.");
      } finally {
        setBusyId(null);
      }
    },
    [props]
  );

  const openGeneralLink = useCallback(
    async (campaign: SatisfactionCampaignRow) => {
      setBusyId(campaign.id);
      setActionError(null);
      try {
        const link = await satisfactionApi.issueGeneralLink(campaign.id);
        // Dialogo com link visivel + QR: copiar direto falhava em silencio
        // quando navigator.clipboard nao existe (HTTP na LAN).
        setLinkDialog({
          url: link.url,
          tokenPrefix: link.tokenPrefix,
          rotated: link.rotated,
          title: "Link geral · " + campaign.name,
        });
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Não foi possível gerar o link geral."
        );
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#E2E8F0] bg-white p-4">
        <label className="flex flex-col text-[12px] font-semibold text-[#475569]">
          Buscar
          <input
            className="mt-1 min-w-[220px] rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px] font-normal"
            placeholder="Nome ou código"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onSearch(draftSearch, draftStatus);
            }}
          />
        </label>
        <label className="flex flex-col text-[12px] font-semibold text-[#475569]">
          Situação
          <select
            className="mt-1 rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px] font-normal"
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value)}
          >
            <option value="">Todas</option>
            {Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-[#CBD5E1] px-4 py-2 text-[14px] font-semibold text-[#334155] hover:bg-[#F8FAFC]"
          onClick={() => props.onSearch(draftSearch, draftStatus)}
        >
          <Search className="h-4 w-4" />
          Pesquisar
        </button>

        {props.canManage ? (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-2 rounded-md bg-[#1D4ED8] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#1E40AF]"
            onClick={() => setWizardOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Nova pesquisa
          </button>
        ) : null}
      </div>

      {feedback ? (
        <div
          className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-[14px] text-[#065F46]"
          role="status"
        >
          {feedback}
        </div>
      ) : null}
      {actionError || props.error ? (
        <div
          className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] text-[#B91C1C]"
          role="alert"
        >
          {actionError ?? props.error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-[13px]">
            <thead className="bg-[#F8FAFC] text-[12px] uppercase tracking-wide text-[#64748B]">
              <tr>
                <th className="px-4 py-3 font-semibold">Pesquisa</th>
                <th className="px-4 py-3 font-semibold">Período</th>
                <th className="px-4 py-3 font-semibold">Situação</th>
                <th className="px-4 py-3 text-right font-semibold">Convidados</th>
                <th className="px-4 py-3 text-right font-semibold">Respostas</th>
                <th className="px-4 py-3 text-right font-semibold">Taxa</th>
                <th className="px-4 py-3 text-right font-semibold">Média</th>
                <th className="px-4 py-3 text-right font-semibold">Positivas</th>
                <th className="px-4 py-3 text-right font-semibold">Críticas</th>
                <th className="px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {props.loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={10} className="px-4 py-3">
                      <div className="h-5 animate-pulse rounded bg-[#F1F5F9]" />
                    </td>
                  </tr>
                ))
              ) : props.campaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <p className="text-[15px] font-semibold text-[#0F172A]">
                      Nenhuma pesquisa cadastrada
                    </p>
                    <p className="mt-1 text-[13px] text-[#64748B]">
                      Crie a primeira pesquisa para começar a medir a satisfação dos clientes.
                    </p>
                  </td>
                </tr>
              ) : (
                props.campaigns.map((campaign) => {
                  const actions = campaignActions(campaign.status);
                  const busy = busyId === campaign.id;
                  return (
                    <tr key={campaign.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#0F172A]">{campaign.name}</p>
                        <p className="text-[12px] text-[#94A3B8]">{campaign.code}</p>
                      </td>
                      <td className="px-4 py-3 text-[#475569]">
                        {formatDate(campaign.referenceStart)} — {formatDate(campaign.referenceEnd)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[12px] font-semibold ${STATUS_BADGE[campaign.status]}`}
                        >
                          {CAMPAIGN_STATUS_LABELS[campaign.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[#0F172A]">
                        {campaign.invitedCount}
                      </td>
                      <td className="px-4 py-3 text-right text-[#0F172A]">
                        {campaign.responseCount}
                      </td>
                      <td className="px-4 py-3 text-right text-[#475569]">
                        {formatPercent(campaign.responseRate)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0F172A]">
                        {formatRating(campaign.averageRating)}
                      </td>
                      <td className="px-4 py-3 text-right text-[#047857]">
                        {campaign.positiveCount}
                      </td>
                      <td className="px-4 py-3 text-right text-[#B91C1C]">
                        {campaign.criticalCount}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold">
                          {actions.canSeeResults ? (
                            <Link
                              className="text-[#1D4ED8] hover:underline"
                              to={`/commercial/satisfaction/surveys/${campaign.id}/results`}
                            >
                              Ver resultados
                            </Link>
                          ) : null}
                          {actions.canManageInvites ? (
                            <Link
                              className="text-[#1D4ED8] hover:underline"
                              to={`/commercial/satisfaction/surveys/${campaign.id}/invitations`}
                            >
                              Convites
                            </Link>
                          ) : null}
                          {actions.canPublish && props.canPublish ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="text-[#047857] hover:underline disabled:opacity-50"
                              onClick={() =>
                                runAction(
                                  campaign.id,
                                  () => satisfactionApi.publish(campaign.id),
                                  "Pesquisa publicada. O questionário está congelado."
                                )
                              }
                            >
                              Publicar
                            </button>
                          ) : null}
                          {actions.canClose && props.canPublish ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="text-[#B45309] hover:underline disabled:opacity-50"
                              onClick={() => {
                                if (!window.confirm(`Encerrar "${campaign.name}"? Novas respostas deixarão de ser aceitas.`)) return;
                                void runAction(
                                  campaign.id,
                                  () => satisfactionApi.close(campaign.id),
                                  "Pesquisa encerrada."
                                );
                              }}
                            >
                              Encerrar
                            </button>
                          ) : null}
                          {actions.canArchive && props.canPublish ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="text-[#64748B] hover:underline disabled:opacity-50"
                              onClick={() =>
                                runAction(
                                  campaign.id,
                                  () => satisfactionApi.archive(campaign.id),
                                  "Pesquisa arquivada."
                                )
                              }
                            >
                              Arquivar
                            </button>
                          ) : null}
                          {props.canManage ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-[#475569] hover:underline disabled:opacity-50"
                              onClick={() =>
                                runAction(
                                  campaign.id,
                                  () => satisfactionApi.duplicate(campaign.id),
                                  "Pesquisa duplicada como rascunho."
                                )
                              }
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Duplicar
                            </button>
                          ) : null}
                          {campaign.status === "OPEN" && props.canManage ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-[#475569] hover:underline disabled:opacity-50"
                              onClick={() => void openGeneralLink(campaign)}
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              Link geral
                            </button>
                          ) : null}
                          {props.isSuperAdmin ? (
                            <button
                              type="button"
                              disabled={busy}
                              data-testid="satisfaction-campaign-delete"
                              className="inline-flex items-center gap-1 text-[#B91C1C] hover:underline disabled:opacity-50"
                              onClick={() => {
                                setDeleteCode("");
                                setDeleteTarget(campaign);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Excluir
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {props.total > props.pageSize ? (
          <div className="flex items-center justify-between border-t border-[#E2E8F0] px-4 py-3 text-[13px]">
            <span className="text-[#64748B]">
              {props.total} pesquisas — página {props.page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-[#CBD5E1] px-3 py-1 font-semibold text-[#334155] disabled:opacity-40"
                disabled={props.page <= 1}
                onClick={() => props.onPageChange(props.page - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                className="rounded-md border border-[#CBD5E1] px-3 py-1 font-semibold text-[#334155] disabled:opacity-40"
                disabled={props.page >= totalPages}
                onClick={() => props.onPageChange(props.page + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <SatisfactionLinkDialog data={linkDialog} onClose={() => setLinkDialog(null)} />

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="satisfaction-delete-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3
              id="satisfaction-delete-title"
              className="flex items-center gap-2 text-[16px] font-bold text-[#B91C1C]"
            >
              <Trash2 className="h-4 w-4" />
              Excluir pesquisa
            </h3>
            <p className="mt-2 text-[14px] text-[#334155]">
              <span className="font-semibold">{deleteTarget.name}</span>{" "}
              <span className="text-[#94A3B8]">({deleteTarget.code})</span>
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-[#475569]">
              <li>A pesquisa some de todas as telas imediatamente.</li>
              <li>Todos os links de resposta (individuais e geral) deixam de funcionar.</li>
              <li>Os dados são preservados para auditoria — nada é apagado do banco.</li>
              <li>Não é possível desfazer pela tela.</li>
            </ul>
            <label className="mt-4 block text-[12px] font-semibold text-[#475569]">
              Digite o código{" "}
              <span className="font-mono text-[#B91C1C]">{deleteTarget.code}</span>{" "}
              para confirmar
              <input
                autoFocus
                className="mt-1 w-full rounded-md border border-[#CBD5E1] px-3 py-2 font-mono text-[14px] font-normal"
                value={deleteCode}
                onChange={(e) => setDeleteCode(e.target.value)}
                placeholder={deleteTarget.code}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-[#CBD5E1] px-4 py-2 text-[14px] font-semibold text-[#334155] hover:bg-[#F8FAFC]"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteCode("");
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="satisfaction-campaign-delete-confirm"
                disabled={
                  busyId === deleteTarget.id ||
                  deleteCode.trim() !== deleteTarget.code
                }
                className="rounded-md bg-[#B91C1C] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#991B1B] disabled:opacity-40"
                onClick={() => {
                  const target = deleteTarget;
                  const code = deleteCode.trim();
                  void runAction(
                    target.id,
                    () => satisfactionApi.deleteCampaign(target.id, code),
                    `Pesquisa "${target.name}" excluída.`
                  ).finally(() => {
                    setDeleteTarget(null);
                    setDeleteCode("");
                  });
                }}
              >
                Excluir definitivamente
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wizardOpen ? (
        <NewSurveyWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            setFeedback("Pesquisa criada.");
            props.onRefresh();
          }}
        />
      ) : null}
    </div>
  );
}
