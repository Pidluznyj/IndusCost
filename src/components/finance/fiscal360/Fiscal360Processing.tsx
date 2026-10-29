import React, { useState } from "react";
import { FISCAL360_AP_RULES_KEY, FISCAL360_COMPANIES, FISCAL360_REFORM_KEY, FISCAL360_TAX_PARAMS_KEY } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { formatFiscal360DateTime, postFiscal360, type Fiscal360Capabilities } from "@/src/lib/finance/fiscal360/fiscal360Client";
import type { Fiscal360ProcessingResponse } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { Badge, ButtonLike, Callout, DataTable, ErrorState, KpiCard, KpiGrid, LoadingState, Section, statusTone } from "./Fiscal360Shared";
import { useFiscal360Resource } from "./useFiscal360Resource";

type RuleRow = {
  id: string;
  ruleKey: string;
  version: number;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  normativeSource: string | null;
  description: string | null;
  parameters: unknown;
  createdByName: string | null;
  createdAt: string;
};

const RULE_LABELS: Record<string, string> = {
  [FISCAL360_AP_RULES_KEY]: "Classificador de títulos AP",
  [FISCAL360_TAX_PARAMS_KEY]: "Parâmetros tributários por CNPJ (projeção)",
  [FISCAL360_REFORM_KEY]: "Reforma tributária (IBS/CBS/IS)",
};

const RULE_TEMPLATES: Record<string, string> = {
  [FISCAL360_AP_RULES_KEY]: JSON.stringify({ rules: [{ id: "r1", field: "classification", match: "equals", value: "IMPOSTOS FEDERAIS - COFINS", outcome: "TAX", taxType: "COFINS" }] }, null, 2),
  [FISCAL360_TAX_PARAMS_KEY]: JSON.stringify({ items: [{ companyCnpj: "", taxType: "PIS", rate: 0, creditRate: null, purchasesMonthly: null }] }, null, 2),
  [FISCAL360_REFORM_KEY]: JSON.stringify({ notes: "Descreva a regra, a vigência e a situação de exigibilidade.", rates: [] }, null, 2),
};

function ReprocessForm({ onDone }: { onDone: (msg: string) => void }) {
  const [scope, setScope] = useState("PARTITIONS");
  const [companyCnpj, setCompanyCnpj] = useState("");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [ids, setIds] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await postFiscal360<{ requested: number; enqueued: number }>("reprocess", {
        scope,
        companyCnpj: companyCnpj || null,
        fromMonth: fromMonth || null,
        toMonth: toMonth || fromMonth || null,
        ids: ids.split(/[\s,;]+/).filter(Boolean),
        reason,
      });
      onDone(`${res.enqueued} job(s) enfileirado(s) de ${res.requested} solicitado(s). O worker/CLI processa fora desta requisição.`);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao solicitar reprocessamento.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2" data-testid="fiscal360-reprocess-form">
      <div className="flex flex-wrap gap-2">
        <select className={field} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Escopo">
          <option value="PARTITIONS">Competências (conciliação + snapshot)</option>
          <option value="DOCUMENTS">Documentos (NF-e)</option>
          <option value="AP_TITLES">Títulos AP</option>
          <option value="GUIDES">Guias</option>
          <option value="FORECAST">Projeções</option>
        </select>
        {scope === "PARTITIONS" ? (
          <>
            <select className={field} value={companyCnpj} onChange={(e) => setCompanyCnpj(e.target.value)} aria-label="Empresa">
              <option value="">Todas as empresas</option>
              {FISCAL360_COMPANIES.map((c) => (
                <option key={c.cnpj} value={c.cnpj}>
                  {c.shortName}
                </option>
              ))}
            </select>
            <input type="month" className={field} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} aria-label="De" required />
            <input type="month" className={field} value={toMonth} onChange={(e) => setToMonth(e.target.value)} aria-label="Até" />
          </>
        ) : scope !== "FORECAST" ? (
          <input className={`${field} min-w-[220px] flex-1`} placeholder="Identificadores separados por vírgula (máx. 500)" value={ids} onChange={(e) => setIds(e.target.value)} required />
        ) : null}
      </div>
      <textarea className={`${field} w-full`} rows={2} minLength={10} required placeholder="Motivo (fica na auditoria)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error ? <ErrorState message={error} /> : null}
      <ButtonLike type="submit" variant="primary" disabled={busy || reason.trim().length < 10}>
        {busy ? "Enfileirando…" : "Solicitar reprocessamento seletivo"}
      </ButtonLike>
    </form>
  );
}

