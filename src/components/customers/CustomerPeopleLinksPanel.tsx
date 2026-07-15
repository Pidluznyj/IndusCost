import React, { useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";

type Props = { customerId: string };

type PeopleLinksPayload = {
  documentKind: "PF" | "PJ" | "UNKNOWN";
  identity: {
    canLinkPerson: boolean;
    personId: string | null;
    person: { id: string; displayName: string; status: string } | null;
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
    accountOwner: { type: string; value: string } | null;
  };
};

export function CustomerPeopleLinksPanel({ customerId }: Props) {
  const [data, setData] = useState<PeopleLinksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchJsonOk<PeopleLinksPayload>(
          `/api/customers/${customerId}/people-links`
        );
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar vínculos.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Carregando pessoas e vínculos…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Identidade = mesma pessoa física. Relacionamento = papel funcional (carteira, contato, etc.).
        Cliente PJ não é vinculado como Person; apenas PF ou contatos internos relacionados.
      </div>

      <section className="space-y-2">
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Identidade
        </h4>
        <p className="text-sm">
          Documento: <strong>{data.documentKind}</strong>
        </p>
        {data.identity.canLinkPerson ? (
          data.identity.person ? (
            <p className="text-sm">
              Pessoa canônica: <strong>{data.identity.person.displayName}</strong> (
              {data.identity.person.status})
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Cliente PF sem Person vinculada — use a busca canônica no RH / diagnóstico para
              vincular com CPF inequívoco.
            </p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            Cliente pessoa jurídica — identidade da empresa não é Person.
          </p>
        )}
      </section>

      <section className="space-y-2">
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
          <p className="text-sm text-muted-foreground">Sem responsável comercial cadastrado.</p>
        )}

        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">Contato cadastral</p>
          <p>{data.relationshipLinks.contactSnapshot.contactName || "—"}</p>
          <p className="text-xs text-muted-foreground">
            {data.relationshipLinks.contactSnapshot.email || "sem e-mail"} ·{" "}
            {data.relationshipLinks.contactSnapshot.phone || "sem telefone"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.relationshipLinks.contactSnapshot.note}
          </p>
        </div>

        {data.relationshipLinks.accountOwner ? (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">Account owner (texto)</p>
            <p>{data.relationshipLinks.accountOwner.value}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
