/**
 * Lista de clientes de uma UF, a mesma regra do indicador (sigla ou nome).
 */

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatBrazilStateLabel } from "@/src/lib/customerIndicators";
import { Overlay, OverlayBody, OverlayHeader, OverlayTable } from "@/src/components/ui/overlay";

type StateCustomer = {
  id: string;
  companyName: string;
  tradeName: string | null;
  taxId: string;
  city: string | null;
  state: string | null;
  status: string;
};

export function CustomerStateCustomersOverlay(props: {
  uf: string;
  name: string;
  onClose: () => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const { uf, name, onClose, onOpenCustomer } = props;
  const [customers, setCustomers] = useState<StateCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCustomers(null);
    setError(null);
    const qs = new URLSearchParams({ bucket: uf });
    fetchJsonOk<{ customers: StateCustomer[] }>(
      `/api/customers/indicators/drilldown?${qs.toString()}`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setCustomers(Array.isArray(result.customers) ? result.customers : []);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) {
          return;
        }
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar os clientes.");
      });
    return () => controller.abort();
  }, [uf]);

  const title = name.trim() || formatBrazilStateLabel(uf);

  return (
    <Overlay
      open
      onClose={onClose}
      size="lg"
      ariaLabelledBy="customer-state-list-title"
      testId="customer-state-customers"
    >
      <OverlayHeader
        titleId="customer-state-list-title"
        eyebrow="Clientes · Indicadores"
        title={title}
        subtitle={
          customers
            ? `${customers.length.toLocaleString("pt-BR")} ${customers.length === 1 ? "cliente" : "clientes"} com esta UF no cadastro`
            : "Clientes cujo estado no cadastro corresponde a esta UF."
        }
        onClose={onClose}
      />
      <OverlayBody>
        {error ? (
          <p className="py-8 text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : !customers ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Carregando clientes…
          </div>
        ) : customers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum cliente cadastrado neste estado.
          </p>
        ) : (
          <OverlayTable stickyHeader minWidth={720}>
            <OverlayTable.Head>
              <OverlayTable.Row>
                <OverlayTable.HeadCell>Cliente</OverlayTable.HeadCell>
                <OverlayTable.HeadCell>CNPJ</OverlayTable.HeadCell>
                <OverlayTable.HeadCell>Cidade / UF</OverlayTable.HeadCell>
                <OverlayTable.HeadCell>Status</OverlayTable.HeadCell>
                <OverlayTable.HeadCell>Ação</OverlayTable.HeadCell>
              </OverlayTable.Row>
            </OverlayTable.Head>
            <OverlayTable.Body>
              {customers.map((customer) => (
                <OverlayTable.Row key={customer.id}>
                  <OverlayTable.Cell>
                    <span className="font-medium">{customer.companyName}</span>
                    {customer.tradeName ? (
                      <span className="block text-xs text-muted-foreground">{customer.tradeName}</span>
                    ) : null}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    <span className="font-mono text-xs">{customer.taxId}</span>
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {[customer.city, customer.state].filter(Boolean).join(" - ") || "—"}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    {customer.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    <button
                      type="button"
                      onClick={() => onOpenCustomer(customer.id)}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Ver cliente
                    </button>
                  </OverlayTable.Cell>
                </OverlayTable.Row>
              ))}
            </OverlayTable.Body>
          </OverlayTable>
        )}
      </OverlayBody>
    </Overlay>
  );
}
