import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { COMMERCIAL_POLICY_ACCEPTANCE_STEPS, downloadAuthenticatedFile } from "@/src/lib/commercialPolicy/commercialPolicyClient";
import { parsePolicyChapters, type PolicyChapter } from "@/src/lib/commercialPolicy/policyDocumentFormat";
import { policyCommissionMatrixFromSnapshot, type PolicyCommissionMatrix } from "@/src/lib/commercialPolicy/policyAutoFields";
import { CommercialPolicyReader } from "@/src/components/security/CommercialPolicyReader";
import { CommercialPolicyVersionEditor, type EditorPayload, type EditorQuestion } from "@/src/components/security/CommercialPolicyVersionEditor";

type Finding = {
  code: string;
  category: string;
  policySection: string;
  severity: "BLOCKING" | "WARNING" | "INFORMATIONAL";
  blocking: boolean;
  document: string;
  system: string;
  action: string;
  resolution?: { owner: "SISTEMA" | "DOCUMENTO" | "DECISÃO"; where: string; steps: string[] };
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
  content: string;
  summaryRules: string[];
  declarations: string[];
  questions: EditorQuestion[];
  contentHash: string;
  effectiveFrom: string;
  publishedAt: string | null;
  normativeSnapshotHash: string;
  changeSetHash: string;
  previousVersionId: string | null;
  whatChanged: string[];
  normativeSnapshot?: unknown;
  changeSet?: PolicyChange[];
  approver?: { name: string; role: string; jobTitle?: string | null } | null;
  commissionMatrix?: PolicyCommissionMatrix | null;
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

/** Mesma frase exigida pelo servidor (RESET_ALL_ACCEPTANCES_CONFIRMATION) para zerar todos os aceites. */
const RESET_ALL_CONFIRMATION = "ZERAR ACEITES";

type PreviewDoc = {
  chapters: PolicyChapter[] | null;
  title: string;
  label: string;
  /** Nulos enquanto a versão não for publicada: o documento mostra "definida na publicação". */
  effectiveFrom: string | null;
  publishedAt: string | null;
  approver: { name: string; role: string; jobTitle?: string | null } | null;
  /** Matriz do Anexo I: a congelada na versão ou, antes de publicar, a atual da Formação de Preço. */
  commissionMatrix: PolicyCommissionMatrix | null;
  origin: string;
};

/** Hoje no fuso local, no formato do <input type="date">. */
function todayInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

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

const SEVERITY_LABEL: Record<Finding["severity"], string> = { BLOCKING: "Bloqueante", WARNING: "Alerta", INFORMATIONAL: "Informativo" };

const STATUS_LABEL: Record<string, string> = { DRAFT: "Rascunho", PUBLISHED: "Publicada", RETIRED: "Aposentada" };

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

function ownerClass(owner: string | undefined): string {
  if (owner === "SISTEMA") return "bg-violet-100 text-violet-900 border-violet-300";
  if (owner === "PROCESSO") return "bg-sky-100 text-sky-900 border-sky-300";
  if (owner === "DOCUMENTO") return "bg-amber-100 text-amber-900 border-amber-300";
  return "bg-slate-100 text-slate-800 border-slate-300";
}

function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function short(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 16)}…` : "—";
}

/** Chamada JSON que preserva o payload de erro (findings, code) em vez de só a mensagem. */
async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; code?: string; message: string; findings?: Finding[] }> {
  const res = await fetch(path, { credentials: "include", ...init });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      code: typeof data.code === "string" ? data.code : undefined,
      message: typeof data.message === "string" ? data.message : `Falha (${res.status}).`,
      findings: Array.isArray(data.findings) ? (data.findings as Finding[]) : undefined,
    };
  }
  return { ok: true, data: data as T };
}

const Badge: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>
);

const VersionSummary: React.FC<{ version: VersionView; title: string; extra?: React.ReactNode }> = ({ version, title, extra }) => (
  <div className="rounded-lg border border-border p-3 text-xs">
    <p className="font-bold">{title}</p>
    <p className="mt-1">
      Versão {version.label} · {STATUS_LABEL[version.status] ?? version.status} · {version.title}
      {version.official ? " · documento oficial" : ""}
    </p>
    <p>Vigência: {when(version.effectiveFrom)} · Publicação: {when(version.publishedAt)}</p>
    <p className="break-all text-muted-foreground">SHA-256 do conteúdo: {version.contentHash || "— (rascunho)"}</p>
    <p className="break-all text-muted-foreground">Snapshot normativo: {version.normativeSnapshotHash || "—"} · Changeset: {version.changeSetHash || "—"}</p>
    {extra}
  </div>
);

/** "O que falta para publicar": cada bloqueio com quem resolve, onde e como. */
/** Regras administrativas que o IndusCost deliberadamente não calcula: aparecem como informação, sem bloquear. */
const MANUAL_PROCESS_LABEL: Record<string, string> = {
  SUPERVISOR_SHARE_MANUAL_PROCESS: "33% Supervisor",
  APPROVAL_AUTHORITY_MANUAL_PROCESS: "Alçadas de aprovação",
  COVERAGE_MANUAL_PROCESS: "Cobertura de ausência",
};

const ManualProcessNote: React.FC<{ findings: Finding[] }> = ({ findings }) => {
  const manual = findings.filter((item) => MANUAL_PROCESS_LABEL[item.code] && item.severity !== "BLOCKING");
  if (manual.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950" aria-label="Processos manuais" data-testid="policy-manual-process">
      <p className="font-bold uppercase tracking-wide">Processo manual / externo ao motor — não bloqueia a publicação</p>
      <ul className="mt-1.5 space-y-1.5">
        {manual.map((item) => (
          <li key={item.code}>
            <span className="font-semibold">{MANUAL_PROCESS_LABEL[item.code]} · Seção {item.policySection}.</span> {item.system}
          </li>
        ))}
      </ul>
    </div>
  );
};

const PublicationGuide: React.FC<{ findings: Finding[]; status: Integrity["publicationStatus"]; onOpenEditor: () => void; onOpenDivergences: () => void; compact?: boolean; /** Coluna única, para o painel lateral estreito da prévia. */ stacked?: boolean }> = ({ findings, status, onOpenEditor, onOpenDivergences, compact, stacked }) => {
  const blockers = findings.filter((item) => item.severity === "BLOCKING");
  const warnings = findings.filter((item) => item.severity === "WARNING");
  if (status === "PUBLISHED") {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-950">
        <p className="font-semibold">Versão 1.0 publicada e vigente.</p>
        <p className="mt-1">Para alterar qualquer regra, crie um rascunho em "Conteúdo da política" (a partir da oficial ou duplicando a vigente): a publicação vira uma nova versão, com novo aceite dos vendedores.</p>
        <ManualProcessNote findings={findings} />
      </div>
    );
  }
  if (blockers.length === 0) {
    return (
      <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-xs text-sky-950">
        <p className="font-semibold">Nenhum bloqueio: a versão 1.0 pode ser publicada.</p>
        <p className="mt-1">Revise a prévia, gere a cópia controlada se quiser arquivar, e clique em "Publicar versão 1.0". {warnings.length ? `${warnings.length} alerta(s) não impedem a publicação.` : ""}</p>
        <ManualProcessNote findings={findings} />
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-300 bg-red-50/70 p-3 text-xs text-slate-900" aria-label="O que falta para publicar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-red-900">O que falta para publicar — {blockers.length} pendência(s)</p>
        {!compact ? (
          <div className="flex gap-2">
            <button type="button" className="rounded-md border border-red-300 bg-white px-2 py-1 font-semibold" onClick={onOpenEditor}>Abrir editor de conteúdo</button>
            <button type="button" className="rounded-md border border-red-300 bg-white px-2 py-1 font-semibold" onClick={onOpenDivergences}>Ver tabela completa</button>
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-slate-700">
        Publicar só fica disponível quando cada item abaixo estiver resolvido. Nada aqui é marcado à mão: a tela reconfere o documento contra o sistema a cada abertura.
      </p>
      <ol className="mt-3 space-y-3">
        {blockers.map((finding, index) => (
          <li key={finding.code} className="rounded-lg border border-red-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-700 text-[11px] font-bold text-white">{index + 1}</span>
              <p className="font-bold">{finding.category.replace(/_/g, " ")} · Seção {finding.policySection}</p>
              <Badge className={ownerClass(finding.resolution?.owner)}>Quem resolve: {finding.resolution?.owner ?? "DECISÃO"}</Badge>
              <code className="ml-auto text-[10px] text-muted-foreground">{finding.code}</code>
            </div>
            <dl className={`mt-2 grid gap-2 ${stacked ? "" : "sm:grid-cols-2"}`}>
              <div className="rounded-md bg-amber-50 p-2">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-amber-800">O documento diz</dt>
                <dd className="mt-0.5 leading-relaxed">{finding.document}</dd>
              </div>
              <div className="rounded-md bg-slate-100 p-2">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-700">O sistema faz</dt>
                <dd className="mt-0.5 leading-relaxed">{finding.system}</dd>
              </div>
            </dl>
            <div className="mt-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-700">Onde</p>
              <p className="leading-relaxed">{finding.resolution?.where ?? "—"}</p>
            </div>
            <div className="mt-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-700">Como resolver</p>
              <ol className="list-decimal space-y-0.5 pl-5 leading-relaxed">
                {(finding.resolution?.steps ?? [finding.action]).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </li>
        ))}
      </ol>
      {warnings.length && stacked ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-slate-800">
          <p className="font-bold text-amber-900">Alertas — não bloqueiam a publicação</p>
          <ul className="mt-1 space-y-1.5">
            {warnings.map((item) => (
              <li key={item.code}>
                <code className="text-[10px] text-muted-foreground">{item.code}</code>
                <span className="block leading-relaxed">{item.resolution?.steps[0] ?? item.action}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : warnings.length ? (
        <p className="mt-3 text-slate-700">
          Alertas (não bloqueiam): {warnings.map((item) => `${item.code} — ${item.resolution?.steps[0] ?? item.action}`).join(" · ")}
        </p>
      ) : null}
      <ManualProcessNote findings={findings} />
    </div>
  );
};

/**
 * Administração › Configurações › Políticas e aceites (SUPER_ADMIN).
 * Cartão do documento oficial, "o que falta para publicar", prévia com o mesmo
 * leitor do vendedor (visão admin × simulação do vendedor), cópia controlada,
 * divergências, política viva, CRUD do conteúdo (rascunhos editáveis, versão
 * publicada imutável) e histórico de versões e aceites.
 */
export const CommercialPolicyAdminPanel: React.FC = () => {
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [rows, setRows] = useState<VersionView[]>([]);
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "info"; text: string; findings?: Finding[] } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<PreviewDoc | null>(null);
  const [previewView, setPreviewView] = useState<"admin" | "seller">("admin");
  const [sellerFinishNotice, setSellerFinishNotice] = useState(false);
  const [previewPendingOpen, setPreviewPendingOpen] = useState(false);
  const [publishEffectiveFrom, setPublishEffectiveFrom] = useState(todayInputValue);
  const [divergencesOpen, setDivergencesOpen] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState<{ kind: "official" } | { kind: "version"; id: string; label: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Aceite a zerar ("ALL" = todos); o motivo é obrigatório e vai para o log de segurança. */
  const [resetTarget, setResetTarget] = useState<Acceptance | "ALL" | null>(null);
  const [resetReason, setResetReason] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

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

  const doc = integrity?.document;
  const published = integrity?.officialPublishedVersion ?? null;
  const blockers = integrity?.counts.blockers ?? 0;
  const canPublish = Boolean(integrity) && integrity?.publicationStatus === "READY_FOR_PUBLICATION" && !busy;
  const editing = useMemo(() => rows.find((row) => row.id === editingId) ?? null, [rows, editingId]);

  const fail = (message: string, findings?: Finding[]) => {
    setNotice({ tone: "error", text: message, findings: findings?.filter((item) => item.severity === "BLOCKING") });
    if (findings?.length) setDivergencesOpen(true);
  };

  const run = async (label: string, action: () => Promise<{ ok: boolean; message?: string; findings?: Finding[] }>) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        fail(result.message ?? `${label}: recusado.`, result.findings);
        return false;
      }
      await reload();
      return true;
    } catch (error) {
      fail(error instanceof Error ? error.message : `${label}: falha.`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const publishOfficial = () =>
    void run("Publicação", async () => {
      const result = await api<{ alreadyPublished: boolean }>("/api/admin/commercial-policy/official/pol-com-001", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveFrom: publishEffectiveFrom }),
      });
      if (!result.ok) return result;
      setNotice({
        tone: "ok",
        text: result.data.alreadyPublished
          ? "A POL-COM-001 versão 1.0 já estava publicada. Nenhum texto foi alterado."
          : "POL-COM-001 versão 1.0 publicada a partir do documento oficial. Vendedores sem aceite desta versão serão bloqueados no próximo acesso.",
      });
      return { ok: true };
    });

  const publishVersion = (id: string, label: string) =>
    void run("Publicação", async () => {
      const result = await api<{ version: VersionView }>(`/api/admin/commercial-policy/versions/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveFrom: publishEffectiveFrom }),
      });
      if (!result.ok) return result;
      setEditingId(null);
      setNotice({ tone: "ok", text: `Versão ${label} publicada. Vendedores sem aceite desta versão serão bloqueados no próximo acesso.` });
      return { ok: true };
    });

  const createFromOfficial = () =>
    void run("Novo rascunho", async () => {
      const result = await api<{ version: VersionView }>("/api/admin/commercial-policy/versions/from-official", { method: "POST" });
      if (!result.ok) return result;
      setEditingId(result.data.version.id);
      setNotice({ tone: "ok", text: `Rascunho criado a partir do documento oficial (versão ${result.data.version.label}). Edite, salve e visualize antes de publicar.` });
      return { ok: true };
    });

  const resetAcceptances = (target: Acceptance | null) => {
    setResetReason("");
    setResetConfirmation("");
    setResetTarget(target ?? "ALL");
  };

  const confirmResetAcceptances = () => {
    const target = resetTarget;
    if (!target) return;
    void run("Zerar aceites", async () => {
      const result = await api<{ removedAcceptances: number }>(
        target === "ALL" ? "/api/admin/commercial-policy/acceptances/reset" : `/api/admin/commercial-policy/acceptances/${target.id}/reset`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: resetReason, confirmation: resetConfirmation }),
        }
      );
      if (!result.ok) return result;
      setResetTarget(null);
      setNotice({
        tone: "ok",
        text:
          target === "ALL"
            ? `${result.data.removedAcceptances} aceite(s) zerado(s). Os vendedores voltam a ser obrigados a ler e aceitar no próximo acesso.`
            : `Aceite de ${target.userNameSnapshot} zerado. A política volta a ser exigida no próximo acesso.`,
      });
      return { ok: true };
    });
  };

  const createBlank = () =>
    void run("Novo rascunho", async () => {
      const result = await api<{ version: VersionView }>("/api/admin/commercial-policy/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Nova política comercial",
          content: "# Capa\nDescreva aqui o objetivo do documento. Este texto é o que o vendedor vai ler.\n\n# 1. Objetivo\nEscreva o conteúdo normativo.",
          summaryRules: ["Regra principal a ser lembrada pelo vendedor."],
          declarations: ["Declaro que li integralmente esta versão da Política Comercial.", "Reconheço que este aceite será registrado eletronicamente com evidências técnicas."],
          questions: [{ id: "q1", prompt: "Pergunta de compreensão", options: [{ id: "a", text: "Alternativa correta" }, { id: "b", text: "Alternativa incorreta" }], correctOptionId: "a", explanation: "Explique a resposta ao vendedor." }],
        }),
      });
      if (!result.ok) return result;
      setEditingId(result.data.version.id);
      return { ok: true };
    });

  const duplicate = (id: string) =>
    void run("Duplicar", async () => {
      const result = await api<{ version: VersionView }>(`/api/admin/commercial-policy/versions/${id}/duplicate`, { method: "POST" });
      if (!result.ok) return result;
      setEditingId(result.data.version.id);
      return { ok: true };
    });

  const saveDraft = async (id: string, payload: EditorPayload) => {
    const ok = await run("Salvar rascunho", async () => {
      const result = await api<{ version: VersionView }>(`/api/admin/commercial-policy/versions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!result.ok) return result;
      setNotice({ tone: "ok", text: "Rascunho salvo." });
      return { ok: true };
    });
    if (!ok) throw new Error("save-failed");
  };

  const discard = (id: string) =>
    void run("Descartar", async () => {
      const result = await api<{ version: VersionView }>(`/api/admin/commercial-policy/versions/${id}`, { method: "DELETE" });
      if (!result.ok) return result;
      setEditingId(null);
      setNotice({ tone: "info", text: "Rascunho descartado (aposentado no histórico)." });
      return { ok: true };
    });

  const generatePdf = (version?: VersionView) =>
    void downloadAuthenticatedFile(
      version && version.status !== "DRAFT" ? `/api/commercial-policy/versions/${version.id}/document` : "/api/admin/commercial-policy/official/pol-com-001/document",
      version ? `POL-COM-001-v${version.label}-copia-controlada.pdf` : "POL-COM-001-v1.0-copia-controlada.pdf"
    ).catch((error: unknown) => setNotice({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível gerar a cópia controlada." }));

  // Prévia antes de publicar: o Anexo I mostra os níveis atuais da Formação de Preço.
  const currentCommissionMatrix = policyCommissionMatrixFromSnapshot(integrity?.currentSnapshot);

  const previewBlockerCount =
    integrity && integrity.publicationStatus !== "PUBLISHED" ? integrity.findings.filter((item) => item.severity === "BLOCKING").length : 0;

  const openOfficialPreview = () => {
    setPreviewDoc({ chapters: null, title: doc?.title ?? "", label: doc?.versionLabel ?? "1.0", effectiveFrom: published?.effectiveFrom ?? null, publishedAt: published?.publishedAt ?? null, approver: published?.approver ?? null, commissionMatrix: published?.commissionMatrix ?? currentCommissionMatrix, origin: "documento oficial" });
    setPreviewView("admin");
    setPreviewPendingOpen(false);
  };
  const openVersionPreview = (version: VersionView) => {
    const isDraft = version.status === "DRAFT";
    setPreviewDoc({ chapters: parsePolicyChapters(version.content), title: version.title, label: version.label, effectiveFrom: isDraft ? null : version.effectiveFrom, publishedAt: isDraft ? null : version.publishedAt, approver: version.approver ?? null, commissionMatrix: version.commissionMatrix ?? currentCommissionMatrix, origin: `versão ${version.label} (${STATUS_LABEL[version.status] ?? version.status})` });
    setPreviewView("seller");
  };
  const openEditorPreview = (payload: EditorPayload, label: string) => {
    setPreviewDoc({ chapters: parsePolicyChapters(payload.content), title: payload.title, label, effectiveFrom: null, publishedAt: null, approver: null, commissionMatrix: currentCommissionMatrix, origin: "rascunho em edição (não salvo)" });
    setPreviewView("seller");
  };

  const scrollToEditor = () => {
    const pending = rows.find((row) => row.status === "DRAFT");
    if (pending) setEditingId(pending.id);
    document.getElementById("policy-content-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Políticas e aceites</h2>
        <p className="text-xs text-muted-foreground">
          Aqui você publica a POL-COM-001, acompanha o que impede a publicação, edita o conteúdo em rascunhos e vê os aceites. Uma versão publicada é imutável: qualquer correção ou mudança normativa vira nova versão, com snapshot, changeset e novo aceite.
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
        <div className={`rounded-lg border p-3 text-xs ${notice.tone === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : notice.tone === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-border bg-muted/40"}`}>
          <p>{notice.text}</p>
          {notice.findings?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {notice.findings.map((finding) => (
                <li key={finding.code}><span className="font-semibold">{finding.code}</span> — {finding.resolution?.steps[0] ?? finding.action}</li>
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
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={openOfficialPreview}>Visualizar política oficial</button>
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={() => generatePdf()}>Gerar PDF / cópia controlada</button>
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={() => setDivergencesOpen((open) => !open)}>
              {divergencesOpen ? "Ocultar divergências" : "Ver divergências"}
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canPublish}
              title={integrity.publicationStatus === "PUBLISHED" ? "Versão 1.0 já publicada." : blockers > 0 ? `${blockers} pendência(s) impedem a publicação — veja abaixo o que fazer.` : "Publicar a versão 1.0 a partir do documento oficial."}
              onClick={() => setConfirmPublish({ kind: "official" })}
            >
              Publicar versão 1.0
            </button>
          </div>
          <div className="mt-3">
            <PublicationGuide findings={integrity.findings} status={integrity.publicationStatus} onOpenEditor={scrollToEditor} onOpenDivergences={() => setDivergencesOpen(true)} />
          </div>
          {confirmPublish ? (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
              <p className="font-semibold">
                {confirmPublish.kind === "official" ? "Confirmar publicação da POL-COM-001 versão 1.0?" : `Confirmar publicação da versão ${confirmPublish.label}?`}
              </p>
              <p className="mt-1">A versão publicada fica imutável, o snapshot normativo atual é congelado e todos os vendedores precisarão aceitar esta versão no próximo acesso.</p>
              <label className="mt-3 block font-semibold" htmlFor="policy-publish-effective-from">Vigência a partir de</label>
              <input
                id="policy-publish-effective-from"
                type="date"
                required
                min={todayInputValue()}
                value={publishEffectiveFrom}
                onChange={(event) => setPublishEffectiveFrom(event.target.value)}
                className="mt-1 rounded-lg border border-amber-300 bg-white px-2 py-1.5"
              />
              <p className="mt-1 text-slate-700">
                A data de aprovação é a de hoje, registrada em seu nome como aprovação eletrônica. A vigência informada aqui entra na capa, no Anexo I e no termo de ciência de cada vendedor.
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={!publishEffectiveFrom} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50" onClick={() => { const target = confirmPublish; setConfirmPublish(null); if (target.kind === "official") publishOfficial(); else publishVersion(target.id, target.label); }}>Publicar agora</button>
                <button type="button" className="rounded-lg border border-border px-3 py-2 font-semibold" onClick={() => setConfirmPublish(null)}>Cancelar</button>
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
                  {["Código", "Categoria", "Seção", "Documento", "Sistema", "Severidade", "Bloqueia?", "Quem / onde", "Ação necessária"].map((head) => (
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
                    <td className="border-b border-border/60 px-2 py-1"><Badge className={ownerClass(finding.resolution?.owner)}>{finding.resolution?.owner ?? "—"}</Badge><span className="mt-1 block">{finding.resolution?.where ?? "—"}</span></td>
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

      <section id="policy-content-section" className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Conteúdo da política">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Conteúdo da política</h3>
            <p className="text-xs text-muted-foreground">
              Crie um rascunho, edite capítulos, tabelas, regras, declarações e perguntas, visualize como o vendedor verá e publique. Versões publicadas não se editam: duplique-as.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40" disabled={busy} onClick={createFromOfficial}>Novo rascunho a partir da POL-COM-001</button>
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40" disabled={busy} onClick={createBlank}>Novo rascunho em branco</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-muted/60">
              <tr>
                {["Versão", "Situação", "Título", "Vigência", "Publicação", "Conteúdo", "Ações"].map((head) => (
                  <th key={head} className="border-b border-border px-2 py-1 text-left font-bold">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-2 py-3 text-muted-foreground">Nenhuma versão ainda. Comece por "Novo rascunho a partir da POL-COM-001".</td></tr>
              ) : null}
              {rows.map((row) => (
                <tr key={row.id} className={`align-top ${row.id === editingId ? "bg-amber-50" : ""}`}>
                  <td className="border-b border-border/60 px-2 py-1 font-semibold">{row.label} <span className="font-normal text-muted-foreground">#{row.version}</span>{row.official ? <span className="block text-[10px] text-amber-800">documento oficial</span> : null}</td>
                  <td className="border-b border-border/60 px-2 py-1"><Badge className={row.status === "PUBLISHED" ? severityClass(null).replace("bg-muted text-muted-foreground border-border", "bg-emerald-100 text-emerald-900 border-emerald-300") : row.status === "DRAFT" ? "bg-amber-100 text-amber-900 border-amber-300" : severityClass(null)}>{STATUS_LABEL[row.status] ?? row.status}</Badge></td>
                  <td className="border-b border-border/60 px-2 py-1">{row.title}</td>
                  <td className="border-b border-border/60 px-2 py-1">{when(row.effectiveFrom)}</td>
                  <td className="border-b border-border/60 px-2 py-1">{when(row.publishedAt)}</td>
                  <td className="border-b border-border/60 px-2 py-1 text-muted-foreground">{parsePolicyChapters(row.content).length} cap. · {row.questions.length} perg. · {row.declarations.length} decl.</td>
                  <td className="border-b border-border/60 px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className="rounded-md border border-border px-2 py-1 font-semibold" onClick={() => openVersionPreview(row)}>Visualizar</button>
                      {row.status === "DRAFT" ? (
                        <>
                          <button type="button" className="rounded-md border border-border px-2 py-1 font-semibold" onClick={() => setEditingId(row.id)}>Editar</button>
                          <button type="button" className="rounded-md border border-emerald-600 px-2 py-1 font-semibold text-emerald-800" onClick={() => setConfirmPublish({ kind: "version", id: row.id, label: row.label })}>Publicar</button>
                          <button type="button" className="rounded-md border border-red-300 px-2 py-1 font-semibold text-red-800" onClick={() => discard(row.id)}>Descartar</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="rounded-md border border-border px-2 py-1 font-semibold" onClick={() => duplicate(row.id)}>Duplicar como rascunho</button>
                          <button type="button" className="rounded-md border border-border px-2 py-1 font-semibold" onClick={() => generatePdf(row)}>Cópia controlada</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editing && editing.status === "DRAFT" ? (
          <CommercialPolicyVersionEditor
            key={editing.id}
            version={editing}
            busy={busy}
            onSave={(payload) => saveDraft(editing.id, payload)}
            onPreview={(payload) => openEditorPreview(payload, editing.label)}
            onPublish={() => setConfirmPublish({ kind: "version", id: editing.id, label: editing.label })}
            onDiscard={() => discard(editing.id)}
            onClose={() => setEditingId(null)}
          />
        ) : null}
      </section>

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
                    <button type="button" className="rounded-md border border-border px-2 py-1 font-semibold" onClick={() => { setEditingId(integrity.pendingDraft?.id ?? null); document.getElementById("policy-content-section")?.scrollIntoView({ behavior: "smooth" }); }}>
                      Revisar o texto deste rascunho
                    </button>
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
                    <li key={row.versionId}>Versão {row.label} · {STATUS_LABEL[row.status] ?? row.status} · {row.count} aceite(s)</li>
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

      <section className="rounded-xl border border-border bg-card p-4" aria-label="Aceites">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">Aceites registrados</h3>
          {acceptances.length > 0 ? (
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              onClick={() => void resetAcceptances(null)}
            >
              Zerar todos os aceites
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Fase de testes: zerar apaga o aceite (com teste, confirmação de senha e foto) e o vendedor volta a ser obrigado a ler e aceitar no próximo acesso. A ação
          fica registrada no log de segurança e não pode ser desfeita.
        </p>
        {resetTarget ? (
          <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-950" role="alertdialog" aria-label="Zerar aceites" data-testid="policy-reset-acceptances">
            <p className="font-semibold">
              {resetTarget === "ALL" ? `Zerar todos os ${acceptances.length} aceite(s)?` : `Zerar o aceite de ${resetTarget.userNameSnapshot}?`}
            </p>
            <p className="mt-1">O aceite, o teste, a confirmação de senha e a foto são apagados. Não há como desfazer.</p>
            <label className="mt-3 block font-semibold" htmlFor="policy-reset-reason">Motivo</label>
            <input
              id="policy-reset-reason"
              value={resetReason}
              onChange={(event) => setResetReason(event.target.value)}
              placeholder="Ex.: teste do fluxo de aceite"
              className="mt-1 w-full max-w-md rounded-lg border border-red-300 bg-white px-2 py-1.5"
            />
            {resetTarget === "ALL" ? (
              <>
                <label className="mt-3 block font-semibold" htmlFor="policy-reset-confirmation">Digite {RESET_ALL_CONFIRMATION} para confirmar</label>
                <input
                  id="policy-reset-confirmation"
                  value={resetConfirmation}
                  onChange={(event) => setResetConfirmation(event.target.value)}
                  className="mt-1 w-full max-w-md rounded-lg border border-red-300 bg-white px-2 py-1.5"
                />
              </>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy || !resetReason.trim() || (resetTarget === "ALL" && resetConfirmation !== RESET_ALL_CONFIRMATION)}
                className="rounded-lg bg-red-700 px-3 py-2 font-semibold text-white disabled:opacity-50"
                onClick={confirmResetAcceptances}
              >
                Zerar agora
              </button>
              <button type="button" className="rounded-lg border border-border bg-white px-3 py-2 font-semibold text-foreground" onClick={() => setResetTarget(null)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
        <ul className="mt-2 space-y-1 text-xs">
          {acceptances.length === 0 ? <li className="text-muted-foreground">Nenhum aceite registrado.</li> : null}
          {acceptances.map((row) => (
            <li key={row.id} className="break-all">
              {row.userNameSnapshot}{row.userEmailSnapshot ? ` · ${row.userEmailSnapshot}` : ""} · {when(row.acceptedAt)} · versão {rows.find((version) => version.id === row.policyVersionId)?.label ?? "—"} · {row.id} · evidência {short(row.evidenceHash)}
              {" "}
              <button type="button" className="font-semibold text-primary" onClick={() => void downloadAuthenticatedFile(`/api/commercial-policy/acceptances/${row.id}/receipt`, `certificado-de-aceite-${row.id}.pdf`)}>
                certificado
              </button>
              {" · "}
              <button type="button" disabled={busy} className="font-semibold text-red-700 disabled:opacity-50" onClick={() => void resetAcceptances(row)}>
                zerar aceite
              </button>
            </li>
          ))}
        </ul>
      </section>

      {previewDoc ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/95" role="dialog" aria-modal="true" aria-label="Prévia da política">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 text-slate-100">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge className="border-amber-400 bg-amber-400/15 text-amber-200">ÁREA ADMINISTRATIVA · SUPER_ADMIN</Badge>
              <p className="truncate text-sm font-bold">Prévia · {previewDoc.origin} · versão {previewDoc.label}</p>
              {integrity ? <Badge className={statusClass(integrity.publicationStatus)}>{PUBLICATION_LABEL[integrity.publicationStatus]}</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-600 p-0.5 text-xs font-semibold" role="tablist" aria-label="Modo da prévia">
                <button type="button" role="tab" aria-selected={previewView === "admin"} className={`rounded-md px-3 py-1.5 ${previewView === "admin" ? "bg-slate-100 text-slate-900" : "text-slate-200 hover:bg-slate-800"}`} onClick={() => setPreviewView("admin")}>Visão do administrador</button>
                <button type="button" role="tab" aria-selected={previewView === "seller"} className={`rounded-md px-3 py-1.5 ${previewView === "seller" ? "bg-slate-100 text-slate-900" : "text-slate-200 hover:bg-slate-800"}`} onClick={() => setPreviewView("seller")}>Como o vendedor verá</button>
              </div>
              {previewView === "admin" && integrity ? (
                <button
                  type="button"
                  aria-expanded={previewPendingOpen}
                  aria-controls="policy-preview-pending"
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${previewPendingOpen ? "border-slate-100 bg-slate-100 text-slate-900" : "border-slate-600 text-slate-100 hover:bg-slate-800"}`}
                  onClick={() => setPreviewPendingOpen((open) => !open)}
                >
                  {previewBlockerCount > 0 ? "Pendências para publicar" : "Situação da publicação"}
                  {previewBlockerCount > 0 ? (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">{previewBlockerCount}</span>
                  ) : null}
                </button>
              ) : null}
              <button type="button" className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-800" onClick={() => generatePdf()}>Gerar PDF / cópia controlada</button>
              <button type="button" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900" onClick={() => setPreviewDoc(null)}>Fechar prévia</button>
            </div>
          </div>
          {/* Tela cheia: o documento ocupa tudo; as pendências ficam num painel lateral que abre sob demanda. */}
          <div className="relative flex min-h-0 flex-1 bg-background">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {previewView === "admin" ? (
                <CommercialPolicyReader fluid mode="preview" chapters={previewDoc.chapters ?? undefined} title={previewDoc.title} versionLabel={previewDoc.label} effectiveFrom={previewDoc.effectiveFrom} publishedAt={previewDoc.publishedAt} approver={previewDoc.approver} commissionMatrix={previewDoc.commissionMatrix} onGeneratePdf={() => generatePdf()} />
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
                      <li key={step} className={`rounded-full border px-2 py-0.5 ${stepIndex === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>{stepIndex + 1}. {step}</li>
                    ))}
                  </ol>
                  {sellerFinishNotice ? (
                    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950">
                      No vendedor, "Concluir leitura" avança para a Etapa 2 — Principais regras; depois vêm o teste de compreensão (100% de acerto), as declarações, a reautenticação por senha, o registro visual e a assinatura, que gera o comprovante com SHA-256. Nesta simulação nada foi registrado.
                      {" "}
                      <button type="button" className="font-semibold underline" onClick={() => setSellerFinishNotice(false)}>Entendi</button>
                    </div>
                  ) : null}
                  <CommercialPolicyReader fluid mode="acceptance" chapters={previewDoc.chapters ?? undefined} title={previewDoc.title} versionLabel={previewDoc.label} effectiveFrom={previewDoc.effectiveFrom} publishedAt={previewDoc.publishedAt} approver={previewDoc.approver} commissionMatrix={previewDoc.commissionMatrix} onGeneratePdf={() => generatePdf()} onFinish={() => setSellerFinishNotice(true)} />
                </>
              )}
            </div>
            {previewView === "admin" && integrity && previewPendingOpen ? (
              <aside
                id="policy-preview-pending"
                aria-label="Pendências para publicar"
                className="absolute inset-y-0 right-0 z-10 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl xl:static xl:w-[30rem] xl:max-w-none xl:shadow-none"
              >
                <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0 text-xs">
                    <p className="text-sm font-bold">{previewBlockerCount > 0 ? "Pendências para publicar" : "Situação da publicação"}</p>
                    <p className="mt-0.5 text-muted-foreground">Esta prévia não gera aceite, não registra leitura e não publica.</p>
                    <p className="text-muted-foreground">SHA-256 {short(doc?.contentHash)}</p>
                  </div>
                  <button type="button" className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted" onClick={() => setPreviewPendingOpen(false)}>Fechar painel</button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  <PublicationGuide stacked findings={integrity.findings} status={integrity.publicationStatus} onOpenEditor={() => { setPreviewDoc(null); scrollToEditor(); }} onOpenDivergences={() => { setPreviewDoc(null); setDivergencesOpen(true); }} />
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
