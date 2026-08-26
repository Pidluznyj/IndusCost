/**
 * Exclusão lógica de pesquisa — gates ESTRUTURAIS.
 *
 * O comportamento do serviço (soft delete transacional, revogação de tokens/
 * sessões, filtro nas listagens, recusa do link público) é testado em
 * `satisfactionService.test.ts` com o Prisma falso. Aqui travamos o que o
 * teste de serviço não enxerga: a ROTA exige SUPER_ADMIN + confirmCode, a UI
 * só oferece o botão ao Super administrador e obriga a digitar o código, e
 * nenhuma camada de leitura esqueceu o filtro `deletedAt`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("exclusão lógica — rota DELETE", () => {
  const routes = readSource("./satisfactionRoutes.ts");

  it("existe UMA única rota DELETE de campanha (nada sombreado)", () => {
    const occurrences =
      routes.match(/app\.delete\(\s*\r?\n?\s*"\/api\/commercial\/satisfaction\/campaigns\/:id"/g) ??
      [];
    assert.equal(
      occurrences.length,
      1,
      "duas rotas DELETE no mesmo path deixariam uma delas morta (Express usa a primeira)"
    );
  });

  it("ELIMINATÓRIO: a rota recusa quem não é SUPER_ADMIN", () => {
    assert.ok(
      routes.includes('user.role !== "SUPER_ADMIN"'),
      "checagem de papel no servidor — a UI esconder o botão não basta"
    );
    assert.ok(
      routes.includes("Apenas o Super administrador"),
      "mensagem de recusa explícita"
    );
  });

  it("ELIMINATÓRIO: o servidor exige confirmCode idêntico ao código da pesquisa", () => {
    assert.ok(
      routes.includes("confirmCode !== campaign.code"),
      "sem confirmação dupla, uma chamada solta de API excluiria por engano"
    );
    assert.ok(
      routes.includes("softDeleteCampaign"),
      "a rota chama a exclusão LÓGICA, nunca a física"
    );
  });

  it("a exclusão física de rascunho não tem exposição HTTP", () => {
    // O método interno continua existindo no serviço, mas nenhuma rota o chama.
    assert.ok(
      !/campaigns\.deleteCampaign\(/.test(routes),
      "deleteCampaign (físico) não pode ser alcançável por rota"
    );
  });
});

describe("exclusão lógica — UI do grid", () => {
  const panel = readSource(
    "../../components/commercial/satisfaction/SatisfactionSurveysPanel.tsx"
  );
  const module_ = readSource(
    "../../components/commercial/satisfaction/SatisfactionModule.tsx"
  );

  it("botão Excluir só aparece para o Super administrador", () => {
    assert.ok(
      panel.includes('data-testid="satisfaction-campaign-delete"'),
      "botão de excluir presente"
    );
    const buttonBlock = panel.slice(
      panel.indexOf("props.isSuperAdmin ?"),
      panel.indexOf('data-testid="satisfaction-campaign-delete"')
    );
    assert.ok(
      buttonBlock.length > 0 && buttonBlock.length < 400,
      "o botão deve estar imediatamente condicionado a props.isSuperAdmin"
    );
  });

  it("ELIMINATÓRIO: confirmar exige DIGITAR o código exato da pesquisa", () => {
    assert.ok(
      panel.includes("deleteCode.trim() !== deleteTarget.code"),
      "botão de confirmação desabilitado até o código digitado bater"
    );
    assert.ok(
      panel.includes('data-testid="satisfaction-campaign-delete-confirm"'),
      "botão de confirmação identificável"
    );
    assert.ok(
      !panel.includes('window.confirm(`Excluir'),
      "window.confirm seria confirmação fraca demais para exclusão"
    );
  });

  it("o módulo injeta isSuperAdmin a partir do AuthContext oficial", () => {
    assert.ok(
      module_.includes("isSuperAdmin } = useAuth()") ||
        module_.includes("isSuperAdmin,") ||
        module_.includes(", isSuperAdmin"),
      "isSuperAdmin vem do useAuth"
    );
    assert.ok(
      module_.includes("isSuperAdmin={isSuperAdmin()}"),
      "painel recebe o papel resolvido, não um hardcode"
    );
  });
});

describe("exclusão lógica — nenhuma leitura esqueceu o filtro", () => {
  it("analytics filtra deletedAt em respostas, evolução (SQL) e convites", () => {
    const analytics = readSource("./satisfactionAnalytics.server.ts");
    const prismaFilters = analytics.match(/campaign:\s*\{\s*deletedAt:\s*null\s*\}/g) ?? [];
    assert.ok(
      prismaFilters.length >= 2,
      `esperava >=2 filtros prisma { campaign: { deletedAt: null } }, achou ${prismaFilters.length}`
    );
    assert.ok(
      analytics.includes('"deletedAt" IS NULL'),
      "a query crua da evolução também precisa do filtro"
    );
  });

  it("serviço de campanha: listagem filtra e getCampaign trata como inexistente", () => {
    const service = readSource("./satisfactionCampaignService.server.ts");
    assert.ok(service.includes("{ deletedAt: null }"), "where base da listagem");
    assert.ok(
      service.includes("!campaign || campaign.deletedAt"),
      "campanha excluída = não encontrada"
    );
  });

  it("superfície pública recusa token de campanha excluída", () => {
    const publicService = readSource("./satisfactionPublicService.server.ts");
    assert.ok(
      publicService.includes("accessToken.campaign.deletedAt"),
      "troca de token precisa checar deletedAt da campanha"
    );
  });

  it("migration é aditiva e idempotente (ADD COLUMN IF NOT EXISTS)", () => {
    const migration = readSource(
      "../../../prisma/migrations/20260826120000_satisfaction_campaign_soft_delete/migration.sql"
    );
    assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "deletedAt"'));
    assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "deletedByUserId"'));
    // "deletedAt" contém a palavra DELETE — o gate mira COMANDOS destrutivos.
    assert.ok(
      !/\bDROP\s|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/i.test(migration),
      "nada destrutivo"
    );
  });
});
