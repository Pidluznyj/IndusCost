import React from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, HelpCircle, Lock, ShieldAlert } from "lucide-react";
import {
  INTELLIGENCE_FACT_LABEL,
  formatCreditDateTime,
  type CommercialCreditIntelligenceView,
} from "@/src/lib/commercial/commercialCreditIntelligenceView";
import { EMPTY_BUREAU_SNAPSHOT, type BureauSnapshot } from "@/src/lib/commercial/creditBureauSnapshot";
import { cn } from "@/src/lib/utils";

/**
 * Painel de crédito da Ficha CNPJ: velocímetro do score externo (estilo bureau), decisão do motor comercial,
 * limite sugerido e indicadores internos, e o estado de cada fonte por tipo de consulta.
 *
 * O score dos provedores (Boa Vista via LIKE SERASA, QUOD) chega sem escala declarada no retorno: o número é
 * sempre exibido como veio, e o velocímetro só o posiciona nas faixas de referência de mercado 0–1000 quando ele
 * cabe nelas — com o aviso visível. A decisão de crédito continua sendo do motor comercial, nunca do score.
 */

export { EMPTY_BUREAU_SNAPSHOT, type BureauSnapshot };

/** Faixas de referência de mercado (0–1000) usadas só para posicionar o ponteiro. */
export const SCORE_REFERENCE_BANDS = [
  { from: 0, to: 300, label: "Risco muito alto", color: "#dc2626" },
  { from: 301, to: 500, label: "Risco alto", color: "#f97316" },
  { from: 501, to: 700, label: "Risco moderado", color: "#eab308" },
  { from: 701, to: 1000, label: "Risco baixo", color: "#16a34a" },
] as const;

export function scoreBand(value: number | null): (typeof SCORE_REFERENCE_BANDS)[number] | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 1000) return null;
  return SCORE_REFERENCE_BANDS.find((band) => value <= band.to) ?? null;
}

type ScoreSource = { provider: string; value: number | null; raw: string | null; detail: string | null; consultedAt: string | null; simulated: boolean };

/** Score principal do painel: Boa Vista (LIKE SERASA) válido; senão QUOD válido; senão nenhum. */
export function pickHeadlineScore(snapshot: BureauSnapshot): ScoreSource | null {
  const bv = snapshot.boaVista;
  if (bv && bv.state === "VALID" && (bv.score != null || bv.scoreRaw)) {
    return {
      provider: bv.simulated ? "Boa Vista · LIKE SERASA (simulação)" : "Boa Vista · LIKE SERASA",
      value: bv.score,
      raw: bv.scoreRaw ?? (bv.score != null ? String(bv.score) : null),
      detail: bv.scoreClass ? `Classe ${bv.scoreClass}` : null,
      consultedAt: bv.consultedAt,
      simulated: bv.simulated,
    };
  }
  const quod = snapshot.quod;
  if (quod && quod.state === "VALID" && quod.score != null) {
    return { provider: "QUOD", value: quod.score, raw: String(quod.score), detail: null, consultedAt: quod.consultedAt, simulated: false };
  }
  return null;
}

const polar = (cx: number, cy: number, r: number, angle: number) => ({
  x: cx + r * Math.cos(angle),
  y: cy - r * Math.sin(angle),
});
// 0 → esquerda (π), 1000 → direita (0).
const angleOf = (value: number) => Math.PI * (1 - Math.min(1000, Math.max(0, value)) / 1000);

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, angleOf(from));
  const b = polar(cx, cy, r, angleOf(to));
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Velocímetro semicircular 0–1000 com as faixas de referência e o ponteiro no score. */
export function ScoreGauge({ score }: { score: ScoreSource | null }) {
  const value = score?.value ?? null;
  const band = scoreBand(value);
  const cx = 120;
  const cy = 118;
  const r = 92;
  // Marcador sobre o arco (estilo bureau): não cruza o número no centro.
  const marker = band && value != null ? polar(cx, cy, r, angleOf(value)) : null;
  return (
    <div className="flex flex-col items-center" data-testid="credit-score-gauge" data-score-band={band?.label ?? "SEM_FAIXA"}>
      <svg viewBox="-14 0 268 132" className="w-full max-w-[280px]" role="img" aria-label={score ? `Score ${score.raw ?? "—"} (${score.provider})` : "Sem score externo"}>
        <path d={arcPath(cx, cy, r, 0, 1000)} stroke="#e2e8f0" strokeWidth={18} fill="none" strokeLinecap="round" />
        {SCORE_REFERENCE_BANDS.map((b) => (
          <path
            key={b.label}
            d={arcPath(cx, cy, r, b.from === 0 ? 0 : b.from - 1, b.to)}
            stroke={b.color}
            strokeWidth={18}
            fill="none"
            opacity={band ? (band.label === b.label ? 1 : 0.28) : 0.18}
          />
        ))}
        {[0, 300, 500, 700, 1000].map((tick) => {
          const p = polar(cx, cy, r + 16, angleOf(tick));
          return (
            <text key={tick} x={p.x} y={p.y + 3} textAnchor="middle" className="fill-slate-400" fontSize={9}>
              {tick}
            </text>
          );
        })}
        {marker && band ? (
          <circle
            cx={marker.x}
            cy={marker.y}
            r={12}
            fill="#ffffff"
            stroke={band.color}
            strokeWidth={5}
            data-testid="credit-score-marker"
          />
        ) : null}
      </svg>
      <p className="-mt-16 text-4xl font-black tabular-nums tracking-tight text-slate-900" data-testid="credit-score-value">
        {score?.raw ?? "—"}
      </p>
      <p
        className="mt-1 rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wide"
        style={band ? { backgroundColor: `${band.color}1f`, color: band.color } : undefined}
        data-testid="credit-score-band"
      >
        {band ? band.label : score ? "Fora da faixa de referência" : "Sem score externo"}
      </p>
      <p className="mt-2 text-center text-[11px] text-slate-500">
        {score ? (
          <>
            {score.provider}
            {score.detail ? ` · ${score.detail}` : ""}
            {score.consultedAt ? ` · ${formatCreditDateTime(score.consultedAt)}` : ""}
          </>
        ) : (
          "Nenhuma consulta de bureau válida. Consulte LIKE SERASA ou o pacote QUOD na aba Consultas externas."
        )}
      </p>
      {score ? (
        <p className="mt-1 max-w-[280px] text-center text-[10px] leading-snug text-slate-400" data-testid="credit-score-scale-note">
          Faixas de referência de mercado 0–1000; o provedor não declara a escala no retorno. Score não decide crédito.
        </p>
      ) : null}
    </div>
  );
}

