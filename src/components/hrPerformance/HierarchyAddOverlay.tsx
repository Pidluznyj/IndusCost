/**
 * Adicionar participantes por hierarquia: escolher o líder → abrangência → prévia → confirmar.
 * A prévia vem do servidor e nunca grava; a confirmação leva a assinatura da prévia, e o servidor
 * refaz tudo e recusa se a estrutura mudou. Incluir a estrutura de um líder não muda o superior de
 * ninguém: cada pessoa entra com o próprio superior efetivo.
 */
import React, { useMemo, useState } from "react";
import { AlertTriangle, Network, ShieldAlert } from "lucide-react";
import { OverlayBadge, OverlayField, OverlayInput } from "@/src/components/ui/overlay";
import { ELIGIBILITY_LABELS, MANAGER_SOURCE_TEXT, type ParticipantManagerSource } from "@/src/lib/hrPerformance/performanceDomain";
import { confirmHierarchyInclusion, previewHierarchyInclusion, type CycleWorkspace, type DirectoryPerson, type HierarchyPreview, type InclusionMode, type PerformanceCapabilities } from "@/src/lib/hrPerformance/performanceClient";
import { BTN_GHOST, EligibilityBadge, EmployeePicker, ErrorBanner, InfoBanner, KpiTile, PerformanceModal, TableScroll } from "./performanceUi";
import { cn } from "@/src/lib/utils";

const MODES: { id: InclusionMode; label: string; hint: string; needsLeader: boolean }[] = [
  { id: "DIRECT", label: "Líder + liderados diretos", hint: "O líder escolhido e a equipe direta dele (padrão).", needsLeader: true },
  { id: "TREE", label: "Líder + toda a estrutura", hint: "O líder e todos abaixo dele, em todos os níveis, pela hierarquia efetiva.", needsLeader: true },
  { id: "REPORTS_ONLY", label: "Somente os liderados diretos", hint: "A equipe direta, sem o líder. A prévia avisa que o líder fica fora.", needsLeader: true },
  { id: "ALL", label: "Toda a organização", hint: "Todos os colaboradores ativos. Exige RH Gestor e confirmação reforçada.", needsLeader: false },
];
const ALL_PHRASE = "TODA A ORGANIZAÇÃO";

