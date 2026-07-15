import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Link2, Unlink, UserPlus, Search } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { cn } from "@/src/lib/utils";

type Props = { customerId: string; canManageLinks?: boolean };

type PersonBrief = {
  id: string;
  displayName: string;
  status?: string;
  email?: string | null;
  cpfMasked?: string | null;
};

type PeopleLinksPayload = {
  documentKind: "PF" | "PJ" | "UNKNOWN";
  identity: {
    canLinkPerson: boolean;
    personId: string | null;
    person: PersonBrief | null;
    alsoLinkedCustomers?: { id: string; companyName: string }[];
    note?: string;
  };
  relationshipLinks: {
    commercialOwner: {
      type: string;
      sellerResponsibleName: string | null;
      sellerCanonicalName: string | null;
      isActive: boolean;
      note: string;
    } | null;
    contactSnapshot: {
      type: string;
      contactName: string | null;
      email: string | null;
      phone: string | null;
      note: string;
    };
    contactPerson: {
      canLink: boolean;
      personId: string | null;
      person: PersonBrief | null;
      alsoContactOfCustomers?: { id: string; companyName: string }[];
      note: string;
    };
    orderSellers: {
      type: string;
      displayName: string;
      externalSellerId: number | null;
      orderCount: number;
      sampleOrderCodes: string[];
      note: string;
    }[];
    accountOwner: { type: string; value: string; note?: string } | null;
  };
};

type ResolveHit = {
  key: string;
  displayName: string;
  personId: string | null;
  sourceKind: string;
  sourceEntityId: string;
  roles: string[];
  linkStatus: string;
  podeVincular: boolean;
  emailMasked?: string | null;
  cpfMasked?: string | null;
};

