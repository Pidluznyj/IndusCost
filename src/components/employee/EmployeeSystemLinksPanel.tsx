import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  Shield,
} from "lucide-react";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  filterSystemLinkDto,
  type EmployeeSystemLinksAudit,
  type EmployeeSystemLinksDto,
  type SystemLinkCard,
} from "@/src/lib/employeeSystemLinks";

type Props = {
  employeeId: string;
  canUnlinkPerson?: boolean;
  onUnlinkedPerson?: () => void;
};

type Payload = EmployeeSystemLinksDto & {
  audit: EmployeeSystemLinksAudit | null;
};

function AlertBanner({ card }: { card: SystemLinkCard }) {
  if (!card.alert || card.alertTone === "none") return null;
  const conflict = card.alertTone === "conflict";
  return (
    <p
      className={cn(
        "mt-2 flex items-start gap-1.5 text-xs rounded-md px-2 py-1.5",
        conflict
          ? "bg-red-50 text-red-800 border border-red-200"
          : "bg-amber-50 text-amber-900 border border-amber-200"
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>{card.alert}</span>
    </p>
  );
}

function LinkCard({ card }: { card: SystemLinkCard }) {
  return (
    <article className="rounded-lg border border-border bg-background px-3 py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {card.typeLabel}
          </p>
          <p className="font-medium text-foreground truncate">{card.entityLabel}</p>
          {card.entitySubtitle ? (
            <p className="text-xs text-muted-foreground truncate">{card.entitySubtitle}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border",
            card.statusLabel === "Ativo"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : card.statusLabel === "Inativo"
                ? "bg-muted text-muted-foreground border-border"
                : "bg-muted/50 text-muted-foreground border-border"
          )}
        >
          {card.statusLabel}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <div>
          <dt className="uppercase font-semibold text-[10px]">Origem</dt>
          <dd className="text-foreground/80">{card.originLabel}</dd>
        </div>
        <div>
          <dt className="uppercase font-semibold text-[10px]">Data</dt>
          <dd className="text-foreground/80">{card.asOfLabel ?? "—"}</dd>
        </div>
      </dl>
      <AlertBanner card={card} />
      {card.action ? (
        <div className="mt-2">
          {card.action.available && card.action.href ? (
            <Link
              to={card.action.href}
              className="text-xs font-medium text-primary hover:underline"
            >
              {card.action.label}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">
              {card.action.label}
              {card.action.unavailableReason
                ? ` — ${card.action.unavailableReason}`
                : " — sem acesso ao módulo"}
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function EmployeeSystemLinksPanel({
  employeeId,
  canUnlinkPerson,
  onUnlinkedPerson,
}: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showAudit, setShowAudit] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const payload = await fetchJsonOk<Payload>(
          `/api/employees/${employeeId}/system-links`
        );
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar vínculos.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const { audit: _a, ...dto } = data;
    return filterSystemLinkDto(dto, query);
  }, [data, query]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando vínculos no sistema…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-700 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
        {error}
      </p>
    );
  }

  if (!data || !filtered) return null;

  return (
    <div className="space-y-4 text-sm">
      <header className="rounded-lg border border-border bg-muted/20 px-3 py-3 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="font-semibold text-foreground">Vínculos no sistema</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Visão executiva dos papéis desta pessoa — sem IDs técnicos.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered.summary.total} vínculo(s)
            {filtered.summary.withAlert > 0
              ? ` · ${filtered.summary.withAlert} alerta(s)`
              : ""}
          </p>
        </div>
        {data.hasPerson ? (
          <p className="text-xs">
            <span className="text-muted-foreground">Pessoa canônica: </span>
            <span className="font-medium">{data.personDisplayName ?? "—"}</span>
            {data.personStatus ? (
              <span className="text-muted-foreground"> · {data.personStatus}</span>
            ) : null}
            {data.personOrigin ? (
              <span className="text-muted-foreground"> · origem {data.personOrigin}</span>
            ) : null}
          </p>
        ) : (
          <p className="text-xs text-amber-800 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
            Sem pessoa canônica — exibindo apenas hierarquia e acesso locais do colaborador.
          </p>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por tipo, entidade, origem…"
            className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-sm"
          />
        </div>
      </header>

      {filtered.groups.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed border-border px-3 py-6 text-center">
          {filtered.emptyMessage ?? data.emptyMessage ?? "Nenhum vínculo encontrado."}
        </p>
      ) : (
        filtered.groups.map((group) => (
          <section key={group.groupKey} className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {group.groupLabel}
              <span className="ml-1.5 font-normal normal-case">
                ({group.cards.length})
              </span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {group.cards.map((card) => (
                <LinkCard key={card.cardKey} card={card} />
              ))}
            </div>
          </section>
        ))
      )}

      {data.audit ? (
        <div className="rounded-lg border border-border">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/40"
            onClick={() => setShowAudit((v) => !v)}
          >
            {showAudit ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <Shield className="h-3.5 w-3.5" />
            Auditoria técnica
          </button>
          {showAudit ? (
            <div className="border-t border-border px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
              <p className="text-[11px] text-muted-foreground">
                Gerado em{" "}
                {new Date(data.audit.generatedAt).toLocaleString("pt-BR")}
                {data.audit.personId
                  ? ` · personId ${data.audit.personId}`
                  : " · sem personId"}
              </p>
              <ul className="font-mono text-[11px] space-y-0.5 text-muted-foreground">
                {data.audit.technicalRefs.map((r) => (
                  <li key={`${r.cardKey}-${r.entityId}`}>
                    {r.kind} · {r.entityTable} · {r.entityId}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {canUnlinkPerson && data.hasPerson && onUnlinkedPerson ? (
        <button
          type="button"
          disabled={unlinking}
          className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-50 disabled:opacity-60"
          onClick={async () => {
            if (
              !window.confirm(
                "Desvincular este colaborador da pessoa canônica? O histórico do papel RH não é apagado."
              )
            ) {
              return;
            }
            setUnlinking(true);
            try {
              await fetchOk(`/api/employees/${employeeId}/person-link`, {
                method: "DELETE",
              });
              onUnlinkedPerson();
            } catch (e) {
              alert(e instanceof Error ? e.message : "Não foi possível desvincular.");
            } finally {
              setUnlinking(false);
            }
          }}
        >
          {unlinking ? "Desvinculando…" : "Desvincular pessoa canônica"}
        </button>
      ) : null}
    </div>
  );
}
