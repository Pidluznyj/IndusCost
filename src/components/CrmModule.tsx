// src/components/CrmModule.tsx — CRM Comercial (Fase 1B): indicadores, carteira, timeline e novo contato.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  Building2,
  Mail,
  Phone,
  MapPin,
  CalendarClock,
  MessageSquare,
  Plus,
  X,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";

/** Cliente vindo de GET /api/customers (campos reais do Prisma + tolerância a aliases). */
export type CrmCustomer = Record<string, unknown> & { id: string };

export type CrmActivity = {
  id: string;
  activityType: string;
  subject: string | null;
  description: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  status: string;
  priority: number | null;
  assignedTo: string | null;
  closeReason: string | null;
  contactDate: string | null;
  channel: string | null;
  reason: string | null;
  outcome: string | null;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  createdByName: string | null;
  createdByPhone: string | null;
  createdByEmail: string | null;
  createdAt: string;
  proposal: { number: number; title: string | null; status: string } | null;
};

type CrmDashboardBasic = {
  totalCustomers: number;
  customersWithContactLast30Days: number;
  customersWithoutContactLast30Days: number;
  overdueFollowUps: number;
  upcomingFollowUpsNext7Days: number;
};

type ActivitiesResponse = { activities: CrmActivity[] };

const CRM_LIST_LIMIT = 50;
const CRM_ACTIVITY_LIMIT = 50;

const CHANNEL_OPTIONS = [
  "WHATSAPP",
  "PHONE",
  "EMAIL",
  "MEETING",
  "VISIT",
  "VIDEO_CALL",
  "OTHER",
] as const;

const REASON_OPTIONS = [
  "PROSPECTION",
  "FOLLOW_UP",
  "PROPOSAL",
  "NEGOTIATION",
  "POST_SALE",
  "REACTIVATION",
  "COMPLAINT",
  "RELATIONSHIP",
  "OTHER",
] as const;

const STATUS_OPTIONS = ["DONE", "OPEN", "WAITING", "CANCELLED"] as const;

