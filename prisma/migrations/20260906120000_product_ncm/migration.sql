-- Product.ncm: NCM cadastral atual do produto, sincronizado do Nomus /rest/produtos.
-- TEXT (nunca numérico) para preservar zeros à esquerda, ex.: "01234567".
-- Não destrutiva: coluna opcional, sem backfill — o sync oficial de Produtos
-- popula o valor na próxima execução (UPDATE incondicional por linha casada).
--
-- Numeração 20260906: a data real desta mudança é 2026-08-11, mas a origin/main
-- já contém migrations até 20260905120000_treasury_reconciliation_idempotency
-- (o histórico do projeto usa identificadores sequenciais que ultrapassaram o
-- calendário). Usar 202608xx quebraria a ordem lexicográfica de aplicação do
-- Prisma; por isso este é o identificador imediatamente posterior à última
-- migration real, seguindo a convenção de hora 120000 do projeto.
ALTER TABLE "Product"
ADD COLUMN "ncm" TEXT;
