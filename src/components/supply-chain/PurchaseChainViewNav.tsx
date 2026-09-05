/**
 * Navegação entre as vistas da cadeia de compras.
 *
 * Existe porque cada tela da cadeia resolvia isso sozinha: a lista de
 * solicitações tinha quatro botões com cara de ação primária, Cotações tinha um
 * "Voltar às solicitações" solto e Recebimento não tinha nada. O usuário não
 * conseguia dizer em que etapa estava nem ir para a vizinha sem passar pelo
 * menu lateral.
 *
 * A faixa nomeia a vista atual (não clicável, `aria-current`) e leva às outras
 * na ordem do fluxo — solicitação, cotação, pedido, recebimento.
 */
import React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/src/lib/utils";

export type PurchaseChainViewId =
  | "requests"
  | "quotations"
  | "orders"
  | "nomus-orders"
  | "receiving"
  | "workstation";

const VIEWS: ReadonlyArray<{ id: PurchaseChainViewId; label: string; to: string }> = [
  { id: "requests", label: "Solicitações", to: "/purchases" },
  { id: "quotations", label: "Cotações", to: "/purchases/quotations" },
  { id: "orders", label: "Pedidos", to: "/purchases/orders" },
  { id: "nomus-orders", label: "Pedidos Nomus", to: "/purchases/nomus-orders" },
  { id: "receiving", label: "Recebimento", to: "/purchases/receiving" },
  { id: "workstation", label: "Estação", to: "/purchases/workstation" },
];

export function PurchaseChainViewNav({
  current,
  className,
}: {
  current: PurchaseChainViewId;
  className?: string;
}) {
  return (
    <nav
      aria-label="Cadeia de compras"
      data-testid="purchase-chain-view-nav"
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1",
        className
      )}
    >
      {VIEWS.map((view) =>
        view.id === current ? (
          <span
            key={view.id}
            aria-current="page"
            className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border"
          >
            {view.label}
          </span>
        ) : (
          <Link
            key={view.id}
            to={view.to}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-white/70 hover:text-foreground"
          >
            {view.label}
          </Link>
        )
      )}
    </nav>
  );
}