function RulesPanel({ canManage, refreshKey }: { canManage: boolean; refreshKey: number }) {
  const { data, error, reload } = useFiscal360Resource<RuleRow[]>("rules", "", refreshKey);
  const [ruleKey, setRuleKey] = useState<string>(FISCAL360_AP_RULES_KEY);
  const [json, setJson] = useState(RULE_TEMPLATES[FISCAL360_AP_RULES_KEY]!);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [normativeSource, setNormativeSource] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const field = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";
  async function create() {
    setMsg(null);
    try {
      await postFiscal360("rules", { ruleKey, parameters: JSON.parse(json), effectiveFrom: effectiveFrom || null, normativeSource: normativeSource || null });
      setMsg("Versão criada como rascunho. Ative para que o processador reprocesse apenas o que depende dela.");
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "JSON ou parâmetros inválidos.");
    }
  }
  async function act(id: string, action: "activate" | "retire") {
    setMsg(null);
    try {
      await postFiscal360(`rules/${id}/${action}`, {});
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Falha.");
    }
  }
  return (
    <Section title="Regras versionadas" subtitle="Mudança de regra do classificador reprocessa só títulos AP; parâmetros tributários só a projeção. Nenhum XML é reinterpretado.">
      {error ? <ErrorState message={error} /> : null}
      <DataTable
        rows={data ?? []}
        rowKey={(r) => r.id}
        empty="Nenhuma regra configurada (o classificador usa apenas evidências fortes embutidas)."
        columns={[
          { key: "k", header: "Regra", render: (r) => <b>{RULE_LABELS[r.ruleKey] ?? r.ruleKey}</b> },
          { key: "v", header: "Versão", render: (r) => `v${r.version}` },
          { key: "s", header: "Situação", render: (r) => <Badge tone={r.status === "ACTIVE" ? "good" : r.status === "DRAFT" ? "warn" : "neutral"}>{r.status}</Badge> },
          { key: "vig", header: "Vigência", render: (r) => `${r.effectiveFrom ?? "—"}${r.effectiveTo ? ` a ${r.effectiveTo}` : ""}` },
          { key: "f", header: "Fonte normativa", render: (r) => r.normativeSource ?? "—" },
          { key: "u", header: "Criada", render: (r) => `${formatFiscal360DateTime(r.createdAt)} · ${r.createdByName ?? "—"}` },
          {
            key: "a",
            header: "",
            render: (r) =>
              canManage ? (
                r.status === "DRAFT" ? (
                  <ButtonLike variant="quiet" onClick={() => act(r.id, "activate")}>Ativar</ButtonLike>
                ) : r.status === "ACTIVE" ? (
                  <ButtonLike variant="danger" onClick={() => act(r.id, "retire")}>Aposentar</ButtonLike>
                ) : null
              ) : null,
          },
        ]}
      />
      {canManage ? (
        <div className="mt-3 space-y-2 rounded-md border border-[#E5E7EB] p-3">
          <div className="flex flex-wrap gap-2">
            <select
              className={field}
              value={ruleKey}
              onChange={(e) => {
                setRuleKey(e.target.value);
                setJson(RULE_TEMPLATES[e.target.value] ?? "{}");
              }}
              aria-label="Regra"
            >
              {Object.entries(RULE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input type="date" className={field} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} aria-label="Início de vigência" />
            <input className={`${field} min-w-[200px] flex-1`} placeholder="Fonte normativa (lei, IN, ato)" value={normativeSource} onChange={(e) => setNormativeSource(e.target.value)} />
          </div>
          <textarea className={`${field} w-full font-mono`} rows={6} value={json} onChange={(e) => setJson(e.target.value)} aria-label="Parâmetros (JSON)" />
          <ButtonLike variant="primary" onClick={create}>Criar versão (rascunho)</ButtonLike>
        </div>
      ) : null}
      {msg ? <div className="mt-2"><Callout>{msg}</Callout></div> : null}
    </Section>
  );
}