const TONE: Record<CommercialCreditIntelligenceView["decisionTone"], { ring: string; text: string; chip: string; Icon: typeof Lock }> = {
  critical: { ring: "border-red-500", text: "text-red-800", chip: "bg-red-700 text-white", Icon: ShieldAlert },
  blocked: { ring: "border-red-400", text: "text-red-700", chip: "bg-red-600 text-white", Icon: Lock },
  review: { ring: "border-amber-400", text: "text-amber-800", chip: "bg-amber-500 text-white", Icon: AlertTriangle },
  released: { ring: "border-emerald-400", text: "text-emerald-800", chip: "bg-emerald-600 text-white", Icon: CheckCircle2 },
  undetermined: { ring: "border-slate-300", text: "text-slate-700", chip: "bg-slate-500 text-white", Icon: HelpCircle },
};

function Kpi({ label, value, tone = "default", testId }: { label: string; value: string; tone?: "default" | "danger" | "info"; testId?: string }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl px-3 py-2",
        tone === "danger" ? "bg-red-50" : tone === "info" ? "bg-sky-50" : "bg-slate-50"
      )}
      data-testid={testId}
    >
      <p className={cn("text-[10px] font-bold uppercase tracking-wide", tone === "danger" ? "text-red-700" : tone === "info" ? "text-sky-700" : "text-slate-500")}>{label}</p>
      <p className={cn("truncate text-base font-extrabold tabular-nums", tone === "danger" ? "text-red-950" : "text-slate-900")} title={value}>
        {value}
      </p>
    </div>
  );
}

type SourceRow = { key: string; group: string; label: string; value: string; state: "ok" | "alert" | "pending" | "na" };

const STATE_ICON = {
  ok: <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />,
  alert: <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />,
  pending: <Clock3 className="h-4 w-4 text-amber-500" aria-hidden />,
  na: <CircleDashed className="h-4 w-4 text-slate-400" aria-hidden />,
};

const money = (cents: number | null) =>
  cents == null ? null : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Uma linha por tipo de consulta: interna, bureaus, protestos, cadastral. */
export function bureauSourceRows(
  credit: CommercialCreditIntelligenceView | null,
  creditError: string | null,
  snapshot: BureauSnapshot,
  cadastralScore: string | null
): SourceRow[] {
  const bv = snapshot.boaVista;
  const quod = snapshot.quod;
  const ieptb = snapshot.ieptb;
  const internal: SourceRow = creditError
    ? { key: "nomus", group: "Interna", label: "Histórico financeiro · Nomus", value: INTELLIGENCE_FACT_LABEL.UNAVAILABLE, state: "pending" }
    : !credit?.consulted
      ? { key: "nomus", group: "Interna", label: "Histórico financeiro · Nomus", value: INTELLIGENCE_FACT_LABEL.NOT_CONSULTED, state: "na" }
      : {
          key: "nomus",
          group: "Interna",
          label: "Histórico financeiro · Nomus",
          value: credit.situationLabel ?? credit.decisionTitle,
          state: credit.decisionTone === "released" ? "ok" : credit.decisionTone === "review" ? "pending" : "alert",
        };
  return [
    internal,
    {
      key: "boa-vista",
      group: "Bureau",
      label: "Boa Vista · LIKE SERASA",
      value: bv
        ? bv.state === "VALID"
          ? `${bv.simulated ? "Simulação · " : ""}Score ${bv.scoreRaw ?? bv.score ?? "—"}${bv.scoreClass ? ` · Classe ${bv.scoreClass}` : ""}`
          : bv.stateLabel
        : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
      state: bv?.state === "VALID" ? "ok" : "na",
    },
    {
      key: "quod",
      group: "Bureau",
      label: "QUOD",
      value: quod?.state === "VALID" ? `Score ${quod.score ?? "—"}` : quod?.state === "NOT_CONSULTED" || !quod ? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED : quod.state,
      state: quod?.state === "VALID" ? "ok" : "na",
    },
    {
      key: "ieptb",
      group: "Protestos",
      label: "IEPTB · protestos nacionais",
      value: ieptb ? ieptb.label : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
      state: ieptb?.state === "VALID" ? (ieptb.label === "Ocorrência encontrada" ? "alert" : "ok") : "na",
    },
    {
      key: "cadastral",
      group: "Cadastral",
      label: "Receita Federal · qualidade cadastral",
      value: cadastralScore ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED,
      state: cadastralScore ? "ok" : "na",
    },
  ];
}

