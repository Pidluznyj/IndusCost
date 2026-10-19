/**
 * Ciclo de vida administrativo do ciclo: classificação (oficial/teste), ativação e exclusão de teste.
 * As ações são do SUPER_ADMIN; o servidor valida de novo (ver `performanceLifecycle.ts`).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, FlaskConical, History, Trash2 } from "lucide-react";
import { Overlay, OverlayBadge, OverlayBody, OverlayField, OverlayFooter, OverlayHeader, OverlayInput } from "@/src/components/ui/overlay";
import {
  classifyPerformanceCycleAsTest,
  deletePerformanceTestCycle,
  fetchCycleLifecycle,
  inactivatePerformanceCycle,
  reactivatePerformanceCycle,
  type CycleGovernanceDto,
  type CycleLifecycleInfo,
} from "@/src/lib/hrPerformance/performanceClient";
import { BTN_SECONDARY, ErrorBanner, InfoBanner, PanelState, PERF_EYEBROW, PerformanceModal, ReasonField } from "./performanceUi";

const ACTION_LABELS: Record<string, string> = {
  CYCLE_CREATED: "Criado",
  CYCLE_CLASSIFIED: "Classificado como teste",
  CYCLE_INACTIVATED: "Inativado",
  CYCLE_REACTIVATED: "Reativado",
  CYCLE_DELETED: "Excluído",
  CYCLE_DELETE_BLOCKED: "Exclusão bloqueada",
};

/** Selos: tipo, ativação e se entra nos indicadores oficiais. */
export function CycleGovernanceBadges({ governance, compact = false }: { governance: CycleGovernanceDto | undefined; compact?: boolean }) {
  if (!governance) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="perf-cycle-governance">
      {governance.classification === "TEST" ? (
        <OverlayBadge tone="violet" testId="perf-badge-test">Teste</OverlayBadge>
      ) : compact ? null : (
        <OverlayBadge tone="slate" variant="outline">Oficial</OverlayBadge>
      )}
      {governance.activation === "INACTIVE" ? (
        <OverlayBadge tone="rose" testId="perf-badge-inactive">Inativo</OverlayBadge>
      ) : null}
      {compact ? null : governance.officialEligible ? (
        <OverlayBadge tone="emerald" variant="outline">Entra nos indicadores oficiais</OverlayBadge>
      ) : (
        <OverlayBadge tone="amber" variant="outline" testId="perf-badge-not-official">Fora dos indicadores oficiais</OverlayBadge>
      )}
    </span>
  );
}

type Action = "classify" | "inactivate" | "reactivate" | "delete" | null;

