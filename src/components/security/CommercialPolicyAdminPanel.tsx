import React, { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { COMMERCIAL_POLICY_ACCEPTANCE_STEPS, downloadAuthenticatedFile } from "@/src/lib/commercialPolicy/commercialPolicyClient";
import { CommercialPolicyReader } from "@/src/components/security/CommercialPolicyReader";

type Finding = {
  code: string;
  category: string;
  policySection: string;
  severity: "BLOCKING" | "WARNING" | "INFORMATIONAL";
  blocking: boolean;
  document: string;
  system: string;
  action: string;
};

type ReconciliationRow = {
  section: string;
  rule: string;
  implementation: string;
  status: string;
  severity: string | null;
  action: string;
  findingCode: string | null;
};

type PolicyChange = {
  dependencyKey: string;
  humanLabel: string;
  policySection: string;
  oldDisplayValue: string;
  newDisplayValue: string;
  reason: string;
  changedBy: string;
  changedAt: string;
  sourceVersionOld: string | null;
  sourceVersionNew: string | null;
  impact: string;
};

type VersionView = {
  id: string;
  version: number;
  label: string;
  title: string;
  status: string;
  official: boolean;
  contentHash: string;
  effectiveFrom: string;
  publishedAt: string | null;
  normativeSnapshotHash: string;
  changeSetHash: string;
  previousVersionId: string | null;
  whatChanged: string[];
  normativeSnapshot?: unknown;
  changeSet?: PolicyChange[];
};

type Integrity = {
  status: string;
  publication: string;
  publicationStatus: "NOT_PUBLISHED" | "AWAITING_COMPATIBILIZATION" | "READY_FOR_PUBLICATION" | "PUBLISHED";
  document: {
    code: string;
    title: string;
    versionLabel: string;
    classification: string;
    company: string;
    cnpj: string;
    contentHash: string;
    contentLength: number;
    questions: number;
    declarations: number;
    summaryRules: number;
  };
  counts: { blockers: number; warnings: number; informational: number };
  findings: Finding[];
  reconciliation: ReconciliationRow[];
  currentSnapshot: unknown;
  currentSnapshotHash: string | null;
  currentRelease: { basis: string; mode: string } | null;
  settingsSource: string;
  currentVersion: VersionView | null;
  officialPublishedVersion: VersionView | null;
  scheduledVersions: VersionView[];
  pendingDraft: (VersionView & { draftState: string | null; affectedSections: string[] }) | null;
  acceptancesByVersion: Array<{ versionId: string; label: string; status: string; count: number }>;
};

type Acceptance = {
  id: string;
  userNameSnapshot: string;
  userEmailSnapshot?: string;
  acceptedAt: string;
  evidenceHash: string;
  policyVersionId?: string;
};

type Coverage = { required: number; signed: number; pending: number; percent: number };

type QuestionDraft = { prompt: string; options: string; correctIndex: number; explanation: string };

const emptyQuestion = (): QuestionDraft => ({ prompt: "", options: "", correctIndex: 0, explanation: "" });

const DEFAULT_DECLARATIONS = [
  "Declaro que li integralmente a Política Comercial desta versão.",
  "Declaro que compreendi suas regras.",
  "Comprometo-me a seguir os procedimentos comerciais definidos pela empresa e registrados no IndusCost.",
  "Reconheço que este aceite será registrado eletronicamente com evidências técnicas.",
];

const PUBLICATION_LABEL: Record<Integrity["publicationStatus"], string> = {
  NOT_PUBLISHED: "Não publicada",
  AWAITING_COMPATIBILIZATION: "Aguardando compatibilização",
  READY_FOR_PUBLICATION: "Pronta para publicação",
  PUBLISHED: "Publicada",
};

const INTEGRITY_LABEL: Record<string, string> = {
  IN_SYNC: "Documento e sistema alinhados",
  POLICY_UPDATE_REQUIRED: "Sistema mudou: nova versão da política necessária",
  CONTROLLED_REFERENCE_CHANGED: "Referência controlada alterada",
  INVALID_CONFIGURATION: "Sem snapshot normativo publicado",
  POLICY_SYSTEM_MISMATCH: "Divergência documento × sistema",
  NOT_READY_FOR_PUBLICATION: "Não pronta para publicação",
};

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  BLOCKING: "Bloqueante",
  WARNING: "Alerta",
  INFORMATIONAL: "Informativo",
};