export function CustomerPeopleLinksPanel({ customerId, canManageLinks }: Props) {
  const auth = useAuth();
  const manage =
    canManageLinks ??
    (auth.hasPermission("customers.edit") &&
      (auth.hasPermission("people.link.manage") ||
        auth.hasPermission("users.manage") ||
        auth.hasPermission("employees.edit")));

  const [data, setData] = useState<PeopleLinksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<"identity" | "contact" | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ResolveHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const payload = await fetchJsonOk<PeopleLinksPayload>(
      `/api/customers/${customerId}/people-links`
    );
    setData(payload);
  }, [customerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar vínculos.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!searchMode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetchJsonOk<{ items: ResolveHit[] }>(
            `/api/people/resolve?q=${encodeURIComponent(query.trim())}&limit=10`
          );
          setHits(res.items ?? []);
        } catch {
          setHits([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchMode]);

  const runLink = async (
    kind: "identity" | "contact",
    body: Record<string, unknown>
  ) => {
    setBusy(true);
    setActionError(null);
    try {
      const path =
        kind === "identity"
          ? `/api/customers/${customerId}/person-link`
          : `/api/customers/${customerId}/contact-person-link`;
      await fetchJsonOk(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSearchMode(null);
      setQuery("");
      setHits([]);
      await load();
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        setActionError(
          `${e.message} Resolva os conflitos (campo a campo) e tente novamente.`
        );
      } else {
        setActionError(e instanceof Error ? e.message : "Falha ao vincular.");
      }
    } finally {
      setBusy(false);
    }
  };

  const runUnlink = async (kind: "identity" | "contact") => {
    const label =
      kind === "identity"
        ? "Remover vínculo de identidade com a Pessoa Canônica?"
        : "Remover vínculo do contato com a Pessoa Canônica?";
    if (
      !window.confirm(
        `${label}\n\nA Pessoa não será apagada (histórico preservado).`
      )
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const path =
        kind === "identity"
          ? `/api/customers/${customerId}/person-link`
          : `/api/customers/${customerId}/contact-person-link`;
      await fetchJsonOk(path, { method: "DELETE" });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Falha ao desvincular.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Carregando pessoas e vínculos…</p>;
  }

  const renderSearch = (kind: "identity" | "contact") => {
    if (searchMode !== kind) return null;
    return (
      <div className="mt-3 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm"
            placeholder="Buscar pessoa (nome, CPF, e-mail)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        {searching && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Buscando…
          </p>
        )}
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.key}>
              <button
                type="button"
                disabled={busy || (!h.personId && h.sourceKind === "person")}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm hover:border-primary disabled:opacity-50"
                onClick={() => {
                  if (h.personId) {
                    void runLink(kind, { personId: h.personId });
                  } else {
                    void runLink(kind, {
                      sourceKind: h.sourceKind,
                      sourceId: h.sourceEntityId,
                    });
                  }
                }}
              >
                <span className="font-medium">{h.displayName}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {h.roles?.join(" · ") || h.sourceKind}
                  {h.cpfMasked ? ` · ${h.cpfMasked}` : ""}
                  {h.emailMasked ? ` · ${h.emailMasked}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
            onClick={() => void runLink(kind, { createNewFromContact: true })}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Criar pessoa a partir do contato cadastral
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => {
              setSearchMode(null);
              setQuery("");
              setHits([]);
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <strong>Identidade</strong> = a mesma pessoa física (cliente PF ↔ Person).{" "}
        <strong>Relacionamento</strong> = papel funcional (carteira, contato, vendedor do
        pedido). Responsável da carteira ≠ vendedor comissionável do pedido Nomus.
      </div>

      {actionError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <section className="space-y-2">
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Identidade
        </h4>
        <p className="text-sm">
          Documento: <strong>{data.documentKind}</strong>
        </p>
        {data.identity.note ? (
          <p className="text-xs text-muted-foreground">{data.identity.note}</p>
        ) : null}

        {data.identity.canLinkPerson ? (
          <div className="rounded-lg border border-border p-3 text-sm space-y-2">
            {data.identity.person ? (
              <>
                <p>
                  Pessoa canônica:{" "}
                  <strong>{data.identity.person.displayName}</strong> (
                  {data.identity.person.status})
                </p>
                {data.identity.person.cpfMasked ? (
                  <p className="text-xs text-muted-foreground">
                    CPF {data.identity.person.cpfMasked}
                  </p>
                ) : null}
                {(data.identity.alsoLinkedCustomers?.length ?? 0) > 0 ? (
                  <p className="text-xs text-amber-800 rounded border border-amber-200 bg-amber-50/80 px-2 py-1">
                    Esta Person também está vinculada a outros clientes:{" "}
                    {data.identity.alsoLinkedCustomers!.map((c) => c.companyName).join(", ")}
                  </p>
                ) : null}
                {manage ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-xs font-medium text-destructive"
                    onClick={() => void runUnlink("identity")}
                  >
                    <Unlink className="h-3.5 w-3.5" /> Desvincular identidade
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-muted-foreground">Cliente PF sem Person vinculada.</p>
                {manage ? (
                  <button
                    type="button"
                    disabled={busy}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
                      "border-primary text-primary hover:bg-primary/5"
                    )}
                    onClick={() => setSearchMode("identity")}
                  >
                    <Link2 className="h-3.5 w-3.5" /> Vincular pessoa existente
                  </button>
                ) : null}
              </>
            )}
            {renderSearch("identity")}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Cliente pessoa jurídica — a empresa não é uma Pessoa Canônica. Use o vínculo de
            contato abaixo para a pessoa física de contato.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Relacionamentos
        </h4>

        {data.relationshipLinks.commercialOwner ? (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">Responsável da carteira</p>
            <p>
              {data.relationshipLinks.commercialOwner.sellerCanonicalName ||
                data.relationshipLinks.commercialOwner.sellerResponsibleName ||
                "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.relationshipLinks.commercialOwner.note}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sem responsável comercial da carteira (aba Responsável comercial).
          </p>
        )}

        <div className="rounded-lg border border-border p-3 text-sm space-y-2">
          <p className="font-medium">Contato externo (cadastral)</p>
          <p>{data.relationshipLinks.contactSnapshot.contactName || "—"}</p>
          <p className="text-xs text-muted-foreground">
            {data.relationshipLinks.contactSnapshot.email || "sem e-mail"} ·{" "}
            {data.relationshipLinks.contactSnapshot.phone || "sem telefone"}
          </p>

          {data.relationshipLinks.contactPerson.person ? (
            <>
              <p className="text-sm">
                Pessoa do contato:{" "}
                <strong>{data.relationshipLinks.contactPerson.person.displayName}</strong>
              </p>
              {(data.relationshipLinks.contactPerson.alsoContactOfCustomers?.length ?? 0) >
              0 ? (
                <p className="text-xs text-muted-foreground">
                  Também contato de:{" "}
                  {data.relationshipLinks.contactPerson.alsoContactOfCustomers!
                    .map((c) => c.companyName)
                    .join(", ")}
                </p>
              ) : null}
              {manage ? (
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs font-medium text-destructive"
                  onClick={() => void runUnlink("contact")}
                >
                  <Unlink className="h-3.5 w-3.5" /> Desvincular contato
                </button>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {data.relationshipLinks.contactPerson.note}
              </p>
              {manage ? (
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
                  onClick={() => setSearchMode("contact")}
                >
                  <Link2 className="h-3.5 w-3.5" /> Vincular contato a pessoa
                </button>
              ) : null}
            </>
          )}
          {renderSearch("contact")}
        </div>

        <div className="rounded-lg border border-border p-3 text-sm space-y-2">
          <p className="font-medium">Vendedores dos pedidos (Nomus)</p>
          {data.relationshipLinks.orderSellers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum vendedor encontrado nos pedidos.</p>
          ) : (
            <ul className="space-y-2">
              {data.relationshipLinks.orderSellers.map((s) => (
                <li key={`${s.externalSellerId ?? s.displayName}-${s.orderCount}`}>
                  <p className="font-medium">{s.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.orderCount} pedido(s)
                    {s.sampleOrderCodes.length
                      ? ` · ex.: ${s.sampleOrderCodes.join(", ")}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Eixo do Pedido de Venda Nomus — não confundir com responsável da carteira.
          </p>
        </div>

        {data.relationshipLinks.accountOwner ? (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">Gestor da conta (texto legado)</p>
            <p>{data.relationshipLinks.accountOwner.value}</p>
            {data.relationshipLinks.accountOwner.note ? (
              <p className="text-xs text-muted-foreground mt-1">
                {data.relationshipLinks.accountOwner.note}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