export function CreditScoreDashboard({
  credit,
  creditLoading,
  creditError,
  snapshot,
  cadastralScore,
}: {
  credit: CommercialCreditIntelligenceView | null;
  creditLoading: boolean;
  creditError: string | null;
  snapshot: BureauSnapshot;
  cadastralScore: string | null;
}) {
  const tone: CommercialCreditIntelligenceView["decisionTone"] = creditError || !credit ? "undetermined" : credit.decisionTone;
  const t = TONE[tone];
  const title = creditError ? "CRÉDITO NÃO DETERMINADO" : creditLoading && !credit ? "Avaliando crédito…" : credit?.decisionTitle ?? "CRÉDITO NÃO DETERMINADO";
  const headline = pickHeadlineScore(snapshot);
  const limit = snapshot.boaVista?.state === "VALID" ? money(snapshot.boaVista.suggestedLimitCents) : null;
  const fallback = creditError ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED;
  const rows = bureauSourceRows(credit, creditError, snapshot, cadastralScore);
  return (
    <section
      className={cn("grid gap-4 rounded-2xl border-2 bg-white p-4 shadow-sm lg:grid-cols-[300px_minmax(0,1fr)_320px]", t.ring)}
      data-testid="credit-score-dashboard"
      data-decision-state={creditError || !credit ? "NAO_DETERMINADO" : credit.decisionState}
    >
      <div className="flex flex-col items-center justify-center rounded-xl bg-slate-50 px-2 py-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Score de crédito</p>
        <ScoreGauge score={headline} />
      </div>

      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Painel de crédito</p>
        <div className={cn("mt-1 flex items-start gap-2", t.text)}>
          <t.Icon className="mt-1 h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <p className="text-2xl font-black uppercase leading-tight tracking-tight" data-testid="credit-dashboard-decision">
              {title}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {creditError
                ? "A situação de crédito ficou indisponível. É necessária análise antes da venda a prazo."
                : credit?.decisionDescription ?? "Não foi possível confirmar as condições de crédito."}
            </p>
            {tone === "blocked" || tone === "critical" ? (
              <p className="mt-1 text-xs font-black uppercase tracking-wide text-red-800">Não vender a prazo sem liberação autorizada</p>
            ) : null}
            <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
              Decisão do motor comercial · {credit?.decisionEvaluatedAtLabel ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-3">
          <Kpi label="Limite sugerido (Boa Vista)" value={limit ?? "Não consultado"} tone="info" testId="credit-dashboard-limit" />
          <Kpi label="Probabilidade de inadimplência" value={snapshot.boaVista?.state === "VALID" ? snapshot.boaVista.defaultProbability ?? "Não informada" : "Não consultado"} />
          <Kpi
            label="Valor vencido (Nomus)"
            value={credit?.overdueAmountLabel ?? fallback}
            tone={(credit?.overdueTitles.length ?? 0) > 0 ? "danger" : "default"}
            testId="credit-dashboard-overdue"
          />
          <Kpi label="Títulos vencidos" value={credit?.overdueTitleCountLabel ?? fallback} />
          <Kpi label="Maior atraso" value={credit?.maxDaysOverdueLabel ?? fallback} />
          <Kpi
            label="Protestos (IEPTB)"
            value={snapshot.ieptb?.state === "VALID" ? `${snapshot.ieptb.count ?? 0}${snapshot.ieptb.totalAmount != null ? ` · ${money(Math.round(snapshot.ieptb.totalAmount * 100))}` : ""}` : "Não consultado"}
          />
        </div>
        {(credit?.decisionReasons.length ?? 0) > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {credit!.decisionReasons.map((reason) => (
              <span key={reason.code} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                {reason.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-w-0 rounded-xl border border-slate-200 p-3" data-testid="credit-dashboard-sources">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Fontes por tipo de consulta</p>
        <ul className="mt-2 divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.key} className="flex items-start gap-2 py-2" data-testid={`credit-source-${row.key}`} data-source-state={row.state}>
              <span className="mt-0.5">{STATE_ICON[row.state]}</span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{row.group}</p>
                <p className="text-xs font-semibold text-slate-800">{row.label}</p>
                <p className="truncate text-xs text-slate-600" title={row.value}>
                  {row.value}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