const DRAFT_STATE_LABEL: Record<string, string> = {
  DRAFT_IN_SYNC: "Snapshot do rascunho = estado atual",
  DRAFT_STALE: "Rascunho desatualizado: o sistema mudou depois do rascunho",
  DRAFT_WITHOUT_SNAPSHOT: "Rascunho sem snapshot",
  DRAFT_UNVERIFIED: "Fonte de configuração indisponível: rascunho não conferido",
};

function severityClass(severity: string | null): string {
  if (severity === "BLOCKING") return "bg-red-100 text-red-900 border-red-300";
  if (severity === "WARNING") return "bg-amber-100 text-amber-900 border-amber-300";
  if (severity === "INFORMATIONAL") return "bg-sky-100 text-sky-900 border-sky-300";
  return "bg-muted text-muted-foreground border-border";
}

function statusClass(status: Integrity["publicationStatus"]): string {
  if (status === "PUBLISHED") return "bg-emerald-100 text-emerald-900 border-emerald-300";
  if (status === "READY_FOR_PUBLICATION") return "bg-sky-100 text-sky-900 border-sky-300";
  if (status === "AWAITING_COMPATIBILIZATION") return "bg-red-100 text-red-900 border-red-300";
  return "bg-muted text-muted-foreground border-border";
}