export function Fiscal360Processing({ refreshKey, caps }: { refreshKey: number; caps: Fiscal360Capabilities }) {
  const { data, loading, error, reload } = useFiscal360Resource<Fiscal360ProcessingResponse>("processing", "", refreshKey);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorState message={error} />;
  if (!data) return loading ? <LoadingState /> : null;
  const f = data.freshness;
  const byType = (type: string) => data.jobsByStatus.filter((j) => j.jobType === type);
  const health = [
    ["MATERIALIZE_DOCUMENT", "NF-e fiscais"],
    ["MATERIALIZE_AP_TITLE", "Títulos e baixas de AP"],
    ["MATERIALIZE_GUIDE", "Guias e conciliações"],
    ["REBUILD_PARTITION", "Snapshots por competência"],
    ["REBUILD_FORECAST", "Projeções"],
  ] as const;
  const jobAction = async (id: string, action: "retry" | "cancel") => {
    try {
      await postFiscal360(`jobs/${id}/${action}`, {});
      setMsg(action === "retry" ? "Job reenfileirado." : "Job cancelado.");
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Falha.");
    }
  };
  return (
    <div className="space-y-4" data-testid="fiscal360-processing">
      <KpiGrid>
        <KpiCard label="Fila de eventos" value={`${f.pendingJobs} pendente(s)`} hint={`${f.runningJobs} em execução · ${f.failedJobs} com erro`} tone={f.failedJobs > 0 ? "danger" : f.pendingJobs > 0 ? "warn" : "good"} />
        <KpiCard label="Última materialização" value={formatFiscal360DateTime(f.lastSnapshotAt)} hint={`Última execução: ${f.lastRunStatus ?? "—"} em ${formatFiscal360DateTime(f.lastRunAt)}`} />
        <KpiCard label="Defasagem" value={f.lagMinutes == null ? "—" : `${f.lagMinutes} min`} hint={f.oldestPendingAt ? `Job pendente mais antigo: ${formatFiscal360DateTime(f.oldestPendingAt)}` : "Sem pendências"} />
        <KpiCard label="Worker em processo" value={f.workerEnabled ? "Ligado" : "Desligado"} hint={f.workerEnabled ? "Ciclo incremental periódico" : "Execução via CLI autorizado (npm run fiscal360:process)"} tone={f.workerEnabled ? "good" : undefined} />
      </KpiGrid>
      <Callout>O botão “Atualizar” apenas consulta este estado — não recalcula o histórico. O dashboard lê tabelas prontas e indexadas; nenhum XML é interpretado ao abrir a tela.</Callout>
      {msg ? <Callout>{msg}</Callout> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Pipeline incremental">
          <ol className="space-y-3 border-l-2 border-[#DBEAFE] pl-4 text-[12px]">
            {[
              ["1. Descoberta", "Watermark por updatedAt + hash da fonte: só NF-e, títulos, guias e apurações alterados viram job."],
              ["2. Fatos normalizados", "Documento × tributo (XML persistido), título AP classificado, obrigação de pagamento com âncora única."],
              ["3. Conciliação", "Apuração × guia × AP × baixa × comprovante; exceções em fila auditável."],
              ["4. Invalidação seletiva", "Somente empresa × competência afetadas (antiga e nova, em mudança de competência)."],
              ["5. Publicação atômica", "Snapshot da partição publicado numa transação; leitura nunca vê estado parcial."],
            ].map(([t, d]) => (
              <li key={t} className="relative">
                <span className="absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full bg-[#2563EB]" />
                <b>{t}</b>
                <p className="text-[11px] text-[#4B5563]">{d}</p>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Saúde do processamento (7 dias)">
          <ul className="divide-y divide-[#F3F4F6] text-[12px]">
            {health.map(([type, label]) => {
              const rows = byType(type);
              const failed = rows.find((r) => r.status === "FAILED")?.count ?? 0;
              const pending = rows.filter((r) => r.status === "PENDING" || r.status === "RUNNING").reduce((s, r) => s + r.count, 0);
              const ok = rows.find((r) => r.status === "SUCCEEDED")?.count ?? 0;
              return (
                <li key={type} className="flex items-center justify-between py-2">
                  <span>{label}</span>
                  <span className="flex gap-1">
                    <Badge tone="good">{ok} ok</Badge>
                    {pending ? <Badge tone="warn">{pending} na fila</Badge> : null}
                    {failed ? <Badge tone="danger">{failed} erro</Badge> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {data.integrity.length ? (
            <div className="mt-3 space-y-1 text-[11px]" data-testid="fiscal360-integrity">
              {data.integrity.map((i) => (
                <p key={i.label}>
                  <Badge tone={i.ok ? "good" : "warn"}>{i.ok ? "íntegro" : "divergente"}</Badge> {i.label}: {i.source.toLocaleString("pt-BR")} × {i.materialized.toLocaleString("pt-BR")}
                </p>
              ))}
            </div>
          ) : null}
        </Section>
      </div>
      <Section title="Histórico de execução">
        <DataTable
          testId="fiscal360-runs"
          rows={data.runs}
          rowKey={(r) => r.id}
          empty="Nenhuma execução registrada. Rode o backfill controlado (ver roteiro de homologação)."
          columns={[
            { key: "s", header: "Início", render: (r) => formatFiscal360DateTime(r.startedAt) },
            { key: "t", header: "Origem", render: (r) => r.trigger },
            { key: "d", header: "Docs novos / alterados", align: "right", render: (r) => `${r.documentsNew} / ${r.documentsChanged}` },
            { key: "a", header: "AP / guias", align: "right", render: (r) => `${r.apTitlesChanged} / ${r.guidesChanged}` },
            { key: "p", header: "Competências recalculadas", render: (r) => (r.monthsAffected.length ? r.monthsAffected.slice(0, 6).join(", ") + (r.monthsAffected.length > 6 ? "…" : "") : "—") },
            { key: "j", header: "Jobs ok / erro", align: "right", render: (r) => `${r.jobsSucceeded} / ${r.jobsFailed}` },
            { key: "ms", header: "Duração", align: "right", render: (r) => (r.durationMs == null ? "—" : `${(r.durationMs / 1000).toFixed(1)} s`) },
            { key: "st", header: "Resultado", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
          ]}
        />
      </Section>
      {data.failedJobs.length ? (
        <Section title="Jobs com erro">
          <DataTable
            rows={data.failedJobs}
            rowKey={(j) => j.id}
            columns={[
              { key: "t", header: "Tipo", render: (j) => j.jobType },
              { key: "o", header: "Origem", render: (j) => `${j.sourceEntity} ${j.sourceId}` },
              { key: "a", header: "Tentativas", align: "right", render: (j) => j.attempts },
              { key: "e", header: "Último erro", render: (j) => <span className="text-[11px] text-[#B91C1C]">{j.lastError ?? "—"}</span> },
              { key: "x", header: "", render: (j) => (caps.jobs ? <ButtonLike variant="quiet" onClick={() => jobAction(j.id, "retry")}>Reenfileirar</ButtonLike> : null) },
            ]}
          />
        </Section>
      ) : null}
      {caps.reprocess ? (
        <Section title="Reprocessamento seletivo" subtitle="Somente com autorização. Enfileira apenas o escopo informado; nada é recalculado nesta requisição.">
          <ReprocessForm
            onDone={(m) => {
              setMsg(m);
              reload();
            }}
          />
        </Section>
      ) : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Versões de regra em uso">
          <DataTable
            rows={data.ruleVersions}
            rowKey={(r) => `${r.key}-${r.version}`}
            columns={[
              { key: "k", header: "Regra", render: (r) => r.key },
              { key: "v", header: "Versão", render: (r) => r.version },
              { key: "s", header: "Origem", render: (r) => (r.source === "CODE" ? "código" : `config. ${r.status ?? ""}`) },
            ]}
          />
        </Section>
        <Section title="Watermarks de descoberta">
          <DataTable
            rows={data.checkpoints}
            rowKey={(c) => c.key}
            empty="Nenhum checkpoint ainda."
            columns={[
              { key: "k", header: "Fonte", render: (c) => c.key },
              { key: "c", header: "Cursor", render: (c) => formatFiscal360DateTime(c.cursorUpdatedAt) },
              { key: "s", header: "Último sucesso", render: (c) => formatFiscal360DateTime(c.lastSuccessAt) },
            ]}
          />
        </Section>
      </div>
      <RulesPanel canManage={caps.assumptions} refreshKey={refreshKey} />
    </div>
  );
}
