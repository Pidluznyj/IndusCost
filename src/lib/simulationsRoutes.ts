/**
 * Rotas do módulo Simulações da Engenharia (cenários existentes + novo produto).
 *
 * Fronteira de domínio: SIMULAÇÃO ESTIMA. Estas rotas só escrevem em `Simulation` e
 * `NewProductSimulation`. Leem produto, material, regra fiscal e custo (LIVE/PUBLISHED) como
 * referência e nunca publicam custo, nunca escrevem ProductPricing nem tabela de preço.
 */
import type express from "express";
import type { RequestHandler } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveDefaultProcessHourCostsFromAnalysisCache } from "./componentStandardProcessCost.js";
import { ENGINEERING_RESOURCE_KEYS } from "./engineeringAccess.js";
import {
  computeNewProductSimulationSnapshot,
  NEW_PRODUCT_SIMULATION_ORIGIN,
  type NewProductSimulationComputeDeps,
} from "./newProductSimulation.server.js";
import {
  buildCloneDraftData,
  persistedStatusFromApiRecord,
  NEW_PRODUCT_SNAPSHOT_SCHEMA_VERSION,
} from "./newProductSimulationSnapshot.js";
import {
  isProductCostBaselineSource,
  NO_PUBLISHED_COST_MESSAGE,
  productCostBaselineBadge,
  productCostBaselineLabel,
} from "./productCostBaseline.js";
import {
  resolveProductCostBaseline,
  type ProductCostBaselineEngine,
} from "./productCostBaseline.server.js";
import {
  buildScenarioBaselineSnapshot,
  computeLegacyScenarioComparison,
  computeScenarioComparison,
  parseScenarioBaselineSnapshot,
  type ScenarioPricingPremises,
} from "./simulationScenario.js";
import {
  isUuidString,
  parseNewProductSaveBody,
  parseNewProductSimulationInputs,
  parseScenarioCreateBody,
} from "./simulationsValidation.js";

export type SimulationsRouteGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (
    req: express.Request
  ) => Promise<{ id: string; name?: string | null; email?: string | null } | null>;
};

export type SimulationsRouteDeps = {
  prisma: PrismaClient;
  engine: ProductCostBaselineEngine;
  /** Injeção para testes (leitor de custo publicado / resolver). */
  compute?: NewProductSimulationComputeDeps;
  now?: () => Date;
};

const RESOURCE = ENGINEERING_RESOURCE_KEYS.simulations;
export const SIMULATION_PRODUCT_OPTIONS_MAX_LIMIT = 30;
const PRODUCT_OPTIONS_MIN_CHARS = 2;

type AsyncHandler = (req: express.Request, res: express.Response) => Promise<unknown>;

/**
 * Express 4 não encaminha rejeições de handlers async: sem isto, um erro do Prisma vira
 * rejeição não tratada. Todo handler deste módulo passa por aqui.
 */
export function asyncRoute(label: string, handler: AsyncHandler): RequestHandler {
  return (req, res) => {
    handler(req, res).catch((error: unknown) => {
      const code = (error as { code?: string } | null)?.code;
      if (res.headersSent) return;
      if (code === "P2025") {
        res.status(404).json({ error: "NOT_FOUND", message: "Registro não encontrado." });
        return;
      }
      if (code === "P2023" || code === "P2009" || code === "P2019") {
        res.status(400).json({ error: "INVALID_INPUT", message: "Dados inválidos." });
        return;
      }
      console.error(label, error);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno ao processar a simulação." });
    });
  };
}

