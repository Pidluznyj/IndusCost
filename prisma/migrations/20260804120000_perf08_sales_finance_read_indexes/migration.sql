-- PERFORMANCE 08 — índices de leitura Pedidos + Financeiro (somente P1 aprovados).
-- Sem alteração de colunas, dados ou constraints funcionais.
-- Parciais AR/AP: só títulos em aberto (balance > 0) — Prisma não modela WHERE em @@index.
-- Índice criado dentro da transação da migration Prisma (sem modo concorrente).

-- SalesOrder: ORDER BY createdAt DESC, issueDate DESC da listagem / aggregate page.
CREATE INDEX IF NOT EXISTS "SalesOrder_createdAt_issueDate_idx"
  ON "SalesOrder" ("createdAt" DESC, "issueDate" DESC);

-- SalesOrder: filtro e seller-options por vendedor Nomus.
CREATE INDEX IF NOT EXISTS "SalesOrder_externalSellerId_idx"
  ON "SalesOrder" ("externalSellerId");

-- AR aberto: dashboards / horizonte / CF / due-radar (WHERE balanceReceivable > 0 ORDER BY dueDate).
CREATE INDEX IF NOT EXISTS "NomusAccountsReceivable_open_dueDate_idx"
  ON "NomusAccountsReceivable" ("dueDate" ASC)
  WHERE "balanceReceivable" > 0;

-- AP aberto: dashboards / CF / due-radar (WHERE balancePayable > 0 ORDER BY dueDate).
CREATE INDEX IF NOT EXISTS "NomusAccountsPayable_open_dueDate_idx"
  ON "NomusAccountsPayable" ("dueDate" ASC)
  WHERE "balancePayable" > 0;
