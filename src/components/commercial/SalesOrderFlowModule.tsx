import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  fetchSalesOrderFlowFeatureStatus,
  fetchSalesOrderFlowSummary,
  type SalesOrderFlowSummaryPayload,
} from "@/src/lib/salesOrderFlowClient";
import {
  canViewSalesOrderFlow,
  classifySalesOrderFlowListError,
  SALES_ORDER_FLOW_BREADCRUMB,
} from "@/src/lib/salesOrderFlowUi";

/**
 * Shell da página Comercial → Fluxo de Pedidos (OP-64).
 * Sem kanban/cards/painel lateral — só estados de página + carga do resumo.
 */
export function SalesOrderFlowModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canView = canViewSalesOrderFlow({
    canPerformAction: permissions.canPerformAction,
    hasPermission: auth.hasPermission,
  });

  const [summary, setSummary] = useState<SalesOrderFlowSummaryPayload | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [errorKind, setErrorKind] = useState<
    "access_denied" | "feature_disabled" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);

    void (async () => {
      try {
        const status = await fetchSalesOrderFlowFeatureStatus(controller.signal);
        if (controller.signal.aborted) return;
        setFeatureEnabled(status.enabled);
        if (!status.enabled) {
          setErrorKind("feature_disabled");
          setErrorMessage(
            "Fluxo de Pedidos não está habilitado neste ambiente."
          );
          setSummary(null);
          setHasLoadedOnce(true);
          return;
        }
        const data = await fetchSalesOrderFlowSummary({}, controller.signal);
        if (controller.signal.aborted) return;
        setSummary(data);
        setHasLoadedOnce(true);
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const classified = classifySalesOrderFlowListError(error);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
        setSummary(null);
        setHasLoadedOnce(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [canView, retryToken]);

  if (!canView) {
    return (
      <div
        className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"
        data-testid="sales-order-flow-denied"
      >
        Você não possui permissão para acessar o Fluxo de Pedidos.
      </div>
    );
  }

  const totalOrders =
    summary?.columns.reduce((sum, column) => sum + column.orderCount, 0) ?? 0;
  const showEmpty =
    hasLoadedOnce &&
    !loading &&
    !errorMessage &&
    featureEnabled === true &&
    totalOrders === 0;
  const initialLoading = loading && !hasLoadedOnce;

  return (
    <div className="space-y-4" data-testid="sales-order-flow-module">
      <p
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        data-testid="sales-order-flow-breadcrumb"
      >
        {SALES_ORDER_FLOW_BREADCRUMB}
      </p>

      {initialLoading ? (
        <div
          className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-sm text-muted-foreground"
          data-testid="sales-order-flow-loading"
        >
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Carregando Fluxo de Pedidos…
        </div>
      ) : null}

      {errorMessage ? (
        <div
          className="rounded-xl border border-border bg-card p-6 text-center space-y-3"
          data-testid={
            errorKind === "access_denied"
              ? "sales-order-flow-error-denied"
              : errorKind === "feature_disabled"
                ? "sales-order-flow-feature-disabled"
                : errorKind === "api_unavailable"
                  ? "sales-order-flow-api-unavailable"
                  : "sales-order-flow-error"
          }
          role="alert"
        >
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          {errorKind !== "access_denied" && errorKind !== "feature_disabled" ? (
            <button
              type="button"
              className="inline-flex rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
              data-testid="sales-order-flow-retry"
              onClick={() => setRetryToken((token) => token + 1)}
            >
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}

      {showEmpty ? (
        <div
          className="rounded-xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground"
          data-testid="sales-order-flow-empty"
        >
          Nenhum pedido no fluxo no momento.
        </div>
      ) : null}

      {!initialLoading &&
      !errorMessage &&
      !showEmpty &&
      featureEnabled === true &&
      summary ? (
        <div
          className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
          data-testid="sales-order-flow-shell-ready"
        >
          {totalOrders === 1
            ? "1 pedido no fluxo."
            : `${totalOrders} pedidos no fluxo.`}{" "}
          O quadro Kanban será disponibilizado em seguida.
        </div>
      ) : null}
    </div>
  );
}