export function HierarchyAddOverlay({ ws, caps, onClose, onDone }: { ws: CycleWorkspace; caps: PerformanceCapabilities; onClose: () => void; onDone: (message: string) => void }) {
  const [leader, setLeader] = useState<DirectoryPerson | null>(null);
  const [mode, setMode] = useState<InclusionMode>("DIRECT");
  const [preview, setPreview] = useState<HierarchyPreview | null>(null);
  const [exceptions, setExceptions] = useState<Record<string, string>>({});
  const [allPhrase, setAllPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canAll = Boolean(caps.homologate || caps.lifecycle);
  const modes = useMemo(() => MODES.filter((m) => m.id !== "ALL" || canAll), [canAll]);
  const current = MODES.find((m) => m.id === mode)!;
  const ready = current.needsLeader ? Boolean(leader) : true;
  const entering = preview ? preview.rows.filter((r) => r.inclusion !== "ALREADY") : [];
  const exceptionInvalid = (Object.values(exceptions) as string[]).some((v) => v.trim().length > 0 && v.trim().length < 8);
  const allOk = mode !== "ALL" || allPhrase.trim().toUpperCase() === ALL_PHRASE;

  const reset = () => {
    setPreview(null);
    setError(null);
  };

  return (
    <PerformanceModal
      open
      title="Adicionar participantes por hierarquia"
      subtitle="Escolha um líder e a abrangência. Cada pessoa entra com o próprio superior efetivo; o líder escolhido não vira avaliador de ninguém além da equipe direta dele."
      saveLabel={preview ? `Confirmar inclusão de ${entering.length} participante(s)` : "Ver prévia"}
      footerHint={preview ? "Nada é gravado até confirmar. Se a estrutura mudar antes da confirmação, o sistema pede nova prévia." : "A prévia mostra quem entra, o superior de cada um e a elegibilidade."}
      canSave={ready && !exceptionInvalid && (preview ? entering.length > 0 && allOk : true)}
      size="xl"
      testId="perf-hierarchy-add"
      onClose={onClose}
      onSave={async () => {
        setError(null);
        try {
          if (!preview) {
            setPreview(await previewHierarchyInclusion(ws.cycle.id, { mode, leaderEmployeeId: leader?.id ?? null }));
            return;
          }
          const clean: Record<string, string> = {};
          for (const [id, v] of Object.entries(exceptions) as [string, string][]) if (v.trim().length >= 8) clean[id] = v.trim();
          const saved = await confirmHierarchyInclusion(ws.cycle.id, { mode, leaderEmployeeId: leader?.id ?? null, token: preview.token, exceptions: clean, confirmAll: mode === "ALL" });
          onDone(`${saved.added + saved.reactivated} incluída(s) por hierarquia · ${saved.eligible} elegíveis no ciclo${saved.duplicates ? ` · ${saved.duplicates} já estavam` : ""}`);
        } catch (cause) {
          const code = (cause as { code?: string }).code;
          if (code === "PREVIEW_STALE") setPreview(null);
          setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
          throw cause;
        }
      }}
    >
      <ErrorBanner message={error} />
      {!preview ? (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Abrangência</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {modes.map((m) => (
                <label key={m.id} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm", mode === m.id ? "border-primary bg-primary/5" : "border-border")}>
                  <input
                    type="radio"
                    name="perf-hierarchy-mode"
                    className="mt-0.5 h-4 w-4"
                    checked={mode === m.id}
                    onChange={() => {
                      setMode(m.id);
                      reset();
                    }}
                    data-testid={`perf-hierarchy-mode-${m.id}`}
                  />
                  <span>
                    <span className="block font-medium">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {current.needsLeader ? (
            <EmployeePicker
              value={leader}
              onChange={(p) => {
                setLeader(p);
                reset();
              }}
              label="Líder de referência"
              testId="perf-hierarchy-leader"
            />
          ) : (
            <InfoBanner tone="amber" testId="perf-hierarchy-all-warning">
              <ShieldAlert className="mr-1 inline h-4 w-4" aria-hidden /> Toda a organização: a prévia mostra o volume antes de qualquer gravação. A confirmação exige digitar “{ALL_PHRASE}”.
            </InfoBanner>
          )}
          <p className="text-xs text-muted-foreground">
            <Network className="mr-1 inline h-3.5 w-3.5" aria-hidden /> A seleção individual continua em “Incluir pessoas”. Quem já participa não é duplicado.
          </p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="perf-hierarchy-preview">
          <p className="text-sm text-muted-foreground">
            {MODES.find((m) => m.id === preview.mode)?.label}
            {preview.leader ? ` · referência: ${preview.leader.name}` : ""}
          </p>
          <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8" data-testid="perf-hierarchy-summary">
            <KpiTile label="Encontradas" value={preview.summary.found} />
            <KpiTile label="Elegíveis" value={preview.summary.eligible} tone="positive" />
            <KpiTile label="Não elegíveis" value={preview.summary.notEligible} />
            <KpiTile label="Evidência insuf." value={preview.summary.insufficient} />
            <KpiTile label="Já incluídas" value={preview.summary.alreadyIncluded} />
            <KpiTile label="Novas" value={preview.summary.newParticipants} tone="positive" />
            <KpiTile label="Líderes" value={preview.summary.leaders} />
            <KpiTile label="Sem superior" value={preview.summary.withoutSuperior} tone={preview.summary.withoutSuperior ? "warning" : "neutral"} />
          </div>
          {preview.summary.leadersOutside > 0 ? (
            <InfoBanner tone="amber" testId="perf-hierarchy-leader-outside">
              <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden /> {preview.summary.leadersOutside} pessoa(s) entram sem o superior no ciclo. O superior continua o mesmo (não é trocado por outro participante); a abertura vai pedir para incluí-lo ou justificar.
            </InfoBanner>
          ) : null}
          {preview.summary.hierarchyIssues > 0 ? <InfoBanner tone="slate">{preview.summary.hierarchyIssues} pessoa(s) com pendência na hierarquia (sem superior ou com alerta do organograma). Veja a coluna “Superior”.</InfoBanner> : null}
          <TableScroll>
            <table className="w-full min-w-[980px] text-left text-sm" data-testid="perf-hierarchy-table">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2 font-semibold">Pessoa</th>
                  <th className="py-2 pr-2 font-semibold">Superior efetivo</th>
                  <th className="py-2 pr-2 font-semibold">Liderança</th>
                  <th className="py-2 pr-2 font-semibold">Elegibilidade</th>
                  <th className="py-2 font-semibold">Inclusão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((r) => (
                  <tr key={r.employeeId} className="align-top" data-testid={`perf-hierarchy-row-${r.name}`}>
                    <td className="py-2 pr-2">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.roleName} · {r.departmentName}
                        {r.directorateName ? ` · ${r.directorateName}` : ""}
                      </p>
                    </td>
                    <td className="py-2 pr-2">
                      <p>{r.managerName ?? (r.managerSource === "TOPO" ? "Topo da estrutura" : "—")}</p>
                      <p className="text-xs text-muted-foreground">
                        {MANAGER_SOURCE_TEXT[r.managerSource as ParticipantManagerSource] ?? r.managerSource}
                        {r.leaderOutside && r.inclusion !== "ALREADY" ? " · fora do ciclo" : ""}
                      </p>
                      {r.managerNote ? <p className="text-xs text-amber-700">{r.managerNote}</p> : null}
                    </td>
                    <td className="py-2 pr-2">{r.isLeader ? <OverlayBadge tone="violet">Líder · {r.directReportCount}</OverlayBadge> : <span className="text-xs text-muted-foreground">Sem liderados</span>}</td>
                    <td className="py-2 pr-2">
                      <EligibilityBadge state={r.eligibility} title={r.reason} />
                      <p className="text-xs text-muted-foreground">{r.reason}</p>
                      <p className="text-xs" data-testid={`perf-hierarchy-tasks-${r.name}`}>{r.taskSummary}</p>
                      {r.inclusion !== "ALREADY" && r.eligibility !== "ELIGIBLE" ? (
                        <OverlayInput
                          className="mt-1"
                          value={exceptions[r.employeeId] ?? ""}
                          onChange={(e) => setExceptions((all) => ({ ...all, [r.employeeId]: e.target.value }))}
                          placeholder="Exceção do RH (motivo, 8+ caracteres)"
                          aria-label={`Exceção para ${r.name}`}
                          data-testid={`perf-hierarchy-exception-${r.name}`}
                        />
                      ) : null}
                    </td>
                    <td className="py-2">
                      {r.inclusion === "ALREADY" ? <OverlayBadge tone="slate" variant="outline">Já participa</OverlayBadge> : r.inclusion === "REACTIVATE" ? <OverlayBadge tone="sky">Volta ao ciclo</OverlayBadge> : <OverlayBadge tone="emerald">Entra</OverlayBadge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {mode === "ALL" ? (
            <OverlayField label={`Para confirmar, digite ${ALL_PHRASE}`} required>
              {(p) => <OverlayInput {...p} value={allPhrase} onChange={(e) => setAllPhrase(e.target.value)} data-testid="perf-hierarchy-all-phrase" />}
            </OverlayField>
          ) : null}
          <button type="button" className={BTN_GHOST} onClick={reset} data-testid="perf-hierarchy-back">
            Voltar e mudar a seleção
          </button>
          <p className="text-xs text-muted-foreground">
            Participação: {Object.entries(ELIGIBILITY_LABELS).map(([k, v]) => v).join(" · ")}. Quem está em período inicial ou com vínculo inativo entra na lista com o motivo e não recebe tarefa. Mudança de cargo, setor ou liderança não tira o questionário. Afastamento vigente fica de fora do lote de convites. Uma exceção do RH, com motivo, fica auditada e não reabre desligamento.
          </p>
        </div>
      )}
    </PerformanceModal>
  );
}
