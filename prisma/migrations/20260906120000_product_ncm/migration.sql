-- Product.ncm: NCM cadastral atual do produto, sincronizado do Nomus /rest/produtos.
-- TEXT (nunca numérico) para preservar zeros à esquerda, ex.: "01234567".
-- Não destrutiva: coluna opcional, sem backfill — o sync oficial de Produtos
-- popula o valor na próxima execução (UPDATE incondicional por linha casada).
ALTER TABLE "Product"
ADD COLUMN "ncm" TEXT;
