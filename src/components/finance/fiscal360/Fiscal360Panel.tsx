/**
 * Financeiro › Tributos › Inteligência Fiscal 360°.
 * Todas as áreas leem dados materializados; "Atualizar" só relê o estado (não recalcula histórico).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  Building2,
  Download,
  FileText,
  GitCompareArrows,
  LayoutDashboard,
  LineChart,
  ListChecks,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { cn } from "@/src/lib/utils";
import { FISCAL360_COMPANIES, FISCAL360_TAX_LABELS, FISCAL360_TAX_TYPES } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import {
  FISCAL360_PERIOD_LABELS,
  fiscal360ExportUrl,
  resolveFiscal360Capabilities,
  resolveFiscal360Period,
  type Fiscal360PeriodPreset,
  type Fiscal360UiFilters,
} from "@/src/lib/finance/fiscal360/fiscal360Client";
import { Fiscal360Audit } from "./Fiscal360Audit";
import { Fiscal360DocumentDrawer, Fiscal360Documents } from "./Fiscal360Documents";
import { Fiscal360Forecast } from "./Fiscal360Forecast";
import { Fiscal360Intercompany } from "./Fiscal360Intercompany";
import { Fiscal360Overview } from "./Fiscal360Overview";
import { Fiscal360PaymentDrawer, Fiscal360Payments } from "./Fiscal360Payments";
import { Fiscal360Processing } from "./Fiscal360Processing";
import { Fiscal360Reconciliation } from "./Fiscal360Reconciliation";
import { Badge, ButtonLike } from "./Fiscal360Shared";

export type Fiscal360Area = "overview" | "payments" | "reconciliation" | "documents" | "intercompany" | "forecast" | "processing" | "audit";

const AREAS: Array<{ id: Fiscal360Area; label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "overview", label: "Visão executiva", description: "Tributos pagos, devidos, apurados e destacados", icon: LayoutDashboard },
  { id: "payments", label: "Tributos pagos", description: "Pagamentos, títulos e evidências", icon: ReceiptText },
  { id: "reconciliation", label: "Conciliação fiscal", description: "Apuração, guias, AP, baixas e comprovantes", icon: GitCompareArrows },
  { id: "documents", label: "Documentos fiscais", description: "NF-e e classificação da operação", icon: FileText },
  { id: "intercompany", label: "Operações do grupo", description: "Intercompany sem inflar o consolidado", icon: ArrowLeftRight },
  { id: "forecast", label: "Projeções e cenários", description: "Previsão determinística e estimada", icon: LineChart },
  { id: "processing", label: "Processamento", description: "Fila incremental, versões e integridade", icon: Activity },
  { id: "audit", label: "Auditoria e qualidade", description: "Pendências, revisões e trilha", icon: ListChecks },
];

const EXPORTABLE: Partial<Record<Fiscal360Area, string>> = {
  payments: "payments",
  reconciliation: "reconciliation",
  documents: "documents",
  audit: "issues",
};

export function Fiscal360Panel() {
  const auth = useAuth();
  const caps = useMemo(() => resolveFiscal360Capabilities(auth), [auth]);
  const [area, setArea] = useState<Fiscal360Area>("overview");
  const [preset, setPreset] = useState<Fiscal360PeriodPreset>("ytd");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [company, setCompany] = useState("group");
  const [basis, setBasis] = useState<"COMPETENCE" | "CASH">("COMPETENCE");
  const [taxType, setTaxType] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [paymentKey, setPaymentKey] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | undefined>();

  const period = useMemo(() => resolveFiscal360Period(preset, new Date(), custom.from && custom.to ? custom : undefined), [preset, custom]);
  const filters: Fiscal360UiFilters = useMemo(() => ({ company, fromMonth: period.fromMonth, toMonth: period.toMonth, basis, taxType }), [company, period, basis, taxType]);

  const navigate = useCallback((next: string, extra?: Record<string, string>) => {
    if (extra?.taxType) setTaxType(extra.taxType);
    if (extra?.status) setPaymentStatus(extra.status);
    setArea(next as Fiscal360Area);
  }, []);

  if (!caps.view) {
    return (
      <p className="rounded-md border border-[#E5E7EB] bg-white p-4 text-[12px] text-[#6B7280]" role="alert">
        Sem permissão para a Inteligência Fiscal 360°.
      </p>
    );
  }
  const current = AREAS.find((a) => a.id === area)!;
  const exportDataset = EXPORTABLE[area];
  const select = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";
  const label = "text-[10px] font-bold uppercase tracking-wide text-[#6B7280]";

  return (
    <div className="space-y-4" data-testid="fiscal360-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-[#111827]">
            <ShieldCheck className="h-4 w-4 text-[#1e3a8a]" /> Inteligência Fiscal 360°
            <Badge tone="good">Dados materializados</Badge>
          </h2>
          <p className="text-[11px] text-[#6B7280]">{current.description}. Destacado ≠ apurado ≠ devido ≠ pago ≠ previsto.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLike variant="quiet" onClick={() => setRefreshKey((k) => k + 1)} testId="fiscal360-refresh" title="Consulta o estado do processamento; não recalcula o histórico">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </ButtonLike>
          {caps.export && exportDataset ? (
            <>
              <a className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-semibold" href={fiscal360ExportUrl(exportDataset, "xlsx", filters)} data-testid="fiscal360-export-xlsx">
                <Download className="h-3.5 w-3.5" /> XLSX
              </a>
              <a className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-semibold" href={fiscal360ExportUrl(exportDataset, "csv", filters)} data-testid="fiscal360-export-csv">
                <Download className="h-3.5 w-3.5" /> CSV
              </a>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3" data-testid="fiscal360-filters">
        <label className="block">
          <span className={label}>Empresa</span>
          <select className={`${select} block`} value={company} onChange={(e) => setCompany(e.target.value)} data-testid="fiscal360-filter-company">
            <option value="group">Grupo consolidado</option>
            {FISCAL360_COMPANIES.map((c) => (
              <option key={c.cnpj} value={c.cnpj}>
                {c.shortName} · {c.displayCnpj}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Período</span>
          <select className={`${select} block`} value={preset} onChange={(e) => setPreset(e.target.value as Fiscal360PeriodPreset)} data-testid="fiscal360-filter-period">
            {Object.entries(FISCAL360_PERIOD_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {preset === "custom" ? (
          <>
            <label className="block">
              <span className={label}>De</span>
              <input type="month" className={`${select} block`} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label className="block">
              <span className={label}>Até</span>
              <input type="month" className={`${select} block`} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </>
        ) : null}
        <label className="block">
          <span className={label}>Visão</span>
          <select className={`${select} block`} value={basis} onChange={(e) => setBasis(e.target.value as "COMPETENCE" | "CASH")} data-testid="fiscal360-filter-basis">
            <option value="COMPETENCE">Competência fiscal</option>
            <option value="CASH">Data do pagamento (caixa)</option>
          </select>
        </label>
        <label className="block">
          <span className={label}>Tributo</span>
          <select className={`${select} block`} value={taxType} onChange={(e) => setTaxType(e.target.value)} data-testid="fiscal360-filter-tax">
            <option value="">Todos os tributos</option>
            {FISCAL360_TAX_TYPES.map((t) => (
              <option key={t} value={t}>
                {FISCAL360_TAX_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <p className="ml-auto flex items-center gap-1 text-[11px] text-[#6B7280]">
          <Building2 className="h-3.5 w-3.5" />
          {basis === "CASH" ? "Visão de caixa" : "Visão de competência"} — não misturadas
        </p>
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Áreas da Inteligência Fiscal 360°">
        {AREAS.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={area === a.id}
              onClick={() => setArea(a.id)}
              data-testid={`fiscal360-tab-${a.id}`}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold",
                area === a.id ? "bg-[#E9F0FF] text-[#1D4ED8] ring-1 ring-[#CBDAFA]" : "bg-white text-[#4B5563] ring-1 ring-[#E5E7EB] hover:bg-[#F3F4F6]"
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {a.label}
            </button>
          );
        })}
      </nav>

      {area === "overview" ? <Fiscal360Overview filters={filters} refreshKey={refreshKey} onNavigate={navigate} /> : null}
      {area === "payments" ? <Fiscal360Payments filters={filters} refreshKey={refreshKey} caps={caps} initialStatus={paymentStatus} onOpenPayment={setPaymentKey} /> : null}
      {area === "reconciliation" ? <Fiscal360Reconciliation filters={filters} refreshKey={refreshKey} caps={caps} onOpenPayment={setPaymentKey} /> : null}
      {area === "documents" ? <Fiscal360Documents filters={filters} refreshKey={refreshKey} onOpenDocument={setDocumentId} /> : null}
      {area === "intercompany" ? <Fiscal360Intercompany filters={filters} refreshKey={refreshKey} onOpenDocument={setDocumentId} /> : null}
      {area === "forecast" ? <Fiscal360Forecast filters={filters} refreshKey={refreshKey} caps={caps} /> : null}
      {area === "processing" ? <Fiscal360Processing refreshKey={refreshKey} caps={caps} /> : null}
      {area === "audit" ? <Fiscal360Audit filters={filters} refreshKey={refreshKey} caps={caps} /> : null}

      <Fiscal360PaymentDrawer anchorKey={paymentKey} caps={caps} onClose={() => setPaymentKey(null)} refreshKey={refreshKey} />
      <Fiscal360DocumentDrawer nomusNfeId={documentId} onClose={() => setDocumentId(null)} refreshKey={refreshKey} />
    </div>
  );
}
