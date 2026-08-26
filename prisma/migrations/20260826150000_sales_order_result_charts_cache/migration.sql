-- Cache materializado dos gráficos da listagem Comercial > Pedidos de Venda
-- (valor vendido YoY + margem % mensal). Uma linha por ano.
-- Aditiva e idempotente: nenhuma tabela existente é tocada.
CREATE TABLE IF NOT EXISTS "SalesOrderResultChartsCache" (
    "year" INTEGER NOT NULL,
    "monthlySalesComparisonJson" JSONB NOT NULL,
    "monthlyCommercialMarginJson" JSONB NOT NULL,
    "computedAt" TIMESTAMPTZ(6) NOT NULL,
    "computeDurationMs" INTEGER,

    CONSTRAINT "SalesOrderResultChartsCache_pkey" PRIMARY KEY ("year")
);
