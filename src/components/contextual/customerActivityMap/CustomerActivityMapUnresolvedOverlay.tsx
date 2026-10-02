/**
 * Qualidade cadastral: clientes que não chegaram ao município no mapa.
 * Somente leitura — saneamento de cadastro é outra missão.
 */

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Overlay, OverlayBody, OverlayHeader, OverlayTable } from "@/src/components/ui/overlay";
import {
  customerActivityMapApi,
  isAbortError,
  type MapCustomerDetail,
  type MapFilters,
} from "./customerActivityMapApi";

export function CustomerActivityMapUnresolvedOverlay(props: {
  filters: MapFilters;
  reasons: Array<{ reason: string; label: string; count: number }>;
  onClose: () => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const { filters, reasons, onClose, onOpenCustomer } = props;
  const [detail, setDetail] = useState<MapCustomerDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(false);
    customerActivityMapApi
      .customers(filters, { unresolved: true }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((err) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setError(true);
      });
    return () => controller.abort();
  }, [filters]);

  return (
    <Overlay
      open
      onClose={onClose}
      size="lg"
      ariaLabelledBy="customer-activity-map-unresolved-title"
      testId="customer-activity-map-unresolved"
    >
      <OverlayHeader
        titleId="customer-activity-map-unresolved-title"
        eyebrow="Clientes · Mapa de Atuação"
        title="Clientes sem localização precisa"
        subtitle="Cadastros em que cidade e UF não bastaram para posicionar o cliente no município."
        onClose={onClose}
      />
      <OverlayBody>
        {reasons.length > 0 ? (
          <ul className="mb-4 flex flex-wrap gap-2">
            {reasons.map((entry) => (
              <li
                key={entry.reason}
                className="rounded-full border border-border bg-accent/30 px-3 py-1 text-xs"
              >
                {entry.label}: <strong className="tabular-nums">{entry.count.toLocaleString("pt-BR")}</strong>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="py-8 text-center text-sm text-destructive" role="alert">
            Não foi possível carregar os registros.
          </p>
        ) : !detail ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Carregando registros…
          </div>
        ) : detail.customers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Todos os clientes deste recorte estão posicionados no município.
          </p>
        ) : (
          <>
            <OverlayTable stickyHeader minWidth={640}>
              <OverlayTable.Head>
                <OverlayTable.Row>
                  <OverlayTable.HeadCell>Cliente</OverlayTable.HeadCell>
                  <OverlayTable.HeadCell>Cidade (cadastro)</OverlayTable.HeadCell>
                  <OverlayTable.HeadCell>UF (cadastro)</OverlayTable.HeadCell>
                  <OverlayTable.HeadCell>Motivo</OverlayTable.HeadCell>
                  <OverlayTable.HeadCell>Ação</OverlayTable.HeadCell>
                </OverlayTable.Row>
              </OverlayTable.Head>
              <OverlayTable.Body>
                {detail.customers.map((customer) => (
                  <OverlayTable.Row key={customer.id}>
                    <OverlayTable.Cell>
                      <span className="font-medium">{customer.companyName}</span>
                      {customer.tradeName ? (
                        <span className="block text-xs text-muted-foreground">{customer.tradeName}</span>
                      ) : null}
                    </OverlayTable.Cell>
                    <OverlayTable.Cell>{customer.city?.trim() || "—"}</OverlayTable.Cell>
                    <OverlayTable.Cell>{customer.state?.trim() || "—"}</OverlayTable.Cell>
                    <OverlayTable.Cell>{customer.reason ?? "—"}</OverlayTable.Cell>
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
            {detail.truncated ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Mostrando {detail.customers.length.toLocaleString("pt-BR")} de{" "}
                {detail.total.toLocaleString("pt-BR")} registros.
              </p>
            ) : null}
          </>
        )}
      </OverlayBody>
    </Overlay>
  );
}
