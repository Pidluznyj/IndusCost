/**
 * Cascas informativas dos módulos SC controlados (sem operações de negócio).
 */

import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  canViewSupplyChainModule,
} from "@/src/lib/supply-chain/supplyChainAccess";
import type { SupplyChainModuleId } from "@/src/lib/supply-chain/supplyChainFeatureFlags";
import { fetchSupplyChainFeatureStatus } from "@/src/lib/supply-chain/supplyChainClient";

const MODULE_COPY: Record<
  SupplyChainModuleId,
  { title: string; description: string; legacyHint?: { label: string; to: string } }
> = {
  "sc-purchases": {
    title: "Compras SC",
    description:
      "Casca controlada da Cadeia de Suprimentos para evolução de compras (cotações, pedidos). Sem operações de negócio nesta fase.",
    legacyHint: { label: "Abrir Compras (legado)", to: "/purchases" },
  },
  "sc-inventory": {
    title: "Estoque SC",
    description:
      "Módulo controlado da Cadeia de Suprimentos. Almoxarifados/locais e vínculo de MP oficial ao estoque operam em /inventory (permissões operations.inventory.*), com esta casca atrás de SUPPLY_CHAIN_INVENTORY_MODULE_ENABLED.",
    legacyHint: { label: "Abrir Estoque / Almoxarifado", to: "/inventory/items" },
  },
  "sc-receiving": {
    title: "Recebimentos",
    description:
      "Casca controlada de recebimentos físicos. Conferência e entrada em estoque serão implementadas em OPs posteriores.",
  },
};

export function SupplyChainModuleShell({
  moduleId,
}: {
  moduleId: SupplyChainModuleId;
}) {
  const auth = useAuth();
  const permissions = usePermissions();
  const copy = MODULE_COPY[moduleId];
  const [flagEnabled, setFlagEnabled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    void fetchSupplyChainFeatureStatus(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        if (moduleId === "sc-purchases") setFlagEnabled(status.enabled.purchases);
        else if (moduleId === "sc-inventory") setFlagEnabled(status.enabled.inventory);
        else setFlagEnabled(status.enabled.receiving);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFlagEnabled(false);
      });
    return () => controller.abort();
  }, [moduleId]);

  const hasView = canViewSupplyChainModule(moduleId, {
    hasPermission: auth.hasPermission,
  });

  if (permissions.authLoading || flagEnabled === null) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600" data-testid={`sc-shell-loading-${moduleId}`}>
        Carregando módulo…
      </div>
    );
  }

  if (!flagEnabled) {
    return (
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-6 space-y-2"
        data-testid={`sc-shell-disabled-${moduleId}`}
      >
        <h2 className="text-lg font-semibold text-amber-950">{copy.title}</h2>
        <p className="text-sm text-amber-900">
          Módulo desabilitado por feature flag (padrão: desligado). Ative a variável de ambiente correspondente para liberar a casca.
        </p>
        {copy.legacyHint ? (
          <Link className="text-sm font-medium text-amber-950 underline" to={copy.legacyHint.to}>
            {copy.legacyHint.label}
          </Link>
        ) : null}
      </div>
    );
  }

  if (!hasView) {
    return (
      <div
        className="rounded-lg border border-rose-200 bg-rose-50 p-6"
        data-testid={`sc-shell-denied-${moduleId}`}
      >
        <h2 className="text-lg font-semibold text-rose-950">{copy.title}</h2>
        <p className="text-sm text-rose-900 mt-1">
          Sem permissão de visualização deste módulo SC.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-6 space-y-3"
      data-testid={`sc-shell-ready-${moduleId}`}
    >
      <h2 className="text-lg font-semibold text-slate-900">{copy.title}</h2>
      <p className="text-sm text-slate-600">{copy.description}</p>
      <p className="text-xs text-slate-500">
        Flag ativa · operações de negócio ainda não disponíveis nesta fase.
      </p>
      {copy.legacyHint ? (
        <Link className="text-sm font-medium text-slate-800 underline" to={copy.legacyHint.to}>
          {copy.legacyHint.label}
        </Link>
      ) : null}
    </div>
  );
}
