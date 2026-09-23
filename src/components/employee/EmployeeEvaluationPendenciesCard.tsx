import React, { useEffect, useState } from "react";
import { evaluationTypeShortLabel } from "@/src/lib/hrEvaluation";

type Summary = {
  experience45Pending: number;
  experienceFinalPending: number;
  waitingReturn: number;
  overdue: number;
  items: Array<{
    id: string;
    employeeName: string;
    shortLabel: string;
    dueDate: string | null;
    message: string;
  }>;
};

function formatBr(iso: string | null): string {
  if (!iso) return "sem data";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function EmployeeEvaluationPendenciesCard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/hr/evaluations/operational-summary", {
      credentials: "include",
      signal: ac.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as Summary;
      })
      .then((body) => {
        if (body) setSummary(body);
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, []);

  if (!summary) return null;
  const total =
    summary.experience45Pending + summary.experienceFinalPending + summary.waitingReturn + summary.overdue;
  if (total === 0) return null;

  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      data-testid="employee-evaluation-pendencies"
    >
      <h2 className="text-sm font-semibold">Avaliações de experiência</h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">45 dias pendentes</dt>
          <dd className="text-lg font-semibold">{summary.experience45Pending}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Finais pendentes</dt>
          <dd className="text-lg font-semibold">{summary.experienceFinalPending}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Aguardando retorno</dt>
          <dd className="text-lg font-semibold">{summary.waitingReturn}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Vencidas</dt>
          <dd className="text-lg font-semibold">{summary.overdue}</dd>
        </div>
      </dl>
      {summary.items.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {summary.items.map((item) => (
            <li key={item.id}>
              {item.employeeName} · {item.shortLabel || evaluationTypeShortLabel("EXPERIENCE_45_DAYS")} ·{" "}
              {formatBr(item.dueDate)} · {item.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
