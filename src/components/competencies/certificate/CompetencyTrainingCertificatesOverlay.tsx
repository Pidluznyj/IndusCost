import React, { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, Award, Loader2, Lock, Printer } from "lucide-react";
import {
  Overlay,
  OverlayBody,
  OverlayField,
  OverlayFieldGrid,
  OverlayFooter,
  OverlayHeader,
  OverlayInput,
  OverlaySection,
  OverlayTable,
} from "@/src/components/ui/overlay";
import {
  cancelTrainingCertificate,
  fetchTrainingCertificateBoard,
  issueTrainingCertificates,
  saveCertificateSettings,
  saveTrainingCertificateContent,
} from "@/src/lib/competencies/competencyClient";
import { formatIsoDateBr } from "@/src/lib/competencies/competencyDomain";
import type { TrainingCertificateBoardDto } from "@/src/lib/competencies/competencyTypes";
import {
  CERTIFICATE_INSTRUCTOR_MAX,
  CERTIFICATE_PLACE_MAX,
  CERTIFICATE_SIGNER_MAX,
  formatCertificateNumber,
  formatHoursShort,
  parseCertificateSettingsBody,
} from "@/src/lib/competencies/trainingCertificate";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, PanelState, TrainingStatusBadge } from "../competencyUi";
import { TrainingSyllabusEditor, draftToSyllabus, syllabusToDraft, type SyllabusDraftRow } from "./TrainingSyllabusEditor";
import { printTrainingCertificates } from "./trainingCertificatePrint";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDateTimeBr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

type SettingsDraft = { signerName: string; signerRole: string; issuePlace: string; numberPrefix: string };

/**
 * Certificados de um treinamento: dados vêm do sistema (participantes, conclusão, competência,
 * identidade visual e configuração). Emitir congela o conteúdo; imprimir usa o congelado.
 */
