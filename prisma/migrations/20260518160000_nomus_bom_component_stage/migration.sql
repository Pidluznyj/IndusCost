-- CreateTable
CREATE TABLE "NomusBomComponentStage" (
    "id" TEXT NOT NULL,
    "externalLineId" INTEGER NOT NULL,
    "listaMateriaisId" INTEGER,
    "listaMateriaisNome" TEXT,
    "listaMateriaisDescricao" TEXT,
    "listaMateriaisAtivo" BOOLEAN,
    "listaMateriaisPadrao" BOOLEAN,
    "listaMateriaisPadraoBlocoK" BOOLEAN,
    "listaMateriaisQtdeBase" DECIMAL(20,6),
    "parentExternalProductId" INTEGER,
    "parentCode" TEXT NOT NULL,
    "parentDescription" TEXT,
    "parentProdutoFantasma" BOOLEAN,
    "parentServicoIndustrializacaoTerceiros" BOOLEAN,
    "componentExternalProductId" INTEGER,
    "componentCode" TEXT NOT NULL,
    "componentDescription" TEXT,
    "componentProdutoFantasma" BOOLEAN,
    "componentServicoIndustrializacaoTerceiros" BOOLEAN,
    "qtdeNecessaria" DECIMAL(20,6),
    "qtdePerdaNormal" DECIMAL(20,6),
    "naturezaConsumo" INTEGER,
    "posicao" INTEGER,
    "alternativo" BOOLEAN,
    "opcional" BOOLEAN,
    "preferencial" BOOLEAN,
    "itemDeEmbarque" BOOLEAN,
    "recebeComponenteTerceirosIndustrializacao" BOOLEAN,
    "remeteComponenteIndustrializacaoTerceiros" BOOLEAN,
    "nomusCreatedAtRaw" TEXT,
    "nomusUpdatedAtRaw" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT,
    "isActiveDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusBomComponentStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NomusBomComponentStage_externalLineId_key" ON "NomusBomComponentStage"("externalLineId");

-- CreateIndex
CREATE INDEX "NomusBomComponentStage_parentCode_idx" ON "NomusBomComponentStage"("parentCode");

-- CreateIndex
CREATE INDEX "NomusBomComponentStage_componentCode_idx" ON "NomusBomComponentStage"("componentCode");

-- CreateIndex
CREATE INDEX "NomusBomComponentStage_listaMateriaisId_idx" ON "NomusBomComponentStage"("listaMateriaisId");

-- CreateIndex
CREATE INDEX "NomusBomComponentStage_parentExternalProductId_idx" ON "NomusBomComponentStage"("parentExternalProductId");

-- CreateIndex
CREATE INDEX "NomusBomComponentStage_componentExternalProductId_idx" ON "NomusBomComponentStage"("componentExternalProductId");

-- CreateIndex
CREATE INDEX "NomusBomComponentStage_isActiveDefault_idx" ON "NomusBomComponentStage"("isActiveDefault");

-- CreateIndex
CREATE INDEX "NomusBomComponentStage_payloadHash_idx" ON "NomusBomComponentStage"("payloadHash");