function strField(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Nome exibido: prioriza campos reais do IndusCost (`companyName`, `tradeName`, …). */
export function getCustomerDisplayName(customer: CrmCustomer): string {
  const keys = [
    "companyName",
    "tradeName",
    "legalName",
    "corporateName",
    "name",
    "nome",
    "razaoSocial",
    "nomeFantasia",
    "customerName",
  ] as const;
  for (const k of keys) {
    const s = strField(customer[k]);
    if (s) return s;
  }
  const doc = getCustomerTaxId(customer);
  if (doc !== "—") return doc;
  return "Cliente sem nome";
}

export function getCustomerTaxId(customer: CrmCustomer): string {
  const keys = ["taxId", "cnpj", "cnpjCpf", "document", "taxDocument", "cpf"] as const;
  for (const k of keys) {
    const s = strField(customer[k]);
    if (s) return s;
  }
  return "—";
}

function displayLine(v: unknown): string {
  const s = strField(v);
  return s || "—";
}

function formatCityState(city: unknown, state: unknown): string {
  const c = strField(city);
  const s = strField(state);
  if (c && s) return `${c} / ${s}`;
  if (c) return c;
  if (s) return s;
  return "—";
}

function parseActivityDate(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function datetimeLocalNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function datetimeLocalToIso(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function sortActivitiesDesc(a: CrmActivity, b: CrmActivity): number {
  const ac = parseActivityDate(a.contactDate) || parseActivityDate(a.createdAt);
  const bc = parseActivityDate(b.contactDate) || parseActivityDate(b.createdAt);
  if (bc !== ac) return bc - ac;
  return parseActivityDate(b.createdAt) - parseActivityDate(a.createdAt);
}

function statusIsOpenLike(s: string): boolean {
  const u = s.trim().toUpperCase();
  return u === "OPEN" || u === "WAITING";
}

function channelBadgeClass(channel: string | null): string {
  const c = (channel ?? "").toUpperCase();
  if (c === "WHATSAPP") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (c === "PHONE" || c === "VIDEO_CALL") return "bg-sky-100 text-sky-800 border-sky-200";
  if (c === "EMAIL") return "bg-violet-100 text-violet-800 border-violet-200";
  if (c === "MEETING" || c === "VISIT") return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-muted text-muted-foreground border-border";
}

export const CrmModule = () => {
  const [dashboard, setDashboard] = useState<CrmDashboardBasic | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [formContactDate, setFormContactDate] = useState(datetimeLocalNow);
  const [formChannel, setFormChannel] = useState<string>("WHATSAPP");
  const [formReason, setFormReason] = useState<string>("FOLLOW_UP");
  const [formSubject, setFormSubject] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formOutcome, setFormOutcome] = useState("");
  const [formStatus, setFormStatus] = useState<string>("DONE");
  const [formAssignedTo, setFormAssignedTo] = useState("Comercial Lazarios");
  const [formCreatedByName, setFormCreatedByName] = useState("Comercial Lazarios");
  const [formCreatedByPhone, setFormCreatedByPhone] = useState("");
  const [formCreatedByEmail, setFormCreatedByEmail] = useState("");
  const [formNextActionAt, setFormNextActionAt] = useState("");
  const [formNextActionDescription, setFormNextActionDescription] = useState("");

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const data = await fetchJsonOk<CrmDashboardBasic>("/api/crm/dashboard/basic");
      setDashboard(data);
    } catch (e) {
      setDashboard(null);
      setDashboardError(e instanceof Error ? e.message : "Não foi possível carregar os indicadores.");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true);
    setCustomersError(null);
    try {
      const data = await fetchJsonOk<CrmCustomer[]>("/api/customers");
      const list = Array.isArray(data) ? data : [];
      const withId = list.filter((c) => typeof c?.id === "string" && c.id.length > 0);
      setCustomers(withId);
    } catch (e) {
      setCustomers([]);
      setCustomersError(e instanceof Error ? e.message : "Não foi possível carregar a lista de clientes.");
    } finally {
      setCustomersLoading(false);
    }
  }, []);

  const loadActivities = useCallback(async (customerId: string) => {
    setActivitiesLoading(true);
    setActivitiesError(null);
    try {
      const res = await fetchJsonOk<ActivitiesResponse>(
        `/api/customers/${customerId}/commercial-activities?limit=${CRM_ACTIVITY_LIMIT}`
      );
      const raw = Array.isArray(res?.activities) ? res.activities : [];
      setActivities([...raw].sort(sortActivitiesDesc));
    } catch (e) {
      setActivities([]);
      setActivitiesError(e instanceof Error ? e.message : "Não foi possível carregar os contatos.");
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    void loadCustomers();
  }, [loadDashboard, loadCustomers]);

  const selectedCustomer = useMemo(
    () => (selectedId ? customers.find((c) => c.id === selectedId) ?? null : null),
    [customers, selectedId]
  );

  useEffect(() => {
    if (!selectedId) {
      setActivities([]);
      setActivitiesError(null);
      return;
    }
    void loadActivities(selectedId);
  }, [selectedId, loadActivities]);

  const filteredCustomers = useMemo(() => {
    const q = searchApplied.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const name = getCustomerDisplayName(c).toLowerCase();
      const trade = strField(c.tradeName).toLowerCase();
      const tax = getCustomerTaxId(c).toLowerCase().replace(/\D/g, "");
      const qDigits = q.replace(/\D/g, "");
      if (qDigits.length >= 3 && tax.includes(qDigits)) return true;
      return name.includes(q) || trade.includes(q) || strField(c.taxId).toLowerCase().includes(q);
    });
  }, [customers, searchApplied]);

  const visibleCustomers = useMemo(
    () => filteredCustomers.slice(0, CRM_LIST_LIMIT),
    [filteredCustomers]
  );

  const sheetStats = useMemo(() => {
    if (!activities.length) {
      return { lastContact: "—", nextFollowUp: "—", nextFollowUpDetail: "—", total: 0 };
    }
    const now = Date.now();
    let last = 0;
    for (const a of activities) {
      const t = parseActivityDate(a.contactDate) || parseActivityDate(a.createdAt);
      if (t > last) last = t;
    }
    const lastContact = last ? formatDateTimePt(new Date(last).toISOString()) : "—";

    let best: CrmActivity | null = null;
    let bestT = Infinity;
    for (const a of activities) {
      const t = parseActivityDate(a.nextActionAt);
      if (t > now && t < bestT) {
        bestT = t;
        best = a;
      }
    }
    const nextFollowUp = best?.nextActionAt ? formatDateTimePt(best.nextActionAt) : "—";
    const nextFollowUpDetail = best?.nextActionDescription
      ? displayLine(best.nextActionDescription)
      : "—";

    return { lastContact, nextFollowUp, nextFollowUpDetail, total: activities.length };
  }, [activities]);

  const openModal = () => {
    setModalError(null);
    setFormContactDate(datetimeLocalNow());
    setFormChannel("WHATSAPP");
    setFormReason("FOLLOW_UP");
    setFormSubject("");
    setFormDescription("");
    setFormOutcome("");
    setFormStatus("DONE");
    setFormAssignedTo("Comercial Lazarios");
    setFormCreatedByName("Comercial Lazarios");
    setFormCreatedByPhone("");
    setFormCreatedByEmail("");
    setFormNextActionAt("");
    setFormNextActionDescription("");
    setModalOpen(true);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchApplied(searchInput);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setModalError("Selecione um cliente na lista.");
      return;
    }
    const subject = formSubject.trim();
    const description = formDescription.trim();
    if (!subject && !description) {
      setModalError("Informe assunto ou descrição.");
      return;
    }
    const contactIso = datetimeLocalToIso(formContactDate);
    if (!contactIso) {
      setModalError("Data do contato inválida.");
      return;
    }
    const nextIso = formNextActionAt.trim() ? datetimeLocalToIso(formNextActionAt) : undefined;
    if (formNextActionAt.trim() && !nextIso) {
      setModalError("Data da próxima ação inválida.");
      return;
    }

    setModalSaving(true);
    setModalError(null);
    try {
      const body: Record<string, unknown> = {
        contactDate: contactIso,
        channel: formChannel,
        reason: formReason,
        subject: subject || undefined,
        description: description || undefined,
        outcome: formOutcome.trim() || undefined,
        status: formStatus,
        assignedTo: formAssignedTo.trim() || undefined,
        createdByName: formCreatedByName.trim() || "Comercial Lazarios",
        createdByPhone: formCreatedByPhone.trim() || undefined,
        createdByEmail: formCreatedByEmail.trim() || undefined,
        nextActionAt: nextIso,
        nextActionDescription: formNextActionDescription.trim() || undefined,
      };
      await fetchJsonOk(`/api/customers/${selectedId}/commercial-activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setModalOpen(false);
      setToast("Contato registrado com sucesso.");
      window.setTimeout(() => setToast(null), 4000);
      await loadActivities(selectedId);
      await loadDashboard();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Falha ao salvar o contato.");
    } finally {
      setModalSaving(false);
    }
  };

  const handleMarkDone = async (activity: CrmActivity) => {
    if (!statusIsOpenLike(activity.status)) return;
    try {
      await fetchJsonOk(`/api/commercial-activities/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
      setToast("Contato marcado como concluído.");
      window.setTimeout(() => setToast(null), 3500);
      if (selectedId) await loadActivities(selectedId);
      await loadDashboard();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Não foi possível atualizar o contato.");
    }
  };

  const dashboardCards = [
    { label: "Total de clientes", value: dashboard?.totalCustomers },
    { label: "Com contato (30 dias)", value: dashboard?.customersWithContactLast30Days },
    { label: "Sem contato (30 dias)", value: dashboard?.customersWithoutContactLast30Days },
    { label: "Follow-ups atrasados", value: dashboard?.overdueFollowUps },
    { label: "Próximos follow-ups (7 dias)", value: dashboard?.upcomingFollowUpsNext7Days },
  ];

  return (
    <div className="space-y-8" data-tour="crm-root">
      {toast ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {toast}
        </div>
      ) : null}

      {/* Indicadores */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Indicadores
        </h3>
        {dashboardLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando indicadores…
          </div>
        ) : dashboardError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {dashboardError}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {dashboardCards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col gap-1"
              >
                <span className="text-xs font-medium text-muted-foreground leading-tight">{card.label}</span>
                <span className="text-2xl font-bold tabular-nums">
                  {typeof card.value === "number" ? card.value : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* Lista */}
        <div className="space-y-4 min-w-0">
          <form onSubmit={handleSearch} className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Buscar cliente
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Nome, fantasia ou CNPJ…"
                className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Search className="h-4 w-4" />
              Buscar
            </button>
            <p className="text-xs text-muted-foreground">
              Lista limitada a {CRM_LIST_LIMIT} clientes após o filtro (endpoint sem paginação).
            </p>
          </form>

          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="border-b border-border px-4 py-3 bg-accent/40">
              <span className="text-sm font-semibold">Clientes</span>
            </div>
            {customersLoading ? (
              <div className="p-8 flex justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : customersError ? (
              <div className="p-4 text-sm text-red-700">{customersError}</div>
            ) : visibleCustomers.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">Nenhum cliente encontrado.</div>
            ) : (
              <ul className="max-h-[min(520px,55vh)] overflow-y-auto divide-y divide-border">
                {visibleCustomers.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          "w-full text-left px-4 py-3 text-sm transition-colors hover:bg-accent/60",
                          active && "bg-primary/10 border-l-4 border-l-primary"
                        )}
                      >
                        <div className="font-medium text-foreground line-clamp-2">
                          {getCustomerDisplayName(c)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {getCustomerTaxId(c) !== "—" ? getCustomerTaxId(c) : "—"}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Ficha + timeline */}
        <div className="space-y-4 min-w-0">
          {!selectedCustomer ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
              Selecione um cliente à esquerda para ver a ficha e a linha do tempo de contatos.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-lg font-bold leading-tight break-words">
                        {getCustomerDisplayName(selectedCustomer)}
                      </h3>
                      {strField(selectedCustomer.tradeName) ? (
                        <p className="text-sm text-muted-foreground">
                          Fantasia: {displayLine(selectedCustomer.tradeName)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openModal}
                    className="inline-flex items-center justify-center gap-2 shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                  >
                    <Plus className="h-4 w-4" />
                    Novo contato
                  </button>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">CNPJ / documento</dt>
                    <dd>{getCustomerTaxId(selectedCustomer)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">Telefone</dt>
                    <dd className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {displayLine(selectedCustomer.phone)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">E-mail</dt>
                    <dd className="flex items-center gap-1.5 break-all">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {displayLine(selectedCustomer.email)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">Cidade / UF</dt>
                    <dd className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {formatCityState(selectedCustomer.city, selectedCustomer.state)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">Endereço</dt>
                    <dd className="break-words">{displayLine(selectedCustomer.address)}</dd>
                  </div>
                </dl>

                <div className="grid gap-2 sm:grid-cols-3 pt-2 border-t border-border text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block">Último contato</span>
                    <span className="font-medium">{sheetStats.lastContact}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Próximo follow-up</span>
                    <span className="font-medium">{sheetStats.nextFollowUp}</span>
                    {sheetStats.nextFollowUpDetail !== "—" ? (
                      <span className="text-xs text-muted-foreground block mt-0.5 line-clamp-2">
                        {sheetStats.nextFollowUpDetail}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Total de contatos</span>
                    <span className="font-medium tabular-nums">{sheetStats.total}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Linha do tempo
                </h3>
                {activitiesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Carregando contatos…
                  </div>
                ) : activitiesError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{activitiesError}</div>
                ) : activities.length === 0 ? (
                  <div className="rounded-xl border border-border bg-muted/20 p-6 text-sm text-muted-foreground text-center">
                    Nenhum contato registrado para este cliente.
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {activities.map((a) => (
                      <li
                        key={a.id}
                        className="rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col gap-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <CalendarClock className="h-4 w-4 text-primary shrink-0" />
                            <span className="font-semibold text-foreground">
                              {formatDateTimePt(a.contactDate ?? a.createdAt)}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] uppercase font-bold px-2 py-0.5 rounded border",
                                channelBadgeClass(a.channel)
                              )}
                            >
                              {displayLine(a.channel)}
                            </span>
                            <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded border border-border bg-muted/50 text-muted-foreground">
                              {displayLine(a.reason)}
                            </span>
                            <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded border border-border bg-background">
                              {displayLine(a.status)}
                            </span>
                          </div>
                          {statusIsOpenLike(a.status) ? (
                            <button
                              type="button"
                              onClick={() => void handleMarkDone(a)}
                              className="text-xs font-semibold rounded-lg border border-border px-2 py-1 hover:bg-accent shrink-0"
                            >
                              Marcar como concluído
                            </button>
                          ) : null}
                        </div>
                        {a.subject ? (
                          <p className="text-sm font-medium text-foreground">{displayLine(a.subject)}</p>
                        ) : null}
                        {a.description ? (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                            {displayLine(a.description)}
                          </p>
                        ) : null}
                        <div className="grid gap-1 text-xs sm:grid-cols-2">
                          <p>
                            <span className="text-muted-foreground">Resultado: </span>
                            {displayLine(a.outcome)}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Responsável: </span>
                            {displayLine(a.assignedTo)}
                          </p>
                          {(a.nextActionAt || a.nextActionDescription) && (
                            <p className="sm:col-span-2 flex items-start gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                              <span>
                                <span className="text-muted-foreground">Próxima ação: </span>
                                {a.nextActionAt ? formatDateTimePt(a.nextActionAt) : "—"}
                                {a.nextActionDescription
                                  ? ` — ${displayLine(a.nextActionDescription)}`
                                  : ""}
                              </span>
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal novo contato */}
      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h4 className="text-lg font-bold">Novo contato</h4>
              <button
                type="button"
                onClick={() => !modalSaving && setModalOpen(false)}
                className="rounded-lg p-2 hover:bg-accent text-muted-foreground"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveContact} className="p-5 space-y-4">
              {modalError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {modalError}
                </div>
              ) : null}
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Data do contato</label>
                <input
                  type="datetime-local"
                  required
                  value={formContactDate}
                  onChange={(e) => setFormContactDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Canal</label>
                  <select
                    value={formChannel}
                    onChange={(e) => setFormChannel(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {CHANNEL_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Motivo</label>
                  <select
                    value={formReason}
                    onChange={(e) => setFormReason(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {REASON_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Assunto</label>
                <input
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Resumo curto"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Descrição / observações</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Detalhes do contato"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Resultado</label>
                <input
                  value={formOutcome}
                  onChange={(e) => setFormOutcome(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Status</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Responsável</label>
                <input
                  value={formAssignedTo}
                  onChange={(e) => setFormAssignedTo(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Registrado por (nome)</label>
                <input
                  value={formCreatedByName}
                  onChange={(e) => setFormCreatedByName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Telefone (opcional)</label>
                  <input
                    value={formCreatedByPhone}
                    onChange={(e) => setFormCreatedByPhone(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">E-mail (opcional)</label>
                  <input
                    value={formCreatedByEmail}
                    onChange={(e) => setFormCreatedByEmail(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Próxima ação (data)</label>
                <input
                  type="datetime-local"
                  value={formNextActionAt}
                  onChange={(e) => setFormNextActionAt(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Próxima ação (descrição)</label>
                <input
                  value={formNextActionDescription}
                  onChange={(e) => setFormNextActionDescription(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={modalSaving}
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {modalSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
