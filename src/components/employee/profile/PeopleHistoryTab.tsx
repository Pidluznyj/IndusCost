import React from "react";
import {
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Clock,
  TrendingUp,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { ProfileState, formatProfileDate } from "./profileUi";

type HistoryItem = {
  id: string;
  eventLabel: string;
  effectiveDate: string;
  createdAt: string;
  summary: string;
};

function eventVisual(eventLabel: string): { icon: LucideIcon; className: string } {
  if (/reajuste/i.test(eventLabel)) {
    return { icon: TrendingUp, className: "bg-emerald-50 border-emerald-200 text-emerald-700" };
  }
  if (/promoç/i.test(eventLabel)) {
    return { icon: ArrowUp, className: "bg-primary/10 border-primary/25 text-primary" };
  }
  if (/admiss|reativa/i.test(eventLabel)) {
    return { icon: User, className: "bg-muted border-border text-muted-foreground" };
  }
  if (/férias|afastamento|licença|retorno/i.test(eventLabel)) {
    return { icon: CalendarDays, className: "bg-amber-50 border-amber-200 text-amber-700" };
  }
  return { icon: Clock, className: "bg-muted border-border text-muted-foreground" };
}

export function PeopleHistoryTab({
  items,
  loading,
  error,
  nextCursor,
  onLoadMore,
  loadingMore,
}: {
  items: HistoryItem[] | null;
  loading: boolean;
  error: string | null;
  nextCursor?: string | null;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando histórico…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!items || items.length === 0) {
    return <ProfileState kind="empty" message="Histórico ainda não registrado para este colaborador." />;
  }
  return (
    <div className="flex max-w-[880px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-lg font-bold text-foreground">Histórico funcional</h3>
        <p className="text-[13px] text-muted-foreground">
          Linha do tempo completa de movimentações, com data de registro.
        </p>
      </div>

      <ol className="flex flex-col">
        {items.map((item, idx) => {
          const last = idx === items.length - 1;
          const { icon: Icon, className } = eventVisual(item.eventLabel);
          return (
            <li key={item.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-4">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border",
                    className
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                </span>
                {!last ? <span className="w-0.5 flex-1 bg-border" /> : null}
              </div>
              <div
                className={cn(
                  "rounded-xl border border-border bg-background px-5 py-4 shadow-sm",
                  !last && "mb-4"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-bold text-foreground">{item.eventLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    Efetivo em {formatProfileDate(item.effectiveDate)}
                  </span>
                </div>
                {item.summary ? (
                  <p className="mt-1.5 text-[13px] text-foreground">{item.summary}</p>
                ) : null}
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Registrado em {formatProfileDate(item.createdAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {nextCursor && onLoadMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-[13px] font-semibold text-muted-foreground hover:bg-accent disabled:opacity-60"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Carregando…" : "Carregar eventos anteriores"}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
