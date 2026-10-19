import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertOctagon, CalendarClock, CalendarRange, Download, ExternalLink, FileStack, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { type EpiDueBand, type EpiReplacementRow } from "@/src/lib/epi/epiRules";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { EpiDueBadge, formatIsoDay } from "./epiUi";
import { EpiBatchUploadModal } from "./EpiBatchUploadModal";

type Summary = {
  todayIso: string;
  windowDays: number;
  counts: Record<EpiDueBand, number>;
  employeesWithPending: number;
  rows: EpiReplacementRow[];
  departments: Array<{ id: string; label: string }>;
};

type BandFilter = "" | EpiDueBand;

/** Dashboard de Pessoas › Controle de EPIs e Uniformes (trocas vencidas e nos próximos 60 dias). */
export function EpiReplacementsSection({ canManage = false }: { canManage?: boolean }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [band, setBand] = useState<BandFilter>("");
  const [department, setDepartment] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchJsonOk<Summary>("/api/employees/epi-replacements", { cache: "no-store" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o controle de EPIs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => (!band || r.band === band) && (!department || r.departmentId === department)),
    [data, band, department]
  );
  const open = (employeeId: string) => navigate(`/employees?edit=${encodeURIComponent(employeeId)}&tab=epi`);

  const chip = (value: BandFilter, label: string, count?: number) => (
    <button
      key={value || "all"}
      type="button"
      onClick={() => setBand(value)}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-semibold",
        band === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
      )}
      aria-pressed={band === value}
    >
      {label}
      {count != null ? ` (${count})` : ""}
    </button>
  );

  return (
    <SalesOrderKpiSection
      testId="employees-dashboard-epi"
      title="Controle de EPIs e Uniformes"
      subtitle={
        data
          ? `Trocas vencidas e previstas até ${formatIsoDay(addDays(data.todayIso, data.windowDays))} · cada pendência é uma entrega vigente (um colaborador pode ter várias) · ${data.employeesWithPending} colaborador(es)`
          : "Trocas vencidas e previstas para os próximos 60 dias"
      }
    >
      <SummaryKpiGrid minColumnWidth={168} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Vencidos"
          amount={loading ? null : data?.counts.OVERDUE ?? 0}
          amountFormat="number"
          tone="danger"
          icon={AlertOctagon}
          helperText="Entregas vigentes com troca prevista antes de hoje"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Vencem em até 30 dias"
          amount={loading ? null : data?.counts.DUE_30 ?? 0}
          amountFormat="number"
          tone="warning"
          icon={CalendarClock}
          helperText="De hoje até 30 dias (inclusive)"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Vencem entre 31 e 60 dias"
          amount={loading ? null : data?.counts.DUE_60 ?? 0}
          amountFormat="number"
          tone="info"
          icon={CalendarRange}
          helperText="De 31 a 60 dias a partir de hoje"
          loading={loading}
        />
      </SummaryKpiGrid>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {chip("", "Todos", data?.rows.length)}
          {chip("OVERDUE", "Vencidos", data?.counts.OVERDUE)}
          {chip("DUE_30", "Até 30 dias", data?.counts.DUE_30)}
          {chip("DUE_60", "De 31 a 60 dias", data?.counts.DUE_60)}
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            aria-label="Filtrar por departamento"
          >
            <option value="">Todos os departamentos</option>
            {(data?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          {canManage ? (
            <button
              type="button"
              onClick={() => setBatchOpen(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
              data-testid="epi-batch-open"
            >
              <FileStack className="h-3.5 w-3.5" /> Anexar fichas assinadas em lote
            </button>
          ) : null}
          <a
            href="/api/employees/epi-deliveries/export"
            className={cn(canManage ? "" : "ml-auto", "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted")}
            data-testid="epi-export"
          >
            <Download className="h-3.5 w-3.5" /> Exportar entregas (CSV)
          </a>
        </div>

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <div className="relative overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-sm" data-testid="epi-replacements-grid">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Colaborador</th>
                <th className="px-3 py-2">Setor</th>
                <th className="px-3 py-2">EPI / Uniforme</th>
                <th className="px-3 py-2">Última entrega</th>
                <th className="px-3 py-2">Próxima troca</th>
                <th className="px-3 py-2 text-right">Dias restantes</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    {data?.rows.length ? "Nenhuma pendência com estes filtros." : "Nenhuma troca vencida ou prevista para os próximos 60 dias."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.deliveryId}
                    className="cursor-pointer border-t border-border/70 hover:bg-muted/40"
                    onClick={() => open(r.employeeId)}
                    data-testid="epi-replacement-row"
                    data-band={r.band}
                  >
                    <td className="px-3 py-2 font-medium">{r.employeeName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.departmentName ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.itemCode ? <span className="mr-1 font-mono text-xs text-muted-foreground">{r.itemCode}</span> : null}
                      {r.itemDescription}
                      {r.quantity > 1 ? <span className="text-xs text-muted-foreground"> · qtd. {r.quantity}</span> : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatIsoDay(r.deliveredOn)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatIsoDay(r.replacementDueDate)}</td>
                    <td className={cn("px-3 py-2 text-right font-semibold", r.daysLeft < 0 ? "text-rose-700" : "")}>{r.daysLeft}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <EpiDueBadge band={r.band} daysLeft={r.daysLeft} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(r.employeeId);
                        }}
                      >
                        Abrir colaborador <ExternalLink className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {batchOpen ? <EpiBatchUploadModal open onClose={() => setBatchOpen(false)} onDone={() => void load()} /> : null}
    </SalesOrderKpiSection>
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