function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function short(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 16)}…` : "—";
}

const Badge: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>
);

const VersionSummary: React.FC<{ version: VersionView; title: string; extra?: React.ReactNode }> = ({ version, title, extra }) => (
  <div className="rounded-lg border border-border p-3 text-xs">
    <p className="font-bold">{title}</p>
    <p className="mt-1">
      Versão {version.label} · {version.status} · {version.title}
      {version.official ? " · documento oficial" : ""}
    </p>
    <p>Vigência: {when(version.effectiveFrom)} · Publicação: {when(version.publishedAt)}</p>
    <p className="break-all text-muted-foreground">SHA-256 do conteúdo: {version.contentHash || "— (rascunho)"}</p>
    <p className="break-all text-muted-foreground">Snapshot normativo: {version.normativeSnapshotHash || "—"} · Changeset: {version.changeSetHash || "—"}</p>
    {extra}
  </div>
);

/**
 * Administração › Configurações › Políticas e aceites (SUPER_ADMIN).
 * Cartão do documento oficial, situação, integridade documento × sistema,
 * prévia com o mesmo leitor do vendedor, cópia controlada antes da
 * publicação, divergências, política viva (vigente, rascunho, o que mudou,
 * vigências, aceites, histórico) e editor manual em seção recolhida.
 */
export const CommercialPolicyAdminPanel: React.FC = () => {
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [rows, setRows] = useState<VersionView[]>([]);
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "info"; text: string; findings?: Finding[] } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewView, setPreviewView] = useState<"admin" | "seller">("admin");
  const [sellerFinishNotice, setSellerFinishNotice] = useState(false);
  const [divergencesOpen, setDivergencesOpen] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("Política Comercial");
  const [content, setContent] = useState("");
  const [rules, setRules] = useState("");
  const [declarations, setDeclarations] = useState(DEFAULT_DECLARATIONS.join("\n"));
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [integrityData, versionsData, acceptancesData] = await Promise.all([
        fetchJsonOk<Integrity>("/api/admin/commercial-policy/integrity"),
        fetchJsonOk<{ versions: VersionView[] }>("/api/admin/commercial-policy/versions"),
        fetchJsonOk<{ coverage: Coverage | null; acceptances: Acceptance[] }>("/api/admin/commercial-policy/acceptances"),
      ]);
      setIntegrity(integrityData);
      setRows(versionsData.versions);
      setAcceptances(acceptancesData.acceptances);
      setCoverage(acceptancesData.coverage);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar a política.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const publishOfficial = async () => {
    setConfirmPublish(false);
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/commercial-policy/official/pol-com-001", { method: "POST", credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as { alreadyPublished?: boolean; message?: string; code?: string; findings?: Finding[] };
      if (!res.ok) {
        setNotice({
          tone: "error",
          text: payload.message ?? `A publicação foi recusada (${payload.code ?? res.status}).`,
          findings: payload.findings?.filter((item) => item.severity === "BLOCKING"),
        });
        setDivergencesOpen(true);
        return;
      }
      setNotice({
        tone: "ok",
        text: payload.alreadyPublished
          ? "A POL-COM-001 versão 1.0 já estava publicada. Nenhum texto foi alterado."
          : "POL-COM-001 versão 1.0 publicada a partir do documento oficial. Vendedores sem aceite desta versão serão bloqueados no próximo acesso.",
      });
      await reload();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "A publicação foi recusada." });
    } finally {
      setBusy(false);
    }
  };

  const publishManual = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const summaryRules = rules.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const declarationLines = declarations.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const payloadQuestions = questions.map((question, index) => {
        const options = question.options.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        return {
          id: `q${index + 1}`,
          prompt: question.prompt.trim(),
          explanation: question.explanation.trim(),
          correctOptionId: `q${index + 1}o${question.correctIndex + 1}`,
          options: options.map((text, optionIndex) => ({ id: `q${index + 1}o${optionIndex + 1}`, text })),
        };
      });
      const created = await fetchJsonOk<{ version: { id: string } }>("/api/admin/commercial-policy/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, summaryRules, declarations: declarationLines, questions: payloadQuestions }),
      });
      await fetchJsonOk(`/api/admin/commercial-policy/versions/${created.version.id}/publish`, { method: "POST" });
      setNotice({ tone: "ok", text: "Versão manual publicada. Vendedores que ainda não aceitaram esta versão serão bloqueados no próximo acesso." });
      await reload();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Falha ao publicar a versão manual." });
    } finally {
      setBusy(false);
    }
  };

  const generatePdf = () =>
    void downloadAuthenticatedFile("/api/admin/commercial-policy/official/pol-com-001/document", "POL-COM-001-v1.0-copia-controlada.pdf").catch(
      (error: unknown) => setNotice({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível gerar a cópia controlada." })
    );

  const doc = integrity?.document;
  const published = integrity?.officialPublishedVersion ?? null;
  const blockers = integrity?.counts.blockers ?? 0;
  const canPublish = Boolean(integrity) && integrity?.publicationStatus === "READY_FOR_PUBLICATION" && !busy;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Políticas e aceites</h2>
        <p className="text-xs text-muted-foreground">
          A publicação oficial usa o texto integral da POL-COM-001. Uma versão publicada é imutável: qualquer correção ou mudança normativa vira nova versão, com snapshot, changeset e novo aceite.
        </p>
      </div>

      {loading ? <p className="text-xs text-muted-foreground">Carregando a política e a integridade normativa…</p> : null}
      {loadError ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          <p>{loadError}</p>
          <button type="button" className="mt-2 rounded-lg border border-red-300 px-3 py-1 font-semibold" onClick={() => void reload()}>Tentar de novo</button>
        </div>
      ) : null}

      {notice ? (
        <div
          className={`rounded-lg border p-3 text-xs ${
            notice.tone === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : notice.tone === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-border bg-muted/40"
          }`}
        >
          <p>{notice.text}</p>
          {notice.findings?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {notice.findings.map((finding) => (
                <li key={finding.code}><span className="font-semibold">{finding.code}</span> — {finding.action}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {integrity && doc ? (
        <section className="rounded-xl border border-border bg-card p-4" aria-label="Documento oficial">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold tracking-wide text-amber-800">DOCUMENTO CONTROLADO — USO INTERNO E RESTRITO</p>
              <h3 className="text-base font-bold">{doc.code} · {doc.title}</h3>
              <p className="text-xs">Versão {doc.versionLabel} · {doc.classification}</p>
              <p className="text-xs text-muted-foreground">{doc.company} · CNPJ {doc.cnpj}</p>
            </div>
            <Badge className={statusClass(integrity.publicationStatus)}>{PUBLICATION_LABEL[integrity.publicationStatus]}</Badge>
          </div>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border p-2">
              <dt className="font-semibold">SHA-256 do documento</dt>
              <dd className="break-all text-muted-foreground">{doc.contentHash}</dd>
            </div>
            <div className="rounded-lg border border-border p-2">
              <dt className="font-semibold">Integridade documento × sistema</dt>
              <dd>{INTEGRITY_LABEL[integrity.status] ?? integrity.status}</dd>
              <dd className="text-muted-foreground">Fonte da configuração: {integrity.settingsSource}{integrity.currentRelease ? ` · liberação ${integrity.currentRelease.basis} / ${integrity.currentRelease.mode}` : ""}</dd>
            </div>
            <div className="rounded-lg border border-border p-2">
              <dt className="font-semibold">Achados</dt>
              <dd className="flex flex-wrap gap-1">
                <Badge className={severityClass("BLOCKING")}>{integrity.counts.blockers} bloqueante(s)</Badge>
                <Badge className={severityClass("WARNING")}>{integrity.counts.warnings} alerta(s)</Badge>
                <Badge className={severityClass("INFORMATIONAL")}>{integrity.counts.informational} informativo(s)</Badge>
              </dd>
            </div>
            <div className="rounded-lg border border-border p-2">
              <dt className="font-semibold">Vigência</dt>
              <dd>{published ? when(published.effectiveFrom) : "— (definida na publicação)"}</dd>
            </div>
            <div className="rounded-lg border border-border p-2">
              <dt className="font-semibold">Publicação</dt>
              <dd>{published ? when(published.publishedAt) : "— (não publicada)"}</dd>
            </div>
            <div className="rounded-lg border border-border p-2">
              <dt className="font-semibold">Conteúdo</dt>
              <dd className="text-muted-foreground">{doc.contentLength.toLocaleString("pt-BR")} caracteres · {doc.questions} perguntas · {doc.declarations} declarações · {doc.summaryRules} regras-resumo</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={() => setPreviewOpen(true)}>
              Visualizar política oficial
            </button>
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={generatePdf}>
              Gerar PDF / cópia controlada
            </button>
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={() => setDivergencesOpen((open) => !open)}>
              {divergencesOpen ? "Ocultar divergências" : "Ver divergências"}
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canPublish}
              title={
                integrity.publicationStatus === "PUBLISHED"
                  ? "Versão 1.0 já publicada."
                  : blockers > 0
                    ? `${blockers} achado(s) bloqueante(s) impedem a publicação.`
                    : "Publicar a versão 1.0 a partir do documento oficial."
              }
              onClick={() => setConfirmPublish(true)}
            >
              Publicar versão 1.0
            </button>
          </div>
          {blockers > 0 && integrity.publicationStatus !== "PUBLISHED" ? (
            <p className="mt-2 text-xs text-red-900">
              A publicação está bloqueada por {blockers} divergência(s) real(is) entre o documento e o que o IndusCost executa. Alertas e informativos não bloqueiam.
            </p>
          ) : null}
          {confirmPublish ? (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
              <p className="font-semibold">Confirmar publicação da POL-COM-001 versão 1.0?</p>
              <p className="mt-1">A versão publicada fica imutável, o snapshot normativo atual é congelado e todos os vendedores precisarão aceitar esta versão no próximo acesso.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground" onClick={() => void publishOfficial()}>Publicar agora</button>
                <button type="button" className="rounded-lg border border-border px-3 py-2 font-semibold" onClick={() => setConfirmPublish(false)}>Cancelar</button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {integrity && divergencesOpen ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Divergências">
          <h3 className="text-sm font-bold">Divergências documento × sistema</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-muted/60">
                <tr>
                  {["Código", "Categoria", "Seção", "Documento", "Sistema", "Severidade", "Bloqueia?", "Ação necessária"].map((head) => (
                    <th key={head} className="border-b border-border px-2 py-1 text-left font-bold">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {integrity.findings.map((finding) => (
                  <tr key={finding.code} className="align-top">
                    <td className="border-b border-border/60 px-2 py-1 font-mono">{finding.code}</td>
                    <td className="border-b border-border/60 px-2 py-1">{finding.category}</td>
                    <td className="border-b border-border/60 px-2 py-1">{finding.policySection}</td>
                    <td className="border-b border-border/60 px-2 py-1">{finding.document}</td>
                    <td className="border-b border-border/60 px-2 py-1">{finding.system}</td>
                    <td className="border-b border-border/60 px-2 py-1"><Badge className={severityClass(finding.severity)}>{SEVERITY_LABEL[finding.severity]}</Badge></td>
                    <td className="border-b border-border/60 px-2 py-1 font-semibold">{finding.blocking ? "Sim" : "Não"}</td>
                    <td className="border-b border-border/60 px-2 py-1">{finding.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4 className="text-xs font-bold">Matriz de reconciliação (seção × regra × implementação)</h4>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-muted/60">
                <tr>
                  {["Seção", "Regra documental", "Implementação real", "Status", "Severidade", "Ação"].map((head) => (
                    <th key={head} className="border-b border-border px-2 py-1 text-left font-bold">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {integrity.reconciliation.map((row, index) => (
                  <tr key={`${row.section}-${index}`} className="align-top">
                    <td className="border-b border-border/60 px-2 py-1">{row.section}</td>
                    <td className="border-b border-border/60 px-2 py-1">{row.rule}</td>
                    <td className="border-b border-border/60 px-2 py-1">{row.implementation}</td>
                    <td className="border-b border-border/60 px-2 py-1 font-semibold">{row.status}</td>
                    <td className="border-b border-border/60 px-2 py-1">{row.severity ? <Badge className={severityClass(row.severity)}>{SEVERITY_LABEL[row.severity as Finding["severity"]] ?? row.severity}</Badge> : "—"}</td>
                    <td className="border-b border-border/60 px-2 py-1">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {integrity ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Política viva">
          <h3 className="text-sm font-bold">Política viva</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {integrity.currentVersion ? (
              <VersionSummary version={integrity.currentVersion} title="Versão vigente" />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Nenhuma versão vigente. A publicação da 1.0 será a baseline da política viva.</div>
            )}
            {integrity.pendingDraft ? (
              <VersionSummary
                version={integrity.pendingDraft}
                title="Próxima versão em rascunho"
                extra={
                  <div className="mt-2 space-y-2">
                    <p className="font-semibold">{DRAFT_STATE_LABEL[integrity.pendingDraft.draftState ?? ""] ?? integrity.pendingDraft.draftState ?? "—"}</p>
                    <p>Seções afetadas (revisão assistida do texto): {integrity.pendingDraft.affectedSections.join(", ") || "—"}</p>
                    <p className="break-all text-muted-foreground">Snapshot vigente: {short(integrity.currentVersion?.normativeSnapshotHash)} · Snapshot proposto: {short(integrity.pendingDraft.normativeSnapshotHash)} · Estado atual do sistema: {short(integrity.currentSnapshotHash)}</p>
                    {integrity.pendingDraft.changeSet?.length ? (
                      <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead className="bg-muted/60">
                          <tr>
                            {["Dependência", "Seção", "Anterior", "Novo", "Motivo", "Usuário", "Data/hora", "Impacto"].map((head) => (
                              <th key={head} className="border-b border-border px-1 py-1 text-left font-bold">{head}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {integrity.pendingDraft.changeSet.map((change) => (
                            <tr key={`${change.dependencyKey}-${change.changedAt}`} className="align-top">
                              <td className="border-b border-border/60 px-1 py-1">{change.humanLabel} <span className="font-mono text-muted-foreground">({change.dependencyKey})</span></td>
                              <td className="border-b border-border/60 px-1 py-1">{change.policySection}</td>
                              <td className="border-b border-border/60 px-1 py-1">{change.oldDisplayValue}</td>
                              <td className="border-b border-border/60 px-1 py-1">{change.newDisplayValue}</td>
                              <td className="border-b border-border/60 px-1 py-1">{change.reason}</td>
                              <td className="border-b border-border/60 px-1 py-1">{change.changedBy}</td>
                              <td className="border-b border-border/60 px-1 py-1">{when(change.changedAt)}</td>
                              <td className="border-b border-border/60 px-1 py-1">{change.impact}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    ) : null}
                    <div>
                      <p className="font-semibold">O que mudou</p>
                      {integrity.pendingDraft.whatChanged.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                    <p className="text-muted-foreground">A publicação do rascunho fica bloqueada enquanto o texto e o snapshot divergirem do estado atual; a vigência é prospectiva e exige novo aceite por versão.</p>
                  </div>
                }
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                Sem mudanças normativas pendentes. Alterações em metodologia de preço, matriz/faixas de comissão, liberação, supervisor, inatividade, preservação por CRM ou regra geral de campanha abrem automaticamente um único rascunho aqui; preço de SKU, responsável do cliente, contato de CRM e pedido de venda não abrem.
              </div>
            )}
          </div>
          {integrity.scheduledVersions.length ? (
            <div className="text-xs">
              <p className="font-semibold">Vigência futura</p>
              {integrity.scheduledVersions.map((version) => (
                <p key={version.id}>Versão {version.label} publicada em {when(version.publishedAt)} · vigente a partir de {when(version.effectiveFrom)}</p>
              ))}
            </div>
          ) : null}
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="font-semibold">Aceites por versão</p>
              {integrity.acceptancesByVersion.length ? (
                <ul className="mt-1 space-y-1">
                  {integrity.acceptancesByVersion.map((row) => (
                    <li key={row.versionId}>Versão {row.label} · {row.status} · {row.count} aceite(s)</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Nenhuma versão registrada.</p>
              )}
            </div>
            {coverage ? (
              <div className="rounded-lg border border-border p-3">
                <p className="font-semibold">Cobertura da versão vigente</p>
                <p>Obrigados: {coverage.required} · Assinados: {coverage.signed} · Pendentes: {coverage.pending} · {coverage.percent}%</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-4" aria-label="Histórico">
        <h3 className="text-sm font-bold">Histórico de versões</h3>
        <ul className="mt-2 space-y-1 text-xs">
          {rows.length === 0 ? <li className="text-muted-foreground">Nenhuma versão.</li> : null}
          {rows.map((row) => (
            <li key={row.id} className="break-all">
              Versão {row.label} (#{row.version}) · {row.status} · {row.title} · publicada {when(row.publishedAt)} · vigência {when(row.effectiveFrom)} · SHA-256 {short(row.contentHash)}
              {row.status !== "DRAFT" ? (
                <>
                  {" "}
                  <button type="button" className="font-semibold text-primary" onClick={() => void downloadAuthenticatedFile(`/api/commercial-policy/versions/${row.id}/document`, `POL-COM-001-v${row.label}-copia-controlada.pdf`)}>
                    cópia controlada
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
        <h3 className="mt-4 text-sm font-bold">Aceites</h3>
        <ul className="mt-2 space-y-1 text-xs">
          {acceptances.length === 0 ? <li className="text-muted-foreground">Nenhum aceite registrado.</li> : null}
          {acceptances.map((row) => (
            <li key={row.id} className="break-all">
              {row.userNameSnapshot}{row.userEmailSnapshot ? ` · ${row.userEmailSnapshot}` : ""} · {when(row.acceptedAt)} · versão {rows.find((version) => version.id === row.policyVersionId)?.label ?? "—"} · {row.id} · evidência {short(row.evidenceHash)}
              {" "}
              <button type="button" className="font-semibold text-primary" onClick={() => void downloadAuthenticatedFile(`/api/commercial-policy/acceptances/${row.id}/receipt`, `aceite-${row.id}.pdf`)}>
                comprovante
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-4" aria-label="Criar nova versão manual">
        <button type="button" className="flex w-full items-center justify-between text-left text-sm font-bold" onClick={() => setManualOpen((open) => !open)} aria-expanded={manualOpen}>
          <span>Criar nova versão manual</span>
          <span className="text-xs font-semibold text-muted-foreground">{manualOpen ? "Recolher" : "Expandir"}</span>
        </button>
        {manualOpen ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Uso excepcional. A versão manual não passa pela auditoria documento × sistema da POL-COM-001; use o documento oficial para a política comercial.
            </p>
            <label className="block space-y-1 text-xs">
              Título
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </label>
            <label className="block space-y-1 text-xs">
              Texto oficial
              <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={8} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </label>
            <label className="block space-y-1 text-xs">
              Principais regras (uma por linha)
              <textarea value={rules} onChange={(event) => setRules(event.target.value)} rows={4} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </label>
            <label className="block space-y-1 text-xs">
              Declarações (uma por linha)
              <textarea value={declarations} onChange={(event) => setDeclarations(event.target.value)} rows={4} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </label>
            {questions.map((question, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs font-semibold">Pergunta {index + 1}</p>
                <input value={question.prompt} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item))} placeholder="Enunciado" className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
                <textarea value={question.options} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, options: event.target.value } : item))} placeholder="Opções, uma por linha" rows={3} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
                <input type="number" min={1} value={question.correctIndex + 1} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, correctIndex: Math.max(0, Number(event.target.value) - 1) } : item))} className="w-24 rounded-lg border border-border px-3 py-2 text-sm" />
                <input value={question.explanation} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, explanation: event.target.value } : item))} placeholder="Explicação se errar" className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={() => setQuestions((current) => [...current, emptyQuestion()])}>
                Adicionar pergunta
              </button>
              <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40" disabled={busy} onClick={() => void publishManual()}>
                Publicar versão manual
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {previewOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/95" role="dialog" aria-modal="true" aria-label="Prévia da política oficial">
          {/* Barra administrativa: deixa claro que é a área do SUPER_ADMIN e alterna entre a visão de gestão e a simulação do vendedor. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 text-slate-100">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge className="border-amber-400 bg-amber-400/15 text-amber-200">ÁREA ADMINISTRATIVA · SUPER_ADMIN</Badge>
              <p className="truncate text-sm font-bold">Prévia da {doc?.code ?? "POL-COM-001"} · versão {doc?.versionLabel ?? "1.0"}</p>
              <Badge className={statusClass(integrity?.publicationStatus ?? "NOT_PUBLISHED")}>{PUBLICATION_LABEL[integrity?.publicationStatus ?? "NOT_PUBLISHED"]}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-600 p-0.5 text-xs font-semibold" role="tablist" aria-label="Modo da prévia">
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewView === "admin"}
                  className={`rounded-md px-3 py-1.5 ${previewView === "admin" ? "bg-slate-100 text-slate-900" : "text-slate-200 hover:bg-slate-800"}`}
                  onClick={() => setPreviewView("admin")}
                >
                  Visão do administrador
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewView === "seller"}
                  className={`rounded-md px-3 py-1.5 ${previewView === "seller" ? "bg-slate-100 text-slate-900" : "text-slate-200 hover:bg-slate-800"}`}
                  onClick={() => setPreviewView("seller")}
                >
                  Como o vendedor verá
                </button>
              </div>
              <button type="button" className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-800" onClick={generatePdf}>
                Gerar PDF / cópia controlada
              </button>
              <button type="button" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900" onClick={() => setPreviewOpen(false)}>
                Fechar prévia
              </button>
            </div>
          </div>

          {/* Moldura: o documento fica centralizado como um cartão; as laterais escuras reforçam que é uma prévia e não a tela do vendedor. */}
          <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-4">
            <div className="mx-auto flex h-full w-full max-w-7xl min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-background shadow-2xl">
              {previewView === "admin" ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-4 py-2 text-xs">
                    <span className="font-semibold">Prévia administrativa</span>
                    <span className="text-muted-foreground">Não gera aceite, não registra leitura e não publica.</span>
                    {blockers > 0 && integrity?.publicationStatus !== "PUBLISHED" ? (
                      <span className="text-red-900">{blockers} achado(s) bloqueante(s) impedem a publicação — veja "Ver divergências".</span>
                    ) : null}
                    <span className="text-muted-foreground">SHA-256 {short(doc?.contentHash)}</span>
                  </div>
                  <CommercialPolicyReader
                    mode="preview"
                    versionLabel={doc?.versionLabel}
                    effectiveFrom={published?.effectiveFrom ?? null}
                    onGeneratePdf={generatePdf}
                  />
                </>
              ) : (
                <>
                  <div className="border-b border-border bg-sky-50 px-4 py-2 text-xs text-sky-950">
                    <p>
                      <span className="font-semibold">Simulação da experiência do vendedor.</span> Após a publicação, todo perfil SELLER com senha pessoal ativa é levado a esta tela no próximo acesso e só entra no IndusCost depois de concluir as {COMMERCIAL_POLICY_ACCEPTANCE_STEPS.length} etapas. Nesta simulação nada é registrado.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
                    <p className="text-xs font-semibold text-muted-foreground">Etapa 1 de {COMMERCIAL_POLICY_ACCEPTANCE_STEPS.length} — Leitura</p>
                    <span className="text-xs font-semibold text-muted-foreground/60" aria-disabled="true">Sair</span>
                  </div>
                  <ol className="flex flex-wrap gap-1 border-b border-border px-4 py-2 text-[11px]" aria-label="Etapas do aceite">
                    {COMMERCIAL_POLICY_ACCEPTANCE_STEPS.map((step, stepIndex) => (
                      <li key={step} className={`rounded-full border px-2 py-0.5 ${stepIndex === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>
                        {stepIndex + 1}. {step}
                      </li>
                    ))}
                  </ol>
                  {sellerFinishNotice ? (
                    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950">
                      No vendedor, "Concluir leitura" avança para a Etapa 2 — Principais regras; depois vêm o teste de compreensão (100% de acerto), as declarações, a reautenticação por senha, o registro visual e a assinatura, que gera o comprovante com SHA-256. Nesta simulação nada foi registrado.
                      {" "}
                      <button type="button" className="font-semibold underline" onClick={() => setSellerFinishNotice(false)}>Entendi</button>
                    </div>
                  ) : null}
                  <CommercialPolicyReader
                    mode="acceptance"
                    versionLabel={doc?.versionLabel}
                    effectiveFrom={published?.effectiveFrom ?? null}
                    onGeneratePdf={generatePdf}
                    onFinish={() => setSellerFinishNotice(true)}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
