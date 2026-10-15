/**
 * Aprovações de nível (governança): pendentes com Aprovar / Rejeitar (justificativa obrigatória)
 * e o histórico de decisões. A regra (quem/quando) está no servidor (`competencyGovernance.ts`).
 */
import React, { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { OverlayBadge, OverlayTable, OverlayTextarea } from "@/src/components/ui/overlay";
import { decideLevelRequest, fetchLevelRequests } from "@/src/lib/competencies/competencyClient";
import { COMPETENCY_LEVEL_SOURCE_LABELS } from "@/src/lib/competencies/competencyDomain";
import {
  APPROVAL_REASON_LABELS,
  LEVEL_REQUEST_STATUS_LABELS,
  type ApprovalReason,
  type LevelRequestStatus,
} from "@/src/lib/competencies/competencyGovernance";
import type { LevelRequestDto } from "@/src/lib/competencies/competencyTypes";
import { CompetencyModalFrame } from "./CompetencyModalFrame";
import { BTN_GHOST, LevelChip, PANEL, PanelState, SegmentedControl } from "./competencyUi";

type View = "PENDING" | "DECIDED";

const STATUS_TONE: Record<string, "amber" | "emerald" | "rose" | "slate"> = {
  PENDING: "amber",
  APPROVED: "emerald",
  REJECTED: "rose",
  SUPERSEDED: "slate",
};

export function CompetencyApprovalsTab({
  canDecide,
  refreshKey,
  onDecided,
}: {
  canDecide: boolean;
  /** Muda quando a página recarrega (nova solicitação, importação…). */
  refreshKey: number;
  onDecided: (message: string) => void;
}) {
  const [view, setView] = useState<View>("PENDING");
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; list: LevelRequestDto[] } | { kind: "error"; message: string }>({
    kind: "loading",
  });
  const [rejecting, setRejecting] = useState<LevelRequestDto | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setState({ kind: "loading" });
    fetchLevelRequests(view, ac.signal)
      .then((r) => !ac.signal.aborted && setState({ kind: "ready", list: r.requests }))
      .catch((e) => !ac.signal.aborted && setState({ kind: "error", message: e instanceof Error ? e.message : "Erro ao carregar." }));
    return () => ac.abort();
  }, [view, refreshKey, tick]);

  const decide = async (request: LevelRequestDto, decision: "APPROVE" | "REJECT", decisionNote: string | null) => {
    setBusy(request.id);
    setError(null);
    try {
      await decideLevelRequest(request.id, decision, decisionNote);
      onDecided(decision === "APPROVE" ? "Nível aprovado e aplicado na matriz" : "Solicitação rejeitada");
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Não foi possível decidir.");
      setTick((t) => t + 1);
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const list = state.kind === "ready" ? state.list : [];
  return (
    <section className={PANEL} data-testid="competency-approvals">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Aprovações de nível</h3>
          <p className="text-xs text-muted-foreground">
            Nível 3 ou 4 fora de avaliação formal e qualquer subida em competência crítica dependem de aprovação.
          </p>
        </div>
        <SegmentedControl<View>
          ariaLabel="Situação"
          value={view}
          onChange={setView}
          options={[
            { value: "PENDING", label: "Pendentes" },
            { value: "DECIDED", label: "Decididas" },
          ]}
        />
      </header>
      {error ? (
        <div role="alert" className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {state.kind === "error" ? (
        <PanelState kind="error" message={state.message} onRetry={() => setTick((t) => t + 1)} />
      ) : state.kind === "loading" ? (
        <PanelState kind="loading" message="Carregando solicitações…" />
      ) : list.length === 0 ? (
        <PanelState
          kind="empty"
          testId="competency-approvals-empty"
          message={view === "PENDING" ? "Nenhuma solicitação aguardando aprovação." : "Nenhuma decisão registrada."}
        />
      ) : (
        <OverlayTable minWidth={880}>
          <OverlayTable.Head>
            <OverlayTable.Row>
              <OverlayTable.HeadCell>Colaborador</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Competência</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Nível</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Motivo</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Origem</OverlayTable.HeadCell>
              <OverlayTable.HeadCell nowrap>Solicitado em</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>{view === "PENDING" ? "Decisão" : "Situação"}</OverlayTable.HeadCell>
            </OverlayTable.Row>
          </OverlayTable.Head>
          <OverlayTable.Body>
            {list.map((q) => (
              <OverlayTable.Row key={q.id} data-testid="competency-approval-row">
                <OverlayTable.Cell className="font-semibold">{q.employeeName}</OverlayTable.Cell>
                <OverlayTable.Cell>
                  {q.competencyName}
                  {q.critical ? (
                    <OverlayBadge tone="rose" className="ml-1.5">
                      Crítica
                    </OverlayBadge>
                  ) : null}
                </OverlayTable.Cell>
                <OverlayTable.Cell nowrap>
                  <span className="inline-flex items-center gap-1.5">
                    <LevelChip level={q.fromLevel} /> → <LevelChip level={q.toLevel} />
                  </span>
                </OverlayTable.Cell>
                <OverlayTable.Cell className="text-xs">{APPROVAL_REASON_LABELS[q.reason as ApprovalReason] ?? q.reason}</OverlayTable.Cell>
                <OverlayTable.Cell className="text-xs">
                  {COMPETENCY_LEVEL_SOURCE_LABELS[q.source as keyof typeof COMPETENCY_LEVEL_SOURCE_LABELS] ?? q.source}
                </OverlayTable.Cell>
                <OverlayTable.Cell mono>{new Date(q.requestedAt).toLocaleDateString("pt-BR")}</OverlayTable.Cell>
                <OverlayTable.Cell nowrap>
                  {view === "PENDING" ? (
                    canDecide ? (
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          className={BTN_GHOST}
                          disabled={busy === q.id}
                          onClick={() => void decide(q, "APPROVE", null).catch(() => undefined)}
                          data-testid="competency-approval-approve"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden /> Aprovar
                        </button>
                        <button
                          type="button"
                          className={`${BTN_GHOST} text-rose-700 hover:bg-rose-50`}
                          disabled={busy === q.id}
                          onClick={() => {
                            setNote("");
                            setRejecting(q);
                          }}
                          data-testid="competency-approval-reject"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden /> Rejeitar
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Aguardando aprovador</span>
                    )
                  ) : (
                    <span title={q.decisionNote ?? undefined}>
                      <OverlayBadge tone={STATUS_TONE[q.status] ?? "slate"}>
                        {LEVEL_REQUEST_STATUS_LABELS[q.status as LevelRequestStatus] ?? q.status}
                      </OverlayBadge>
                      {q.decisionNote ? <span className="ml-2 text-xs text-muted-foreground">{q.decisionNote}</span> : null}
                    </span>
                  )}
                </OverlayTable.Cell>
              </OverlayTable.Row>
            ))}
          </OverlayTable.Body>
        </OverlayTable>
      )}
      <CompetencyModalFrame
        open={Boolean(rejecting)}
        size="md"
        testId="competency-reject-overlay"
        title="Rejeitar solicitação"
        subtitle={rejecting ? `${rejecting.employeeName} · ${rejecting.competencyName}: ${rejecting.fromLevel} → ${rejecting.toLevel}` : ""}
        saveLabel="Rejeitar"
        footerHint="A justificativa fica registrada"
        canSave={note.trim().length > 0}
        onSave={async () => {
          if (!rejecting) return;
          await decide(rejecting, "REJECT", note.trim());
          setRejecting(null);
        }}
        onClose={() => setRejecting(null)}
      >
        <OverlayTextarea
          aria-label="Justificativa"
          rows={4}
          value={note}
          placeholder="Ex.: sem evidência de treinamento concluído"
          onChange={(e) => setNote(e.target.value)}
          data-testid="competency-reject-note"
        />
      </CompetencyModalFrame>
    </section>
  );
}
