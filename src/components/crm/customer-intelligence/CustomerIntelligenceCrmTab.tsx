import React from "react";
import { ExternalLink } from "lucide-react";
import type {
  CustomerIntelligenceRelationshipStatus,
  CustomerIntelligenceReport,
} from "@/src/lib/customerIntelligenceTypes";

const RELATIONSHIP_STATUS_LABELS: Record<CustomerIntelligenceRelationshipStatus, string> = {
  ativo: "Ativo",
  sem_contato_recente: "Sem contato recente",
  tarefa_vencida: "Tarefa vencida",
  reativacao: "Reativação",
  sem_historico: "Sem histórico",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.floor(value))} dia(s)`;
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 shadow-sm min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </p>
      <p className="text-lg font-bold mt-1 truncate" title={value}>
        {value}
      </p>
      {hint ? <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: CustomerIntelligenceRelationshipStatus }) {
  const tone =
    status === "ativo"
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : status === "tarefa_vencida"
        ? "bg-red-100 text-red-900 border-red-200"
        : status === "reativacao"
          ? "bg-amber-100 text-amber-900 border-amber-200"
          : status === "sem_contato_recente"
            ? "bg-orange-100 text-orange-900 border-orange-200"
            : "bg-muted text-muted-foreground border-border";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}
    >
      {RELATIONSHIP_STATUS_LABELS[status]}
    </span>
  );
}

export function CustomerIntelligenceCrmTab({ report }: { report: CustomerIntelligenceReport }) {
  const crm = report.crm;
  const isEmpty = crm.relationshipStatus === "sem_historico" && crm.activities.length === 0;

  return (
    <div className="customer-intelligence-tab-panel space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">CRM / Relacionamento</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Histórico comercial a partir de CommercialActivity — contato explícito via contactDate.
          </p>
        </div>
        <StatusBadge status={crm.relationshipStatus} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Responsável" value={crm.commercialOwner ?? "—"} />
        <KpiCard
          label="Último contato"
          value={formatDateTime(crm.lastContactAt)}
          hint={crm.daysSinceLastContact != null ? `${formatDays(crm.daysSinceLastContact)} atrás` : undefined}
        />
        <KpiCard label="Próxima tarefa" value={formatDateTime(crm.nextTaskAt)} />
        <KpiCard label="Tarefas abertas" value={String(crm.openTasksCount)} />
        <KpiCard
          label="Tarefas vencidas"
          value={String(crm.overdueTasksCount)}
          hint={crm.overdueTasksCount > 0 ? "Priorizar follow-up" : undefined}
        />
      </div>

      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
          <p className="font-semibold">Sem histórico de CRM para este cliente</p>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
            Nenhuma atividade comercial registrada. Registre contatos e follow-ups no CRM Comercial.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-bold mb-3">Timeline de atividades</h3>
            {crm.activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Atividades sem dados de timeline disponíveis.
              </p>
            ) : (
              <ol className="space-y-3 border-l-2 border-border pl-4">
                {crm.activities.map((activity) => (
                  <li key={activity.id} className="relative">
                    <span className="absolute -left-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {formatDateTime(activity.contactDate ?? activity.createdAt)}
                      </span>
                      <span className="text-xs rounded bg-muted px-1.5 py-0.5 font-medium">
                        {activity.activityType}
                      </span>
                      {activity.isOverdue ? (
                        <span className="text-xs font-semibold text-red-700">Vencida</span>
                      ) : null}
                    </div>
                    <p className="text-sm font-semibold mt-0.5">
                      {activity.subject?.trim() || activity.description?.trim() || "Atividade comercial"}
                    </p>
                    {activity.outcome ? (
                      <p className="text-xs text-muted-foreground mt-0.5">{activity.outcome}</p>
                    ) : null}
                    {activity.nextActionAt ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        Próxima ação: {formatDateTime(activity.nextActionAt)}
                        {activity.nextActionDescription ? ` — ${activity.nextActionDescription}` : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
            <h3 className="text-sm font-bold mb-3">Tarefas abertas</h3>
            {crm.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma tarefa com data agendada.</p>
            ) : (
              <table className="w-full text-sm border-collapse min-w-[28rem]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">Vencimento</th>
                    <th className="py-2 pr-3 font-semibold">Assunto</th>
                    <th className="py-2 pr-3 font-semibold">Responsável</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {crm.tasks.map((task) => (
                    <tr key={task.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatDateTime(task.nextActionAt)}
                        {task.isOverdue ? (
                          <span className="ml-1 text-xs font-semibold text-red-700">Vencida</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        {task.subject?.trim() || task.nextActionDescription?.trim() || "—"}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{task.assignedTo ?? "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{task.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {crm.notes.length > 0 ? (
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-bold mb-3">Observações</h3>
              <ul className="space-y-2">
                {crm.notes.map((note, idx) => (
                  <li key={idx} className="text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <p>{note.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {note.source === "profile" ? "Perfil CRM" : "Atividade"}
                      {note.recordedAt ? ` · ${note.recordedAt}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold mb-3">Ações</h3>
        <div className="flex flex-wrap gap-2">
          {crm.actions.map((action) =>
            action.kind === "link" && action.href ? (
              <a
                key={action.id}
                href={action.href}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-accent/50"
              >
                {action.label}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <button
                key={action.id}
                type="button"
                disabled
                title={action.reason ?? undefined}
                className="inline-flex items-center rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-sm font-semibold text-muted-foreground cursor-not-allowed opacity-70"
              >
                {action.label}
              </button>
            )
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-muted/15 px-4 py-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground mb-1">Origem dos dados</p>
        <p>Fontes: {crm.dataQuality.sources.join(", ") || "—"}</p>
        {crm.dataQuality.warnings.length > 0 ? (
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {crm.dataQuality.warnings.map((warning, idx) => (
              <li key={idx}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1">
          Última atividade registrada: {formatDateTime(crm.lastActivityAt)} · Atividades carregadas:{" "}
          {crm.dataQuality.activitiesLoaded}
        </p>
      </section>
    </div>
  );
}
