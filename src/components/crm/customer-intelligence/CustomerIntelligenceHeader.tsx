import React from "react";
import { AlertTriangle, Building2, Calendar, MapPin, User } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  COMMERCIAL_CLASSIFICATION_LABEL_PT,
  FINANCIAL_STATUS_LABEL_PT,
  HEALTH_CLASSIFICATION_LABEL_PT,
} from "@/src/lib/customerIntelligenceNavigation";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";

function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return "Não informado";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Não informado";
  return d.toLocaleDateString("pt-BR");
}

function commercialHealthBadge(report: CustomerIntelligenceReport): {
  label: string;
  className: string;
} {
  const health = report.scoring.healthClassification;
  const label = HEALTH_CLASSIFICATION_LABEL_PT[health] ?? health;
  if (health === "risco" || health === "inativo") {
    return { label, className: "bg-red-100 text-red-900 border-red-200" };
  }
  if (health === "atencao") {
    return { label, className: "bg-amber-100 text-amber-900 border-amber-200" };
  }
  if (health === "historico_insuficiente") {
    return { label, className: "bg-muted text-muted-foreground border-border" };
  }
  if (health === "excelente") {
    return { label, className: "bg-emerald-100 text-emerald-900 border-emerald-200" };
  }
  return { label, className: "bg-sky-100 text-sky-900 border-sky-200" };
}

export function CustomerIntelligenceHeader({
  report,
  className,
}: {
  report: CustomerIntelligenceReport;
  className?: string;
}) {
  const { customer } = report;
  const health = commercialHealthBadge(report);
  const financialStatus = report.financial.linkedByCnpj
    ? FINANCIAL_STATUS_LABEL_PT[report.financial.financialStatus]
    : null;
  const location = [customer.city, customer.state].filter(Boolean).join(" / ") || "Não informado";

  return (
    <header
      className={cn(
        "customer-intelligence-header rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm space-y-4",
        className
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-xl bg-primary/10 p-3 text-primary shrink-0">
            <Building2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight break-words">{customer.name}</h1>
            {customer.legalName !== customer.name ? (
              <p className="text-sm text-muted-foreground">{customer.legalName}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  health.className
                )}
              >
                {health.label}
              </span>
              {financialStatus ? (
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold">
                  {financialStatus}
                </span>
              ) : null}
              <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-semibold">
                Score {report.scoring.score}
              </span>
              <span className="text-xs text-muted-foreground">
                {COMMERCIAL_CLASSIFICATION_LABEL_PT[report.scoring.commercialClassification]}
              </span>
              {customer.region ? (
                <span className="text-xs text-muted-foreground">Região: {customer.region}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Código / CNPJ</dt>
          <dd className="font-medium mt-0.5 break-all">{customer.code ?? customer.cnpj ?? "Não informado"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cidade / UF</dt>
          <dd className="font-medium mt-0.5 flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {location}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cadastro</dt>
          <dd className="font-medium mt-0.5 flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {formatDatePt(customer.registrationDate)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Responsável</dt>
          <dd className="font-medium mt-0.5 flex items-center gap-1">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {customer.commercialOwner ?? "Não informado"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Primeira compra</dt>
          <dd className="font-medium mt-0.5">{formatDatePt(customer.firstOrderDate)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Última compra</dt>
          <dd className="font-medium mt-0.5">{formatDatePt(customer.lastOrderDate)}</dd>
        </div>
      </dl>
    </header>
  );
}

export function CustomerIntelligenceAlerts({
  report,
}: {
  report: CustomerIntelligenceReport;
}) {
  const items = report.opportunities.filter((o) => o.type === "RISK" || o.priorityScore >= 55).slice(0, 6);
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <h2 className="text-sm font-bold flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        Alertas e sinais comerciais
      </h2>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li
            key={`${item.title}-${idx}`}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              item.type === "RISK"
                ? "border-red-200 bg-red-50/80 text-red-950"
                : item.type === "OPPORTUNITY"
                  ? "border-emerald-200 bg-emerald-50/80 text-emerald-950"
                  : "border-border bg-background"
            )}
          >
            <span className="font-semibold">{item.title}</span>
            <span className="text-muted-foreground"> — {item.description}</span>
            <p className="text-xs mt-1 font-medium">Ação: {item.suggestedAction}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