export function CycleLifecycleOverlay({ cycleId, onClose, onChanged, onToast }: { cycleId: string; onClose: () => void; onChanged: (deleted: boolean) => void; onToast: (message: string) => void }) {
  const [info, setInfo] = useState<CycleLifecycleInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);

  const reload = useCallback(async () => {
    try {
      setInfo(await fetchCycleLifecycle(cycleId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o ciclo de vida.");
    }
  }, [cycleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = info?.canManage === true;
  const inactive = info?.cycle.activation === "INACTIVE";
  const test = info?.cycle.classification === "TEST";
  const deletable = info?.deletion?.deletable === true;
  const notAllowed = can ? undefined : "Só o SUPER_ADMIN pode fazer esta ação.";

  return (
    <Overlay open onClose={onClose} size="lg" ariaLabel="Ciclo de vida do ciclo" testId="perf-lifecycle-overlay">
      <OverlayHeader eyebrow={PERF_EYEBROW} title={`Ciclo de vida · ${info?.cycle.name ?? ""}`} subtitle="Tipo, ativação e exclusão de ciclos de teste. Toda ação pede motivo e fica registrada." onClose={onClose} />
      <OverlayBody>
        <ErrorBanner message={error} />
        {!info && !error ? <PanelState kind="loading" message="Carregando…" /> : null}
        {info ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <CycleGovernanceBadges governance={info.governance} />
              {info.governance.reasons.length > 0 ? (
                <ul className="list-disc pl-5 text-xs text-muted-foreground" data-testid="perf-lifecycle-reasons">
                  {info.governance.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Oficial, ativo, homologado com publicação oficial: entra nos indicadores.</p>
              )}
              {inactive && info.cycle.activationReason ? <p className="text-xs">Motivo da inativação: {info.cycle.activationReason}</p> : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {!test ? (
                <button type="button" className={BTN_SECONDARY} disabled={!can} title={notAllowed} onClick={() => setAction("classify")} data-testid="perf-lifecycle-classify">
                  <FlaskConical className="h-4 w-4" aria-hidden /> Classificar como teste
                </button>
              ) : null}
              {inactive ? (
                <button type="button" className={BTN_SECONDARY} disabled={!can} title={notAllowed} onClick={() => setAction("reactivate")} data-testid="perf-lifecycle-reactivate">
                  <ArchiveRestore className="h-4 w-4" aria-hidden /> Reativar
                </button>
              ) : (
                <button type="button" className={BTN_SECONDARY} disabled={!can} title={notAllowed} onClick={() => setAction("inactivate")} data-testid="perf-lifecycle-inactivate">
                  <Archive className="h-4 w-4" aria-hidden /> Inativar
                </button>
              )}
              {test ? (
                <button
                  type="button"
                  className={`${BTN_SECONDARY} text-rose-700`}
                  disabled={!can || !deletable}
                  title={notAllowed ?? (deletable ? undefined : info.deletion?.blockers.join(" "))}
                  onClick={() => setAction("delete")}
                  data-testid="perf-lifecycle-delete"
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Excluir teste
                </button>
              ) : null}
            </div>
            {test && info.deletion && !info.deletion.deletable ? (
              <InfoBanner tone="amber" testId="perf-lifecycle-delete-blockers">
                Exclusão indisponível: {info.deletion.blockers.join(" ")}
              </InfoBanner>
            ) : null}

            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <History className="h-4 w-4" aria-hidden /> Histórico de ações
              </h4>
              {info.history.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem ações registradas.</p>
              ) : (
                <ol className="space-y-1.5" data-testid="perf-lifecycle-history">
                  {info.history.map((h) => (
                    <li key={h.id} className="rounded-md border border-border px-3 py-2 text-xs">
                      <div className="flex flex-wrap justify-between gap-2">
                        <strong>{ACTION_LABELS[h.action] ?? h.action}</strong>
                        <span className="text-muted-foreground">{new Date(h.at).toLocaleString("pt-BR")}</span>
                      </div>
                      {h.detail.reason ? <p className="text-muted-foreground">Motivo: {String(h.detail.reason)}</p> : null}
                      {h.detail.classification && h.action === "CYCLE_CREATED" ? <p className="text-muted-foreground">Tipo: {h.detail.classification === "TEST" ? "teste" : "oficial"}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        ) : null}
      </OverlayBody>
      <OverlayFooter>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Fechar
        </button>
      </OverlayFooter>

      {info && action && action !== "delete" ? (
        <ReasonModal
          action={action}
          cycleName={info.cycle.name}
          onClose={() => setAction(null)}
          onSave={async (reason) => {
            if (action === "classify") {
              await classifyPerformanceCycleAsTest(cycleId, reason);
              onToast("Ciclo classificado como teste: fora dos indicadores oficiais");
            } else if (action === "inactivate") {
              const out = await inactivatePerformanceCycle(cycleId, reason);
              onToast(`Ciclo inativado · ${out.revokedInvites} convite(s) e ${out.revokedSessions} sessão(ões) revogados`);
            } else {
              const out = await reactivatePerformanceCycle(cycleId, reason);
              onToast(out.invitesNeedReissue ? "Ciclo reativado · reemita os convites" : "Ciclo reativado");
            }
            setAction(null);
            await reload();
            onChanged(false);
          }}
        />
      ) : null}
      {info && action === "delete" ? (
        <DeleteModal
          cycleName={info.cycle.name}
          counts={info.deletion?.counts ?? {}}
          onClose={() => setAction(null)}
          onSave={async (reason, confirmation) => {
            await deletePerformanceTestCycle(cycleId, reason, confirmation);
            onToast("Ciclo de teste excluído · auditoria preservada");
            setAction(null);
            onChanged(true);
          }}
        />
      ) : null}
    </Overlay>
  );
}

const MODAL_TEXT: Record<Exclude<Action, "delete" | null>, { title: string; subtitle: string; save: string }> = {
  classify: {
    title: "Classificar como teste",
    subtitle: "O ciclo deixa de compor indicadores oficiais para sempre. Teste não volta a ser oficial.",
    save: "Classificar como teste",
  },
  inactivate: {
    title: "Inativar ciclo",
    subtitle: "Nada é apagado. Convites e sessões são revogados, nenhuma resposta ou calibração entra e o ciclo sai dos indicadores e das tarefas.",
    save: "Inativar",
  },
  reactivate: {
    title: "Reativar ciclo",
    subtitle: "Volta à situação em que estava. Convites e sessões revogados continuam revogados: reemita se precisar.",
    save: "Reativar",
  },
};

function ReasonModal({ action, cycleName, onClose, onSave }: { action: Exclude<Action, "delete" | null>; cycleName: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const text = MODAL_TEXT[action];
  return (
    <PerformanceModal
      open
      title={`${text.title} · ${cycleName}`}
      subtitle={text.subtitle}
      saveLabel={text.save}
      footerHint="Fica registrado com data e responsável."
      canSave={reason.trim().length >= 8}
      size="md"
      testId={`perf-lifecycle-${action}-dialog`}
      onClose={onClose}
      onSave={() => onSave(reason)}
    >
      <ReasonField label="Motivo" value={reason} onChange={setReason} min={8} testId={`perf-lifecycle-${action}-reason`} />
    </PerformanceModal>
  );
}

function DeleteModal({
  cycleName,
  counts,
  onClose,
  onSave,
}: {
  cycleName: string;
  counts: Record<string, number>;
  onClose: () => void;
  onSave: (reason: string, confirmation: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const summary = [
    ["participants", "pessoa(s)"],
    ["assignments", "tarefa(s)"],
    ["answers", "resposta(s)"],
    ["results", "versão(ões) de resultado"],
    ["feedbacks", "devolutiva(s)"],
    ["pdis", "PDI(s)"],
  ]
    .filter(([key]) => counts[key])
    .map(([key, label]) => `${counts[key]} ${label}`)
    .join(", ");
  return (
    <PerformanceModal
      open
      title="Excluir ciclo de teste"
      subtitle={`Apaga de vez os dados deste ciclo de teste${summary ? `: ${summary}` : ""}. A auditoria fica guardada. Não dá para desfazer.`}
      saveLabel="Excluir de vez"
      footerHint="Só ciclo de teste, já inativo, sem documento emitido."
      canSave={reason.trim().length >= 8 && confirmation.trim() === cycleName.trim()}
      size="md"
      testId="perf-lifecycle-delete-dialog"
      onClose={onClose}
      onSave={() => onSave(reason, confirmation)}
    >
      <OverlayField label={`Digite o nome do ciclo: ${cycleName}`} required>
        {(p) => <OverlayInput {...p} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" data-testid="perf-lifecycle-delete-confirm" />}
      </OverlayField>
      <ReasonField label="Motivo" value={reason} onChange={setReason} min={8} testId="perf-lifecycle-delete-reason" />
    </PerformanceModal>
  );
}
