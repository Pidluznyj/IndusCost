-- Data COMERCIAL da proposta como coluna gerada e indexada.
--
-- MOTIVO
-- A listagem filtrava, ordenava e contava por `createdAt`, que para proposta
-- importada é o instante em que o sync rodou — não a data de abertura no Nomus.
-- A CP 01350 foi aberta em 03/08/2026 e importada em 04/08/2026: aparecia,
-- ordenava e era contada como 04/08.
--
-- A regra é `externalOpenedAt` quando a proposta tem origem externa, senão
-- `createdAt`. O Prisma não expressa COALESCE em `orderBy`, e ordenar em
-- memória quebraria a paginação (a página seria ordenada, não o conjunto).
-- Uma coluna GERADA resolve os três usos de uma vez — filtro, ordenação e
-- contagem — sem SQL cru espalhado e sem custo de escrita pela aplicação.
--
-- POR QUE A EXPRESSÃO É ESCRITA ASSIM
-- `externalOpenedAt` é TIMESTAMPTZ(6) e `createdAt` é TIMESTAMP(3) SEM fuso
-- (Prisma DateTime sem @db). `COALESCE(timestamptz, timestamp)` exige cast
-- implícito que depende do parâmetro TimeZone da sessão — logo NÃO é
-- IMMUTABLE, e o Postgres recusaria a coluna gerada.
-- `timezone(text, timestamp)` NÃO depende do TimeZone da sessão e é marcada
-- IMMUTABLE no catálogo; por isso o fuso operacional entra explícito. É o
-- mesmo critério já usado no domínio (`resolveProposalCommercialDate`) e no
-- parser (`nomusDateTime.ts`).
--
-- `btrim(sourceSystem) <> ''` espelha `isExternalSourcedProposal`: string
-- vazia ou só espaços não conta como origem externa.
--
-- SEGURANÇA
-- Coluna GERADA é somente leitura: o Postgres a mantém, a aplicação nunca
-- escreve, e não há como divergir do par (externalOpenedAt, createdAt).
-- Nenhum dado existente é alterado.

ALTER TABLE "Proposal"
  ADD COLUMN IF NOT EXISTS "commercialDate" TIMESTAMPTZ(6)
  GENERATED ALWAYS AS (
    CASE
      WHEN "sourceSystem" IS NOT NULL
       AND btrim("sourceSystem") <> ''
       AND "externalOpenedAt" IS NOT NULL
        THEN "externalOpenedAt"
      ELSE timezone('America/Sao_Paulo', "createdAt")
    END
  ) STORED;

-- Serve a ordenação padrão da listagem (data desc, número desc) e o recorte
-- por período, sem varrer a tabela.
CREATE INDEX IF NOT EXISTS "Proposal_commercialDate_number_idx"
  ON "Proposal" ("commercialDate" DESC, "number" DESC);