export function CompetencyTrainingCertificatesOverlay({
  open,
  trainingId,
  canManage,
  onClose,
  onChanged,
}: {
  open: boolean;
  trainingId: string | null;
  canManage: boolean;
  onClose: () => void;
  /** Algo mudou (emissão/cancelamento/conteúdo): a lista recarrega. */
  onChanged: (message: string) => void;
}) {
  const titleId = useId();
  const [board, setBoard] = useState<TrainingCertificateBoardDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [instructor, setInstructor] = useState("");
  const [syllabus, setSyllabus] = useState<SyllabusDraftRow[]>([]);
  const [contentDirty, setContentDirty] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);

  const load = useCallback(async () => {
    if (!trainingId) return;
    setLoadError(null);
    try {
      const data = await fetchTrainingCertificateBoard(trainingId);
      setBoard(data);
      setInstructor(data.training.instructorName ?? "");
      setSyllabus(syllabusToDraft(data.training.syllabus));
      setContentDirty(false);
    } catch (err) {
      setLoadError(errorMessage(err, "Não foi possível carregar os certificados."));
    }
  }, [trainingId]);

  useEffect(() => {
    if (!open) return;
    setBoard(null);
    setError(null);
    setNotice(null);
    setSettingsDraft(null);
    void load();
  }, [open, load]);

  const run = async (key: string, action: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível concluir a ação."));
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  const t = board?.training;
  const blockers = board?.blockers ?? [];
  const participants = board?.participants ?? [];
  const pending = participants.filter((p) => !p.certificate && p.completedOn && p.writable);
  const issuedCount = participants.filter((p) => p.certificate).length;
  const canIssue = canManage && blockers.length === 0 && pending.length > 0;
  const contentEditable = canManage && Boolean(t) && !t!.contentLocked;
  const printTitle = t ? `Certificados — ${t.title}` : "Certificados";

  const issue = (employeeIds: string[] | null) =>
    run(employeeIds ? `issue:${employeeIds[0]}` : "issue", async () => {
      const result = await issueTrainingCertificates(trainingId!, employeeIds);
      await load();
      if (result.issued.length === 0) return "Nenhum certificado novo: os participantes já têm certificado ou não concluíram.";
      onChanged(`${result.issued.length} certificado(s) emitido(s)`);
      const numbers = result.issued.map((c) => c.number);
      return `Emitido(s): ${numbers.length > 3 ? `${numbers[0]} … ${numbers[numbers.length - 1]}` : numbers.join(", ")}.`;
    });

  const print = (ids: string[] | null) =>
    run(ids ? `print:${ids[0]}` : "print", async () => {
      await printTrainingCertificates(trainingId!, ids, printTitle);
      return null;
    });

  const cancel = (certificateId: string, number: string, name: string) => {
    const reason = window.prompt(`Cancelar o certificado ${number} de ${name}?\nInforme o motivo (fica registrado):`);
    if (reason === null) return;
    void run(`cancel:${certificateId}`, async () => {
      await cancelTrainingCertificate(certificateId, reason);
      await load();
      onChanged(`Certificado ${number} cancelado`);
      return `Certificado ${number} cancelado. Uma nova emissão recebe outro número.`;
    });
  };

  const saveContent = () =>
    run("content", async () => {
      const parsed = draftToSyllabus(syllabus, t!.workloadHours);
      if (parsed.ok === false) throw new Error(parsed.message);
      await saveTrainingCertificateContent(trainingId!, { instructorName: instructor.trim() || null, syllabus: parsed.value });
      await load();
      onChanged("Dados do certificado salvos");
      return "Instrutor e conteúdo programático salvos.";
    });

  const settingsCheck = settingsDraft ? parseCertificateSettingsBody(settingsDraft) : null;
  const saveSettings = () =>
    run("settings", async () => {
      if (!settingsCheck) return null;
      if (settingsCheck.ok === false) throw new Error(settingsCheck.message);
      await saveCertificateSettings(settingsCheck.value);
      setSettingsDraft(null);
      await load();
      return "Configuração dos certificados salva.";
    });

  const s = board?.settings;
  const nextNumberExample =
    settingsCheck?.ok === true ? formatCertificateNumber(settingsCheck.value.numberPrefix, new Date().getFullYear(), 1) : null;

  return (
    <Overlay open={open} onClose={close} size="xl" ariaLabelledBy={titleId} testId="training-certificates-overlay">
      <OverlayHeader
        titleId={titleId}
        eyebrow="Gestão de pessoas · Competências · Certificados"
        title={t ? t.title : "Certificados"}
        subtitle={t ? `${t.competencyName} · ${formatHoursShort(t.workloadHours)} · conclusão ${t.completedOn ? formatIsoDateBr(t.completedOn) : "pendente"}` : "Carregando…"}
        onClose={close}
      />
      <OverlayBody>
        {loadError ? (
          <PanelState kind="error" message={loadError} onRetry={() => void load()} />
        ) : !board || !t ? (
          <PanelState kind="loading" message="Carregando certificados…" />
        ) : (
          <div className="space-y-5">
            {error ? (
              <div role="alert" data-testid="training-certificates-error" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div role="status" data-testid="training-certificates-notice" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {notice}
              </div>
            ) : null}
            {blockers.length > 0 ? (
              <div data-testid="training-certificates-blockers" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="mb-1 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4" aria-hidden /> Emissão indisponível
                </p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <OverlaySection
              title="Participantes"
              description={`${issuedCount} de ${participants.length} com certificado vigente`}
            >
              {/* Barra própria (não `actions`): quebra linha no celular sem espremer o título. */}
              <div className="mb-3 flex flex-wrap justify-end gap-2">
                {issuedCount > 0 ? (
                  <button type="button" className={BTN_SECONDARY} onClick={() => void print(null)} disabled={Boolean(busy)} data-testid="certificates-print-all">
                    {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
                    Imprimir todos
                  </button>
                ) : null}
                {canManage && (pending.length > 0 || issuedCount === 0) ? (
                  <button type="button" className={BTN_PRIMARY} onClick={() => void issue(null)} disabled={!canIssue || Boolean(busy)} data-testid="certificates-issue-all">
                    {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Award className="h-4 w-4" aria-hidden />}
                    Emitir certificados{pending.length > 0 ? ` (${pending.length})` : ""}
                  </button>
                ) : null}
              </div>
              <OverlayTable minWidth={640}>
                <OverlayTable.Head>
                  <OverlayTable.Row>
                    <OverlayTable.HeadCell>Colaborador</OverlayTable.HeadCell>
                    <OverlayTable.HeadCell nowrap>Conclusão</OverlayTable.HeadCell>
                    <OverlayTable.HeadCell>Certificado</OverlayTable.HeadCell>
                    <OverlayTable.HeadCell align="right">Ações</OverlayTable.HeadCell>
                  </OverlayTable.Row>
                </OverlayTable.Head>
                <OverlayTable.Body>
                  {participants.map((p) => (
                    <OverlayTable.Row key={p.employeeId} data-testid="certificate-participant-row">
                      <OverlayTable.Cell>
                        <span className="font-semibold">{p.employeeName}</span>
                      </OverlayTable.Cell>
                      <OverlayTable.Cell mono>{p.completedOn ? formatIsoDateBr(p.completedOn) : "—"}</OverlayTable.Cell>
                      <OverlayTable.Cell>
                        {p.certificate ? (
                          <span>
                            <span className="block font-mono text-sm font-semibold text-primary">{p.certificate.number}</span>
                            <span className="block text-xs text-muted-foreground">
                              {formatDateTimeBr(p.certificate.issuedAt)} · {p.certificate.issuedByName}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{p.completedOn ? "Não emitido" : "Sem conclusão"}</span>
                        )}
                      </OverlayTable.Cell>
                      <OverlayTable.Cell align="right" nowrap>
                        <span className="inline-flex gap-1">
                          {p.certificate ? (
                            <button type="button" className={BTN_GHOST} disabled={Boolean(busy)} onClick={() => void print([p.certificate!.id])}>
                              <Printer className="h-3.5 w-3.5" aria-hidden /> Imprimir
                            </button>
                          ) : null}
                          {canManage && p.writable && p.certificate ? (
                            <button
                              type="button"
                              className={`${BTN_GHOST} text-rose-700 hover:bg-rose-50`}
                              disabled={Boolean(busy)}
                              onClick={() => cancel(p.certificate!.id, p.certificate!.number, p.employeeName)}
                            >
                              Cancelar
                            </button>
                          ) : null}
                          {canManage && p.writable && !p.certificate && p.completedOn && blockers.length === 0 ? (
                            <button type="button" className={BTN_GHOST} disabled={Boolean(busy)} onClick={() => void issue([p.employeeId])}>
                              Emitir
                            </button>
                          ) : null}
                        </span>
                      </OverlayTable.Cell>
                    </OverlayTable.Row>
                  ))}
                </OverlayTable.Body>
              </OverlayTable>
            </OverlaySection>

            <OverlaySection
              title="Dados do certificado"
              description="Instrutor (2ª assinatura) e conteúdo programático deste treinamento."
              actions={
                contentEditable ? (
                  <button type="button" className={BTN_SECONDARY} onClick={() => void saveContent()} disabled={!contentDirty || Boolean(busy)} data-testid="certificate-content-save">
                    {busy === "content" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    Salvar dados
                  </button>
                ) : null
              }
            >
              {t.contentLocked ? (
                <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> Travado: há certificados emitidos com este conteúdo. Cancele-os para alterar.
                </p>
              ) : null}
              <div className="space-y-4">
                <OverlayField label="Instrutor responsável" description="Opcional. Sem instrutor, a 2ª linha do certificado traz local e data.">
                  {(fp) => (
                    <OverlayInput
                      {...fp}
                      value={instructor}
                      maxLength={CERTIFICATE_INSTRUCTOR_MAX}
                      disabled={!contentEditable}
                      onChange={(e) => {
                        setInstructor(e.target.value);
                        setContentDirty(true);
                      }}
                      data-testid="certificate-instructor"
                    />
                  )}
                </OverlayField>
                <TrainingSyllabusEditor
                  rows={syllabus}
                  workloadHours={t.workloadHours}
                  disabled={!contentEditable}
                  onChange={(rows) => {
                    setSyllabus(rows);
                    setContentDirty(true);
                  }}
                />
              </div>
            </OverlaySection>

            <OverlaySection
              title="Assinatura e numeração"
              description="Configuração única para todos os certificados da empresa."
              actions={
                canManage && !settingsDraft ? (
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={() =>
                      setSettingsDraft({
                        signerName: s?.signerName ?? "",
                        signerRole: s?.signerRole ?? "",
                        issuePlace: s?.issuePlace ?? "",
                        numberPrefix: s?.numberPrefix ?? "",
                      })
                    }
                    data-testid="certificate-settings-edit"
                  >
                    {s?.signerName ? "Editar" : "Configurar"}
                  </button>
                ) : null
              }
            >
              {settingsDraft ? (
                <div className="space-y-3" data-testid="certificate-settings-form">
                  <OverlayFieldGrid columns={2}>
                    <OverlayField label="Quem assina" required>
                      {(fp) => (
                        <OverlayInput {...fp} value={settingsDraft.signerName} maxLength={CERTIFICATE_SIGNER_MAX} onChange={(e) => setSettingsDraft({ ...settingsDraft, signerName: e.target.value })} />
                      )}
                    </OverlayField>
                    <OverlayField label="Cargo" required>
                      {(fp) => (
                        <OverlayInput {...fp} value={settingsDraft.signerRole} maxLength={CERTIFICATE_SIGNER_MAX} onChange={(e) => setSettingsDraft({ ...settingsDraft, signerRole: e.target.value })} />
                      )}
                    </OverlayField>
                    <OverlayField label="Local de emissão" required description="Ex.: cidade – UF">
                      {(fp) => (
                        <OverlayInput {...fp} value={settingsDraft.issuePlace} maxLength={CERTIFICATE_PLACE_MAX} onChange={(e) => setSettingsDraft({ ...settingsDraft, issuePlace: e.target.value })} />
                      )}
                    </OverlayField>
                    <OverlayField
                      label="Prefixo da numeração"
                      required
                      description={nextNumberExample ? `Primeiro número do ano: ${nextNumberExample}` : "Letras, números e hífen"}
                    >
                      {(fp) => (
                        <OverlayInput
                          {...fp}
                          value={settingsDraft.numberPrefix}
                          maxLength={16}
                          onChange={(e) => setSettingsDraft({ ...settingsDraft, numberPrefix: e.target.value.toUpperCase() })}
                        />
                      )}
                    </OverlayField>
                  </OverlayFieldGrid>
                  <div className="flex justify-end gap-2">
                    <button type="button" className={BTN_SECONDARY} onClick={() => setSettingsDraft(null)} disabled={busy === "settings"}>
                      Cancelar
                    </button>
                    <button type="button" className={BTN_PRIMARY} onClick={() => void saveSettings()} disabled={!settingsCheck?.ok || Boolean(busy)} data-testid="certificate-settings-save">
                      {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      Salvar configuração
                    </button>
                  </div>
                </div>
              ) : (
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="certificate-settings-summary">
                  <div>
                    <dt className="text-xs text-muted-foreground">Quem assina</dt>
                    <dd className="font-medium">{s?.signerName ? `${s.signerName} · ${s.signerRole}` : "Não configurado"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Local de emissão</dt>
                    <dd className="font-medium">{s?.issuePlace ?? "Não configurado"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Numeração</dt>
                    <dd className="font-mono font-medium">{s?.numberPrefix ? `${s.numberPrefix}-AAAA/0001` : "Não configurada"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Empresa (Identidade Visual)</dt>
                    <dd className="font-medium">
                      {board.company.name ?? "Não cadastrada"}
                      <span className="text-xs font-normal text-muted-foreground"> · {board.company.hasLogo ? "com logo" : "sem logo (usa o nome)"}</span>
                    </dd>
                  </div>
                  {s?.updatedAt ? (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      Atualizado em {formatDateTimeBr(s.updatedAt)}
                      {s.updatedByName ? ` por ${s.updatedByName}` : ""}
                    </p>
                  ) : null}
                </dl>
              )}
            </OverlaySection>

            {board.canceled.length > 0 ? (
              <OverlaySection title="Cancelados" description="Histórico: números cancelados não são reutilizados.">
                <ul className="space-y-1.5 text-sm" data-testid="certificates-canceled">
                  {board.canceled.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-muted-foreground line-through">{c.number}</span>
                      <span className="font-medium">{c.employeeName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTimeBr(c.canceledAt)}
                        {c.canceledByName ? ` · ${c.canceledByName}` : ""} · {c.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </OverlaySection>
            ) : null}
          </div>
        )}
      </OverlayBody>
      <OverlayFooter hint={t ? <TrainingStatusBadge status={t.status} /> : null}>
        <button type="button" className={BTN_SECONDARY} onClick={close} disabled={Boolean(busy)}>
          Fechar
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