function invalidId(res: express.Response) {
  return res.status(400).json({ error: "INVALID_ID", message: "Identificador inválido." });
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function registerSimulationsRoutes(
  app: express.Application,
  guards: SimulationsRouteGuards,
  deps: SimulationsRouteDeps
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;
  const { prisma, engine } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const view = [requireAppAuth, requireResource(RESOURCE, "view")] as const;
  const create = [requireAppAuth, requireResource(RESOURCE, "create")] as const;
  const update = [requireAppAuth, requireResource(RESOURCE, "update")] as const;
  const remove = [requireAppAuth, requireResource(RESOURCE, "delete")] as const;

  /** Autoria sempre da sessão autenticada — nunca do corpo da requisição. */
  async function sessionAuthor(req: express.Request): Promise<{ id: string | null; name: string | null }> {
    const user = await getCurrentAppUser(req);
    return {
      id: user && isUuidString(user.id) ? user.id : null,
      name: user?.name?.trim() || user?.email?.trim() || null,
    };
  }

  async function loadPricingPremises(
    productId: string,
    taxRuleId: string
  ): Promise<ScenarioPricingPremises | null> {
    // Leitura das premissas vigentes como REFERÊNCIA do cenário; ProductPricing não é alterado.
    const pricing = await prisma.productPricing.findUnique({
      where: { productId_taxRuleId: { productId, taxRuleId } },
      include: { TaxRule: { include: { TaxComponent: true } } },
    });
    if (!pricing) return null;
    return {
      taxRuleId,
      taxRuleName: pricing.TaxRule.name,
      taxRatePct: pricing.TaxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0),
      commRatePct: toNumber(pricing.commission),
      otherRatePct: toNumber(pricing.otherVariables),
      marginRatePct: toNumber(pricing.desiredMargin),
      freight: toNumber(pricing.freightOut),
    };
  }

  // ------------------------------------------------------------------ auxiliares

  app.get(
    "/api/simulations/default-process-hour-costs",
    ...view,
    asyncRoute("GET /api/simulations/default-process-hour-costs", async (_req, res) => {
      const unavailable = {
        error: "Não foi possível carregar o custo default de HH/HM. Verifique Configurações Gerais.",
        available: false,
      };
      try {
        const cache = await engine.initAnalysisCache();
        const costs = resolveDefaultProcessHourCostsFromAnalysisCache(cache);
        if (!costs.available) return res.status(503).json(unavailable);
        return res.json({
          globalHhCostPerHour: costs.globalHhCostPerHour,
          machineHourCostPerHour: costs.machineHourCostPerHour,
          hhSource: costs.hhSource,
          workingHours: cache.workingHours,
          energyCost: cache.energyCost,
          available: true,
        });
      } catch (err) {
        console.error("default-process-hour-costs error:", err);
        return res.status(503).json(unavailable);
      }
    })
  );

  /** Busca leve de produtos/componentes (sem rodar o motor de custo). */
  app.get(
    "/api/simulations/product-options",
    ...view,
    asyncRoute("GET /api/simulations/product-options", async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
      const limitRaw = Number(req.query.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw >= 1
          ? Math.min(Math.floor(limitRaw), SIMULATION_PRODUCT_OPTIONS_MAX_LIMIT)
          : SIMULATION_PRODUCT_OPTIONS_MAX_LIMIT;
      const ids =
        typeof req.query.ids === "string"
          ? req.query.ids.split(",").map((id) => id.trim()).filter(isUuidString).slice(0, 200)
          : [];
      if (ids.length === 0 && q.length < PRODUCT_OPTIONS_MIN_CHARS) {
        return res.json({ q, items: [], minChars: PRODUCT_OPTIONS_MIN_CHARS });
      }
      const where: Prisma.ProductWhereInput =
        ids.length > 0
          ? { id: { in: ids } }
          : {
              type: { in: ["PRODUCT", "COMPONENT"] },
              OR: [
                { sku: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            };
      const rows = await prisma.product.findMany({
        where,
        select: { id: true, sku: true, name: true, type: true, status: true },
        orderBy: { sku: "asc" },
        take: ids.length > 0 ? ids.length : limit,
      });
      return res.json({ q, items: rows, minChars: PRODUCT_OPTIONS_MIN_CHARS });
    })
  );

  /** Custo base de um produto existente na fonte escolhida (somente leitura). */
  app.get(
    "/api/simulations/product-baseline",
    ...view,
    asyncRoute("GET /api/simulations/product-baseline", async (req, res) => {
      const productId = typeof req.query.productId === "string" ? req.query.productId.trim() : "";
      if (!isUuidString(productId)) return invalidId(res);
      const source = req.query.source;
      if (!isProductCostBaselineSource(source)) {
        return res
          .status(400)
          .json({ error: "INVALID_BASELINE_SOURCE", message: "Base deve ser PUBLISHED ou LIVE." });
      }
      const baseline = await resolveProductCostBaseline(
        prisma,
        engine,
        { productId, source, context: "ENGINEERING_SCENARIO", includeOwnProcess: true },
        deps.compute
      );
      return res.json({
        ...baseline,
        label: productCostBaselineLabel(source),
        badge: productCostBaselineBadge(source),
      });
    })
  );

  // ------------------------------------------------------------------ cenários existentes

  app.get(
    "/api/simulations",
    ...view,
    asyncRoute("GET /api/simulations", async (req, res) => {
      const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
      const rows = await prisma.simulation.findMany({
        where: includeArchived ? undefined : { archivedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          description: true,
          productId: true,
          taxRuleId: true,
          materialAdj: true,
          laborAdj: true,
          indirectAdj: true,
          efficiencyAdj: true,
          marginAdj: true,
          baselineSource: true,
          baselineProductionCostVersionId: true,
          baselineRevision: true,
          baselineCalculatedAt: true,
          createdByName: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      // Nome/SKU do produto para os cards (o cenário não tem FK; produto pode ter sido removido).
      const productIds = [...new Set(rows.map((r) => r.productId))];
      const products =
        productIds.length > 0
          ? await prisma.product.findMany({
              where: { id: { in: productIds } },
              select: { id: true, sku: true, name: true },
            })
          : [];
      const productById = new Map(products.map((p) => [p.id, p]));
      return res.json(
        rows.map((row) => ({
          ...row,
          productSku: productById.get(row.productId)?.sku ?? null,
          productName: productById.get(row.productId)?.name ?? null,
          baselineLabel: productCostBaselineLabel(
            isProductCostBaselineSource(row.baselineSource) ? row.baselineSource : null
          ),
          baselineBadge: productCostBaselineBadge(
            isProductCostBaselineSource(row.baselineSource) ? row.baselineSource : null
          ),
        }))
      );
    })
  );

  app.post(
    "/api/simulations",
    ...create,
    asyncRoute("POST /api/simulations", async (req, res) => {
      const parsed = parseScenarioCreateBody(req.body);
      if (parsed.ok === false) return res.status(400).json({ error: parsed.code, message: parsed.message });
      const input = parsed.value;

      const product = await prisma.product.findUnique({
        where: { id: input.productId },
        select: { id: true },
      });
      if (!product) {
        return res.status(404).json({ error: "PRODUCT_NOT_FOUND", message: "Produto base não encontrado." });
      }
      const pricing = await loadPricingPremises(input.productId, input.taxRuleId);
      if (!pricing) {
        return res.status(422).json({
          error: "PRICING_PREMISES_NOT_FOUND",
          message:
            "Não há premissas de preço cadastradas para este produto nesta regra fiscal. Cadastre-as na Formação de Preço ou escolha outra regra.",
        });
      }

      const capturedAt = now();
      const cost = await resolveProductCostBaseline(
        prisma,
        engine,
        {
          productId: input.productId,
          source: input.baselineSource,
          referenceDate: capturedAt,
          context: "ENGINEERING_SCENARIO",
          includeOwnProcess: true,
        },
        { ...deps.compute, now: () => capturedAt }
      );
      if (cost.status !== "OK") {
        if (cost.status === "NO_PUBLISHED_COST") {
          // Sem fallback automático para LIVE: a escolha precisa ser explícita.
          return res.status(422).json({
            error: "NO_PUBLISHED_COST",
            message: `${NO_PUBLISHED_COST_MESSAGE} Para simular mesmo assim, escolha «Engenharia atual (não publicada)».`,
          });
        }
        return res
          .status(cost.status === "PRODUCT_NOT_FOUND" ? 404 : 422)
          .json({ error: cost.status, message: cost.message });
      }

      const baselineSnapshot = buildScenarioBaselineSnapshot({ cost, pricing, capturedAt });
      const adjustments = {
        materialAdjPct: input.materialAdj,
        laborAdjPct: input.laborAdj,
        hmAdjPct: input.indirectAdj,
        efficiencyAdjPct: input.efficiencyAdj,
        marginAdjPct: input.marginAdj,
      };
      const comparison = computeScenarioComparison(baselineSnapshot, adjustments);
      if (comparison.costIssue) {
        return res
          .status(422)
          .json({ error: comparison.costIssue.code, message: comparison.costIssue.message });
      }

      const author = await sessionAuthor(req);
      const created = await prisma.simulation.create({
        data: {
          name: input.name,
          description: input.description,
          productId: input.productId,
          taxRuleId: input.taxRuleId,
          materialAdj: input.materialAdj,
          laborAdj: input.laborAdj,
          indirectAdj: input.indirectAdj,
          efficiencyAdj: input.efficiencyAdj,
          marginAdj: input.marginAdj,
          baselineSource: cost.source,
          baselineProductionCostVersionId: cost.productionCostVersionId,
          baselineRevision: cost.productionCostRevision,
          baselineCalculatedAt: capturedAt,
          baselineSnapshot: baselineSnapshot as unknown as Prisma.InputJsonValue,
          createdByUserId: author.id,
          createdByName: author.name,
        },
      });
      return res.status(201).json({ ...created, comparison });
    })
  );

  /** Cenário não é apagado: é arquivado (histórico preservado). */
  app.delete(
    "/api/simulations/:id",
    ...remove,
    asyncRoute("DELETE /api/simulations/:id", async (req, res) => {
      const { id } = req.params;
      if (!isUuidString(id)) return invalidId(res);
      const existing = await prisma.simulation.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
      if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Simulação não encontrada." });
      if (!existing.archivedAt) {
        const author = await sessionAuthor(req);
        await prisma.simulation.update({
          where: { id },
          data: { archivedAt: now(), archivedByUserId: author.id, archivedByName: author.name },
        });
      }
      return res.json({ success: true, archived: true });
    })
  );

  app.post(
    "/api/simulations/:id/unarchive",
    ...update,
    asyncRoute("POST /api/simulations/:id/unarchive", async (req, res) => {
      const { id } = req.params;
      if (!isUuidString(id)) return invalidId(res);
      const existing = await prisma.simulation.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Simulação não encontrada." });
      await prisma.simulation.update({
        where: { id },
        data: { archivedAt: null, archivedByUserId: null, archivedByName: null },
      });
      return res.json({ success: true, archived: false });
    })
  );

  app.get(
    "/api/simulations/:id/compare",
    ...view,
    asyncRoute("GET /api/simulations/:id/compare", async (req, res) => {
      const { id } = req.params;
      if (!isUuidString(id)) return invalidId(res);
      const sim = await prisma.simulation.findUnique({ where: { id } });
      if (!sim) return res.status(404).json({ error: "NOT_FOUND", message: "Simulação não encontrada." });

      const adjustments = {
        materialAdjPct: toNumber(sim.materialAdj),
        laborAdjPct: toNumber(sim.laborAdj),
        hmAdjPct: toNumber(sim.indirectAdj),
        efficiencyAdjPct: toNumber(sim.efficiencyAdj),
        marginAdjPct: toNumber(sim.marginAdj),
      };
      const scenario = {
        id: sim.id,
        name: sim.name,
        createdAt: sim.createdAt,
        createdByName: sim.createdByName,
        archivedAt: sim.archivedAt,
        adjustments,
      };

      const baseline = parseScenarioBaselineSnapshot(sim.baselineSnapshot);
      if (baseline) {
        return res.json({ scenario, ...computeScenarioComparison(baseline, adjustments) });
      }

      // Registro legado: sem base congelada — engenharia atual, rotulada como tal.
      const pricing = await loadPricingPremises(sim.productId, sim.taxRuleId);
      if (!pricing) {
        return res
          .status(404)
          .json({ error: "PRICING_PREMISES_NOT_FOUND", message: "Configuração de preço base não encontrada." });
      }
      const live = await resolveProductCostBaseline(prisma, engine, {
        productId: sim.productId,
        source: "LIVE",
        context: "ENGINEERING_SCENARIO",
      });
      if (live.status !== "OK") {
        return res
          .status(live.status === "PRODUCT_NOT_FOUND" ? 404 : 422)
          .json({ error: live.status, message: live.message });
      }
      return res.json({
        scenario,
        ...computeLegacyScenarioComparison(
          {
            name: live.name,
            sku: live.sku,
            mp: live.totalMaterialCost,
            hh: live.totalHHUnit,
            hm: live.totalHMUnit,
            calculatedAt: live.calculatedAt ?? now().toISOString(),
          },
          pricing,
          adjustments
        ),
      });
    })
  );

  // ------------------------------------------------------------------ novo produto

  const SUMMARY_SELECT = {
    id: true,
    name: true,
    status: true,
    sourceSimulationId: true,
    productName: true,
    productSku: true,
    savedAt: true,
    createdAt: true,
    createdByName: true,
    archivedAt: true,
    schemaVersion: true,
  } as const;

  app.get(
    "/api/new-product-simulations",
    ...view,
    asyncRoute("GET /api/new-product-simulations", async (req, res) => {
      const status = String(req.query.status ?? "").toUpperCase();
      const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
      const where: Prisma.NewProductSimulationWhereInput =
        status === "SAVED" || status === "DRAFT" || status === "ARCHIVED"
          ? { status }
          : includeArchived
            ? {}
            : { status: { in: ["SAVED", "DRAFT"] } };
      const rows = await prisma.newProductSimulation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: SUMMARY_SELECT,
      });
      return res.json(rows);
    })
  );

  app.get(
    "/api/new-product-simulations/:id",
    ...view,
    asyncRoute("GET /api/new-product-simulations/:id", async (req, res) => {
      const { id } = req.params;
      if (!isUuidString(id)) return invalidId(res);
      const row = await prisma.newProductSimulation.findUnique({ where: { id } });
      if (!row) {
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Simulação de novo produto não encontrada." });
      }
      return res.json(row);
    })
  );

  /** Calcula no servidor sem gravar — a tela mostra exatamente o que seria salvo. */
  app.post(
    "/api/new-product-simulations/preview",
    ...create,
    asyncRoute("POST /api/new-product-simulations/preview", async (req, res) => {
      const parsed = parseNewProductSimulationInputs((req.body as { inputs?: unknown } | null)?.inputs);
      if (parsed.ok === false) return res.status(400).json({ error: parsed.code, message: parsed.message });
      const author = await sessionAuthor(req);
      const computed = await computeNewProductSimulationSnapshot(
        prisma,
        engine,
        parsed.value,
        { now: now(), author },
        deps.compute
      );
      if (computed.ok === false) {
        return res
          .status(computed.httpStatus)
          .json({ error: computed.code, message: computed.message, details: computed.details ?? [] });
      }
      return res.json({ snapshot: computed.snapshot, snapshotHash: computed.snapshotHash });
    })
  );

  app.post(
    "/api/new-product-simulations/save",
    ...create,
    asyncRoute("POST /api/new-product-simulations/save", async (req, res) => {
      const parsed = parseNewProductSaveBody(req.body);
      if (parsed.ok === false) return res.status(400).json({ error: parsed.code, message: parsed.message });
      const { inputs, freeze, draftId } = parsed.value;

      let draft: { id: string; status: string; createdAt: Date | null; sourceSimulationId: string | null } | null =
        null;
      if (draftId) {
        draft = await prisma.newProductSimulation.findUnique({
          where: { id: draftId },
          select: { id: true, status: true, createdAt: true, sourceSimulationId: true },
        });
        if (!draft) {
          return res.status(404).json({ error: "NOT_FOUND", message: "Rascunho da simulação não encontrado." });
        }
        if (draft.status !== "DRAFT") {
          // Simulação congelada não é alterada in-place.
          return res.status(409).json({
            error: "SIMULATION_FROZEN",
            message: "Esta simulação está congelada e não pode ser alterada. Clone para editar.",
          });
        }
      }

      const savedAt = now();
      const author = await sessionAuthor(req);
      const computed = await computeNewProductSimulationSnapshot(
        prisma,
        engine,
        inputs,
        { now: savedAt, author, createdAt: draft?.createdAt ?? null },
        deps.compute
      );
      if (computed.ok === false) {
        return res
          .status(computed.httpStatus)
          .json({ error: computed.code, message: computed.message, details: computed.details ?? [] });
      }

      const data = {
        name: inputs.simulationName,
        status: freeze ? ("SAVED" as const) : ("DRAFT" as const),
        productName: inputs.productName,
        productSku: inputs.productSku,
        notes: inputs.notes,
        snapshot: computed.snapshot as unknown as Prisma.InputJsonValue,
        snapshotHash: computed.snapshotHash,
        schemaVersion: NEW_PRODUCT_SNAPSHOT_SCHEMA_VERSION,
        savedAt: freeze ? savedAt : null,
        origin: NEW_PRODUCT_SIMULATION_ORIGIN,
      };

      if (draft) {
        // Guarda otimista: só atualiza se ainda for rascunho (corrida com outro congelamento).
        const updated = await prisma.newProductSimulation.updateMany({
          where: { id: draft.id, status: "DRAFT" },
          data,
        });
        if (updated.count === 0) {
          return res.status(409).json({
            error: "SIMULATION_FROZEN",
            message: "Esta simulação foi congelada por outra sessão. Clone para editar.",
          });
        }
        const row = await prisma.newProductSimulation.findUnique({ where: { id: draft.id } });
        return res.json(row);
      }

      const created = await prisma.newProductSimulation.create({
        data: {
          ...data,
          createdBy: author.name,
          createdByUserId: author.id,
          createdByName: author.name,
        },
      });
      return res.status(201).json(created);
    })
  );

  app.post(
    "/api/new-product-simulations/:id/clone",
    ...create,
    asyncRoute("POST /api/new-product-simulations/:id/clone", async (req, res) => {
      const { id } = req.params;
      if (!isUuidString(id)) return invalidId(res);
      const source = await prisma.newProductSimulation.findUnique({
        where: { id },
        select: { id: true, name: true, snapshot: true, schemaVersion: true },
      });
      if (!source) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Simulação de origem não encontrada." });
      }
      const author = await sessionAuthor(req);
      const cloneData = buildCloneDraftData(source);
      const created = await prisma.newProductSimulation.create({
        data: {
          ...cloneData,
          snapshot: cloneData.snapshot as unknown as Prisma.InputJsonValue,
          schemaVersion: source.schemaVersion,
          origin: NEW_PRODUCT_SIMULATION_ORIGIN,
          createdBy: author.name,
          createdByUserId: author.id,
          createdByName: author.name,
        },
      });
      return res.status(201).json(created);
    })
  );

  app.post(
    "/api/new-product-simulations/:id/archive",
    ...update,
    asyncRoute("POST /api/new-product-simulations/:id/archive", async (req, res) => {
      const { id } = req.params;
      if (!isUuidString(id)) return invalidId(res);
      const row = await prisma.newProductSimulation.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!row) return res.status(404).json({ error: "NOT_FOUND", message: "Simulação não encontrada." });
      if (row.status === "DRAFT") {
        return res.status(409).json({
          error: "DRAFT_NOT_ARCHIVABLE",
          message: "Rascunho não é arquivado: congele a simulação ou exclua o rascunho.",
        });
      }
      const author = await sessionAuthor(req);
      // Só metadados de arquivamento: o snapshot congelado não é tocado.
      const updated = await prisma.newProductSimulation.update({
        where: { id },
        data: { status: "ARCHIVED", archivedAt: now(), archivedByUserId: author.id, archivedByName: author.name },
        select: SUMMARY_SELECT,
      });
      return res.json(updated);
    })
  );

  app.post(
    "/api/new-product-simulations/:id/unarchive",
    ...update,
    asyncRoute("POST /api/new-product-simulations/:id/unarchive", async (req, res) => {
      const { id } = req.params;
      if (!isUuidString(id)) return invalidId(res);
      const row = await prisma.newProductSimulation.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!row) return res.status(404).json({ error: "NOT_FOUND", message: "Simulação não encontrada." });
      if (row.status !== "ARCHIVED") {
        return res.status(409).json({ error: "NOT_ARCHIVED", message: "A simulação não está arquivada." });
      }
      const updated = await prisma.newProductSimulation.update({
        where: { id },
        data: { status: "SAVED", archivedAt: null, archivedByUserId: null, archivedByName: null },
        select: SUMMARY_SELECT,
      });
      return res.json(updated);
    })
  );

  /** Exclusão definitiva só de RASCUNHO. Simulação congelada é arquivada, não apagada. */
  app.delete(
    "/api/new-product-simulations/:id",
    ...remove,
    asyncRoute("DELETE /api/new-product-simulations/:id", async (req, res) => {
      const { id } = req.params;
      if (!isUuidString(id)) return invalidId(res);
      const row = await prisma.newProductSimulation.findUnique({
        where: { id },
        select: { id: true, status: true, savedAt: true },
      });
      if (!row) {
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Simulação de novo produto não encontrada." });
      }
      if (persistedStatusFromApiRecord(row) !== "DRAFT") {
        return res.status(409).json({
          error: "FROZEN_SIMULATION_NOT_DELETABLE",
          message: "Simulação congelada não é excluída: use Arquivar para retirá-la da lista preservando o histórico.",
        });
      }
      const deleted = await prisma.newProductSimulation.deleteMany({ where: { id, status: "DRAFT" } });
      if (deleted.count === 0) {
        return res.status(409).json({
          error: "FROZEN_SIMULATION_NOT_DELETABLE",
          message: "Simulação congelada não é excluída: use Arquivar.",
        });
      }
      return res.status(204).end();
    })
  );
}
