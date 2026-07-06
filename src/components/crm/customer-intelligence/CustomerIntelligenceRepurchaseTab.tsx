import React from "react";
import { REPURCHASE_STATUS_LABEL_PT } from "@/src/lib/customerIntelligenceNavigation";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";

function formatDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)} dia(s)`;
}

function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function CustomerIntelligenceRepurchaseTab({ report }: { report: CustomerIntelligenceReport }) {
  const repurchase = report.repurchase;

  if (repurchase.status === "INSUFICIENTE") {
    return (
      <div className="customer-intelligence-tab-panel rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <p className="font-semibold">Histórico insuficiente para previsão de recompra</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
          {repurchase.detail ??
            "São necessários ao menos dois pedidos válidos para estimar o intervalo típico entre compras."}
        </p>
      </div>
    );
  }

  return (
    <div className="customer-intelligence-tab-panel space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold">Janela de recompra</h2>
        <p className="text-lg font-bold mt-2">
          {REPURCHASE_STATUS_LABEL_PT[repurchase.status] ?? repurchase.status}
        </p>
        {repurchase.detail ? (
          <p className="text-sm text-muted-foreground mt-1">{repurchase.detail}</p>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-3 py-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Mediana entre pedidos</p>
          <p className="text-lg font-bold mt-1">{formatDays(repurchase.medianDaysBetweenOrders)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Média entre pedidos</p>
          <p className="text-lg font-bold mt-1">{formatDays(repurchase.averageDaysBetweenOrders)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Próxima compra estimada</p>
          <p className="text-lg font-bold mt-1">{formatDatePt(repurchase.estimatedNextPurchaseDate)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Dias além do esperado</p>
          <p className="text-lg font-bold mt-1">{formatDays(repurchase.daysOverExpected)}</p>
        </div>
      </div>

      {repurchase.confidence ? (
        <p className="text-xs text-muted-foreground">
          Confiança da estimativa:{" "}
          {repurchase.confidence === "high"
            ? "Alta"
            : repurchase.confidence === "medium"
              ? "Média"
              : "Baixa"}
        </p>
      ) : null}
    </div>
  );
}
