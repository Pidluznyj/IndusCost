import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Prisma } from "@prisma/client";
import { prisma } from "./src/lib/prisma.js";
import multer from "multer";
import { ServerImporter } from "./src/lib/importer/serverImporter.js";
import { MaterialImportConfig } from "./src/lib/importer/MaterialConfig.js";
import { EngineeringImportConfigs } from "./src/lib/importer/ProductConfig.js";
import { CustomerImportConfig } from "./src/lib/importer/CustomerConfig.js";
import crypto from "crypto";
import {
  buildPortfolioAbcForCustomer,
  buildCustomerAbcRanking,
} from "./src/lib/customerCommercialIntel.js";
import {
  buildCostAnalysisExplainability,
  buildPricingSnapshotExplainability,
} from "./src/lib/calculationExplainability.js";

const upload = multer({ storage: multer.memoryStorage() });
const importCache = new Map<string, any>();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || "0.0.0.0";

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // --- API: Test ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // --- API: Test DB Connection ---
  app.get("/api/test-db", async (req, res) => {
    console.log("Testing database connection and schema...");
    try {
      const results = {
        machines: await prisma.machine.count(),
        roles: await prisma.role.count(),
        employees: await prisma.employee.count(),
        materials: await prisma.material.count(),
        products: await prisma.product.count(),
        indirectCosts: await prisma.indirectCost.count(),
        taxRules: await prisma.taxRule.count(),
        pricing: await prisma.productPricing.count(),
        simulations: await prisma.simulation.count(),
      };
      res.json({ status: "success", counts: results });
    } catch (error) {
      console.error("Database test failed:", error);
      res.status(500).json({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- API: Dashboard Gerencial ---
  app.get("/api/dashboard", async (req, res, next) => {
    console.log("Fetching dashboard data...");
    try {
      const [employees, machines, products, pricings, indirectCosts] = await Promise.all([
        prisma.employee.findMany({ 
          where: { status: "ACTIVE" },
          include: { EmployeePayrollComponent: { include: { PayrollComponent: true } } } 
        }),
        prisma.machine.findMany({ include: { MachineCostComponent: true } }),
        prisma.product.findMany({ where: { status: "ACTIVE" } }),
        prisma.productPricing.findMany({ include: { TaxRule: { include: { TaxComponent: true } } } }),
        prisma.indirectCost.findMany({ where: { status: "ACTIVE" } })
      ]);

      // 1. Custo por Colaborador
      const employeeCosts = await Promise.all(employees.map(async emp => {
        const role = await prisma.role.findUnique({ where: { id: emp.roleId } });
        const salary = Number(role?.baseSalary || 0);
        let load = 0;
        emp.EmployeePayrollComponent.forEach(rel => {
          const c = rel.PayrollComponent;
          load += c.calculationType === "PERCENTAGE" ? (salary * Number(c.value)) / 100 : Number(c.value);
        });
        return { id: emp.id, name: emp.name, totalCost: salary + load };
      }));
      const avgEmployeeCost = employeeCosts.length > 0 ? employeeCosts.reduce((acc, e) => acc + e.totalCost, 0) / employeeCosts.length : 0;

      // Verificação de Parâmetros Globais para Custo Máquina
      const energyCostParam = indirectCosts.find(c => c.category === "GLOBAL_PARAM" && c.description === "ENERGY_COST");
      const workingHoursParam = indirectCosts.find(c => c.category === "GLOBAL_PARAM" && c.description === "WORKING_HOURS");
      
      if (!energyCostParam || !workingHoursParam) {
        return res.status(400).json({ error: "CONFIG_MISSING", message: "Parâmetros globais de energia e/ou horas trabalhadas não configurados." });
      }

      const globalEnergyCost = Number(energyCostParam.monthlyValue);
      const globalWorkingHours = Number(workingHoursParam.monthlyValue);

      if (globalWorkingHours <= 0) {
        return res.status(400).json({ error: "CONFIG_MISSING", message: "Horas trabalhadas devem ser maiores que zero." });
      }

      const globalMachineHourCost = globalEnergyCost / globalWorkingHours;

      // 2. HM por Máquina
      const machineHM = machines.map(m => {
        return { id: m.id, code: m.code, hmCost: globalMachineHourCost };
      });

      // 3. Análise de Produtos (Top 5 e Bottom 5)
      const productAnalyses = await Promise.all(products.map(p => getProductCostAnalysis(p.id)));
      const validAnalyses = productAnalyses.filter(a => a !== null && !("error" in a));

      const productPerformance = validAnalyses.map((analysis: any) => {
        const pricing = pricings.find(pr => pr.productId === analysis.productId);
        if (!pricing) return { ...analysis, marginPct: 0, marginAbs: 0, suggestedPrice: 0 };

        const taxRule = pricing.TaxRule;
        const taxRate = taxRule?.TaxComponent?.reduce((acc: number, c: any) => acc + Number(c.percentage), 0) / 100 || 0;
        const commRate = Number(pricing.commission) / 100;
        const marginRate = Number(pricing.desiredMargin) / 100;
        const otherRate = Number(pricing.otherVariables) / 100;
        const freight = Number(pricing.freightOut);

        const divisor = 1 - taxRate - commRate - otherRate - marginRate;
        const suggestedPrice = divisor > 0 ? (analysis.totalIndustrialCost + freight) / divisor : 0;
        
        const totalTaxes = suggestedPrice * taxRate;
        const totalComm = suggestedPrice * commRate;
        const marginAbs = suggestedPrice - totalTaxes - totalComm - freight - analysis.totalGerencialCost;

        return {
          ...analysis,
          suggestedPrice,
          marginAbs,
          marginPct: suggestedPrice > 0 ? (marginAbs / suggestedPrice) * 100 : 0
        };
      });

      // 4. Impactos Globais
      const totalCIF = indirectCosts.filter(c => c.category === "CIF").reduce((acc, c) => acc + Number(c.monthlyValue), 0);
      const totalOPEX = indirectCosts.filter(c => c.category !== "CIF" && c.category !== "GLOBAL_PARAM").reduce((acc, c) => acc + Number(c.monthlyValue), 0);

      res.json({
        kpis: {
          totalEmployees: employees.length,
          avgEmployeeCost,
          totalMachines: machines.length,
          avgHM: machineHM.length > 0 ? machineHM.reduce((acc, m) => acc + m.hmCost, 0) / machineHM.length : 0,
          totalCIF,
          totalOPEX
        },
        productPerformance: productPerformance.sort((a, b) => b.marginPct - a.marginPct),
        costComposition: {
          mp: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalMaterialCost, 0) / validAnalyses.length : 0,
          hh: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalHH_Unit, 0) / validAnalyses.length : 0,
          hm: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalHM_Unit, 0) / validAnalyses.length : 0,
          cif: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalCIF_Unit, 0) / validAnalyses.length : 0,
          opex: validAnalyses.length > 0 ? validAnalyses.reduce((acc, a: any) => acc + a.totalOPEX_Unit, 0) / validAnalyses.length : 0,
        }
      });
    } catch (err) {
      console.error("Dashboard route error:", err);
      next(err);
    }
  });

  // --- API: Roles (Cargos) ---
  app.get("/api/roles", async (req, res) => {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
    });
    res.json(roles);
  });

  app.post("/api/roles", async (req, res) => {
    const { name, baseSalary, monthlyHours } = req.body;
    const role = await prisma.role.create({
      data: { name, baseSalary, monthlyHours },
    });
    res.json(role);
  });

  app.put("/api/roles/:id", async (req, res) => {
    const { id } = req.params;
    const { name, baseSalary, monthlyHours } = req.body;
    const role = await prisma.role.update({
      where: { id },
      data: { name, baseSalary, monthlyHours },
    });
    res.json(role);
  });

  app.delete("/api/roles/:id", async (req, res) => {
    const { id } = req.params;
    await prisma.role.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- API: Machines (Máquinas e Centros de Trabalho) ---
  app.get("/api/machines", async (req, res) => {
    const machines = await prisma.machine.findMany({
      include: { MachineCostComponent: true },
      orderBy: { code: "asc" },
    });
    res.json(machines);
  });

  app.post("/api/machines", async (req, res) => {
    const { code, name, acquisitionValue, residualValue, usefulLifeMonths, components } = req.body;
    const machine = await prisma.machine.create({
      data: {
        code,
        name,
        acquisitionValue,
        residualValue,
        usefulLifeMonths,
        MachineCostComponent: {
          create: (components || []).map((c: any) => ({
            name: c.name,
            monthlyEstimatedCost: c.monthlyEstimatedCost,
          }))
        }
      },
      include: { MachineCostComponent: true }
    });
    res.json(machine);
  });

  app.put("/api/machines/:id", async (req, res) => {
    const { id } = req.params;
    const { code, name, acquisitionValue, residualValue, usefulLifeMonths, components } = req.body;

    const machine = await prisma.$transaction(async (tx) => {
      await tx.machineCostComponent.deleteMany({ where: { machineId: id } });
      return await tx.machine.update({
        where: { id },
        data: {
          code,
          name,
          acquisitionValue,
          residualValue,
          usefulLifeMonths,
          MachineCostComponent: {
            create: (components || []).map((c: any) => ({
              name: c.name,
              monthlyEstimatedCost: c.monthlyEstimatedCost,
            }))
          }
        },
        include: { MachineCostComponent: true }
      });
    });
    res.json(machine);
  });

  app.delete("/api/machines/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      const inUse = await prisma.productRouting.findFirst({ where: { machineId: id } });
      if (inUse) {
        return res.status(400).json({ error: "IN_USE", message: "Não é possível excluir esta máquina porque ela está vinculada a roteiros de produção." });
      }

      await prisma.$transaction([
        prisma.machineCostComponent.deleteMany({ where: { machineId: id } }),
        prisma.machine.delete({ where: { id } })
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error("Erro ao deletar maquina:", err);
      res.status(500).json({ error: "Erro ao excluir máquina." });
    }
  });

  // --- API: Payroll Components ---
  app.get("/api/payroll-components", async (req, res) => {
    const components = await prisma.payrollComponent.findMany({
      orderBy: { name: "asc" },
    });
    res.json(components);
  });

  app.post("/api/payroll-components", async (req, res) => {
    const { name, type, calculationType, value } = req.body;
    const component = await prisma.payrollComponent.create({
      data: { name, type, calculationType, value },
    });
    res.json(component);
  });

  app.put("/api/payroll-components/:id", async (req, res) => {
    const { id } = req.params;
    const { name, type, calculationType, value } = req.body;
    const component = await prisma.payrollComponent.update({
      where: { id },
      data: { name, type, calculationType, value },
    });
    res.json(component);
  });

  app.delete("/api/payroll-components/:id", async (req, res) => {
    const { id } = req.params;
    await prisma.payrollComponent.delete({ where: { id } });
    res.json({ success: true });
  });

  
// --- API: Employees (Funcionários) ---
app.get("/api/employees", async (req, res) => {
  const employees = await prisma.employee.findMany({
    include: {
      Role: true,
      EmployeePayrollComponent: {
        include: { PayrollComponent: true }
      }
    },
    orderBy: { name: "asc" },
  });

  // Lógica de Cálculo de Custo (Motor de Custeio HH)
  const employeesWithCosts = employees.map((emp) => {
    const salary = Number(emp.salary);
    let totalBenefits = 0;
    let totalCharges = 0;
    let totalProvisions = 0;

    emp.EmployeePayrollComponent.forEach((rel) => {
      const comp = rel.PayrollComponent;
      const value = Number(comp.value);
      const amount =
        comp.calculationType === "PERCENTAGE"
          ? (salary * value) / 100
          : value;

      if (comp.type === "BENEFIT") totalBenefits += amount;
      if (comp.type === "CHARGE") totalCharges += amount;
      if (comp.type === "PROVISION") totalProvisions += amount;
    });

    const totalMonthlyCost = salary + totalBenefits + totalCharges + totalProvisions;
    const costPerContractedHour = totalMonthlyCost / emp.monthlyHours;
    const productiveHours = emp.monthlyHours * (Number(emp.productivity) / 100);
    const costPerProductiveHour = totalMonthlyCost / (productiveHours || 1);

    return {
      ...emp,
      costs: {
        salary,
        totalBenefits,
        totalCharges,
        totalProvisions,
        totalMonthlyCost,
        costPerContractedHour,
        costPerProductiveHour,
        productiveHours
      }
    };
  });

  res.json(employeesWithCosts);
});

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeOptionalText(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeRequiredText(value: unknown): string {
  return isNonEmptyString(value) ? value.trim() : "";
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function sanitizeUuidArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && isUuid(item));
}

app.post("/api/employees", async (req, res) => {
  try {
    const {
      name,
      roleId,
      department,
      costCenter,
      classification,
      salary,
      monthlyHours,
      productivity,
      status,
      componentIds
    } = req.body;

    const cleanName = normalizeRequiredText(name);
    const cleanRoleId = isUuid(roleId) ? roleId.trim() : null;
    const cleanComponentIds = sanitizeUuidArray(componentIds);

    if (!cleanName) {
      return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
    }

    if (!cleanRoleId) {
      return res.status(400).json({ error: "Selecione um cargo válido." });
    }

    const employee = await prisma.employee.create({
      data: {
        name: cleanName,
        roleId: cleanRoleId,
        department: normalizeRequiredText(department),
        costCenter: normalizeRequiredText(costCenter),
        classification: normalizeRequiredText(classification),
        salary: toNumber(salary, 0),
        monthlyHours: toNumber(monthlyHours, 0),
        productivity: toNumber(productivity, 0),
        status: normalizeOptionalText(status) ?? "ACTIVE",
        EmployeePayrollComponent:
          cleanComponentIds.length > 0
            ? {
                create: cleanComponentIds.map((id) => ({
                  PayrollComponent: { connect: { id } }
                }))
              }
            : undefined
      },
      include: {
        Role: true,
        EmployeePayrollComponent: {
          include: { PayrollComponent: true }
        }
      }
    });

    res.json(employee);
  } catch (error) {
    console.error("Create employee error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Erro ao criar funcionário"
    });
  }
});

app.put("/api/employees/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      componentIds,
      name,
      roleId,
      department,
      costCenter,
      classification,
      salary,
      monthlyHours,
      productivity,
      status
    } = req.body;

    if (!isUuid(id)) {
      return res.status(400).json({ error: "ID de funcionário inválido." });
    }

    const cleanName = normalizeRequiredText(name);
    const cleanRoleId = isUuid(roleId) ? roleId.trim() : null;
    const cleanComponentIds = sanitizeUuidArray(componentIds);

    if (!cleanName) {
      return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
    }

    if (!cleanRoleId) {
      return res.status(400).json({ error: "Selecione um cargo válido." });
    }

    await prisma.employeePayrollComponent.deleteMany({
      where: { employeeId: id }
    });

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        name: cleanName,
        roleId: cleanRoleId,
        department: normalizeRequiredText(department),
        costCenter: normalizeRequiredText(costCenter),
        classification: normalizeRequiredText(classification),
        salary: toNumber(salary, 0),
        monthlyHours: toNumber(monthlyHours, 0),
        productivity: toNumber(productivity, 0),
        status: normalizeOptionalText(status) ?? "ACTIVE",
        EmployeePayrollComponent:
          cleanComponentIds.length > 0
            ? {
                create: cleanComponentIds.map((compId) => ({
                  PayrollComponent: { connect: { id: compId } }
                }))
              }
            : undefined
      },
      include: {
        Role: true,
        EmployeePayrollComponent: {
          include: { PayrollComponent: true }
        }
      }
    });

    res.json(employee);
  } catch (error) {
    console.error("Update employee error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Erro ao atualizar funcionário"
    });
  }
});

app.delete("/api/employees/:id", async (req, res) => {
  const { id } = req.params;
  await prisma.employee.delete({ where: { id } });
  res.json({ success: true });
});

  // --- API: Materials (Matérias-Primas e Insumos) ---
  app.get("/api/materials/import/template", (req, res) => {
    try {
      const buffer = ServerImporter.generateTemplate(MaterialImportConfig);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=template_materiais.xlsx");
      res.send(buffer);
    } catch (error) {
      console.error("Template generation error:", error);
      res.status(500).json({ error: "Erro ao gerar template" });
    }
  });

  app.post("/api/materials/import/preview", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    try {
      const result = await ServerImporter.parseExcel(req.file.buffer, MaterialImportConfig);
      const importId = crypto.randomUUID();
      importCache.set(importId, result.data);
      
      // Cleanup after 30 mins
      setTimeout(() => importCache.delete(importId), 30 * 60 * 1000);
      
      res.json({ ...result, importId });
    } catch (error) {
      console.error("Import preview error:", error);
      res.status(500).json({ error: "Erro ao processar planilha" });
    }
  });

  app.post("/api/materials/import/confirm", async (req, res) => {
    const { data: bodyData, importId } = req.body;
    let data = bodyData;

    if (importId && importCache.has(importId)) {
      data = importCache.get(importId);
      importCache.delete(importId);
    }

    if (!Array.isArray(data)) return res.status(400).json({ error: "Dados inválidos ou sessão de importação expirada." });

    try {
      const codes = data.map(d => d.code);
      const existing = await prisma.material.findMany({
        where: { code: { in: codes } },
        select: { code: true }
      });
      const existingCodes = new Set(existing.map(e => e.code));

      const toCreate = data.filter(d => !existingCodes.has(d.code));
      const rowsSkippedExisting = data.filter(d => existingCodes.has(d.code)).length;

      if (toCreate.length > 0) {
        await prisma.material.createMany({
          data: toCreate.map(d => ({
            code: d.code,
            description: d.description,
            unit: d.unit,
            category: d.category,
            supplier: d.supplier || null,
            currentCost: d.currentCost || 0,
            averageCost: d.averageCost || 0,
            standardCost: d.standardCost || 0,
            freight: d.freight || 0,
            standardLoss: d.standardLoss || 0,
            conversionFactor: d.conversionFactor || 1,
            status: d.status || "ACTIVE"
          }))
        });
      }

      res.json({
        success: true,
        count: toCreate.length,
        skipped: rowsSkippedExisting,
        summary: {
          rowsProcessed: data.length,
          rowsImported: toCreate.length,
          rowsSkippedExisting,
          rowsFailed: 0
        }
      });
    } catch (error) {
      console.error("Import confirm error:", error);
      res.status(500).json({ error: "Erro ao salvar dados no banco" });
    }
  });

  app.get("/api/materials", async (req, res) => {
    const materials = await prisma.material.findMany({
      include: { MaterialPriceHistory: { orderBy: { effectiveDate: "desc" }, take: 5 } },
      orderBy: { code: "asc" },
    });

    // Lógica de Cálculo de Custo Posto Fábrica e com Perda
    const materialsWithCalculations = materials.map((mat) => {
      const currentCost = Number(mat.currentCost);
      const freight = Number(mat.freight);
      const standardLoss = Number(mat.standardLoss) / 100;

      const landedCost = currentCost + freight;
      const effectiveCost = landedCost / (1 - standardLoss);

      return {
        ...mat,
        calculations: {
          landedCost,
          effectiveCost,
        }
      };
    });

    res.json(materialsWithCalculations);
  });

  app.post("/api/materials", async (req, res) => {
    const { 
      code, description, unit, category, supplier, 
      currentCost, averageCost, standardCost, freight, 
      standardLoss, conversionFactor 
    } = req.body;

    const material = await prisma.material.create({
      data: {
        code,
        description,
        unit,
        category,
        supplier,
        currentCost,
        averageCost,
        standardCost,
        freight,
        standardLoss,
        conversionFactor,
        MaterialPriceHistory: {
          create: {
            price: currentCost,
            freight: freight,
          }
        }
      }
    });
    res.json(material);
  });

  app.put("/api/materials/:id", async (req, res) => {
    const { id } = req.params;
    const { currentCost, freight, ...data } = req.body;

    // Se o custo ou frete mudou, registra no histórico
    const oldMaterial = await prisma.material.findUnique({ where: { id } });
    if (oldMaterial && (Number(oldMaterial.currentCost) !== currentCost || Number(oldMaterial.freight) !== freight)) {
      await prisma.materialPriceHistory.create({
        data: {
          materialId: id,
          price: currentCost,
          freight: freight,
        }
      });
    }

    const material = await prisma.material.update({
      where: { id },
      data: {
        ...data,
        currentCost,
        freight,
      }
    });
    res.json(material);
  });

  app.patch("/api/materials/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!isUuid(id)) {
        return res.status(400).json({ error: "ID de material inválido." });
      }

      const next =
        typeof status === "string" ? status.trim().toUpperCase() : "";
      if (next !== "ACTIVE" && next !== "INACTIVE") {
        return res
          .status(400)
          .json({ error: "Status inválido. Use ACTIVE ou INACTIVE." });
      }

      const existing = await prisma.material.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "Material não encontrado." });
      }

      const material = await prisma.material.update({
        where: { id },
        data: { status: next },
      });
      res.json(material);
    } catch (error) {
      console.error("Material status error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Erro ao atualizar status do material.",
      });
    }
  });

  app.delete("/api/materials/:id", async (req, res) => {
    const { id } = req.params;
    await prisma.material.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- Compras: centros de custo e solicitações (Bloco 1) ---
  app.get("/api/cost-centers", async (_req, res) => {
    try {
      const rows = await prisma.costCenter.findMany({
        orderBy: [{ isActive: "desc" }, { code: "asc" }],
      });
      res.json(rows);
    } catch (e) {
      console.error("cost-centers list error:", e);
      res.status(500).json({ error: "Erro ao listar centros de custo." });
    }
  });

  app.post("/api/cost-centers", async (req, res) => {
    try {
      const { code, name, description, notes, isActive } = req.body;
      if (!code || !name) {
        return res.status(400).json({ error: "Código e nome do centro de custo são obrigatórios." });
      }
      const row = await prisma.costCenter.create({
        data: {
          code: String(code).trim().toUpperCase(),
          name: String(name).trim(),
          description: description != null ? String(description) : null,
          notes: notes != null ? String(notes) : null,
          isActive: isActive !== false,
        },
      });
      res.json(row);
    } catch (e: any) {
      console.error("cost-center create error:", e);
      if (e.code === "P2002") {
        return res.status(409).json({ error: "Já existe centro de custo com este código." });
      }
      res.status(500).json({ error: "Erro ao criar centro de custo." });
    }
  });

  app.patch("/api/cost-centers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const { name, description, notes, isActive } = req.body;
      const row = await prisma.costCenter.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: String(name) } : {}),
          ...(description !== undefined ? { description: description } : {}),
          ...(notes !== undefined ? { notes: notes } : {}),
          ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        },
      });
      res.json(row);
    } catch (e: any) {
      console.error("cost-center patch error:", e);
      if (e.code === "P2025") return res.status(404).json({ error: "Centro de custo não encontrado." });
      res.status(500).json({ error: "Erro ao atualizar centro de custo." });
    }
  });

  const purchaseInclude = {
    defaultCostCenter: true,
    items: {
      include: { material: true, costCenter: true },
      orderBy: { id: "asc" as const },
    },
  };

  app.get("/api/purchase-requests", async (_req, res) => {
    try {
      const rows = await prisma.purchaseRequest.findMany({
        include: {
          defaultCostCenter: true,
          items: { include: { material: true, costCenter: true } },
        },
        orderBy: { number: "desc" },
      });
      res.json(rows);
    } catch (e) {
      console.error("purchase-requests list error:", e);
      res.status(500).json({ error: "Erro ao listar solicitações de compra." });
    }
  });

  app.get("/api/purchase-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await prisma.purchaseRequest.findUnique({
        where: { id },
        include: purchaseInclude,
      });
      if (!row) return res.status(404).json({ error: "Solicitação não encontrada." });
      res.json(row);
    } catch (e) {
      console.error("purchase-request get error:", e);
      res.status(500).json({ error: "Erro ao carregar solicitação." });
    }
  });

  function validatePurchaseRequestPayload(body: any): string | null {
    if (!body || typeof body !== "object") return "Payload inválido.";
    if (!body.requester || !String(body.requester).trim()) return "Solicitante é obrigatório.";
    if (!body.department || !String(body.department).trim()) return "Departamento / área é obrigatório.";
    if (!body.justification || !String(body.justification).trim()) return "Justificativa é obrigatória.";
    if (!body.defaultCostCenterId || !isUuid(body.defaultCostCenterId)) {
      return "Centro de custo do cabeçalho é obrigatório.";
    }
    const st = body.status;
    if (st && !["RASCUNHO", "ABERTA", "CANCELADA", "ENCERRADA"].includes(st)) return "Status inválido.";
    const pr = body.priority;
    if (pr && !["BAIXA", "NORMAL", "ALTA", "URGENTE"].includes(pr)) return "Prioridade inválida.";
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return "Inclua ao menos um item na solicitação.";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.lineType || !["MATERIA_PRIMA", "INDIRETO"].includes(it.lineType)) {
        return `Item ${i + 1}: tipo de linha inválido (MATERIA_PRIMA ou INDIRETO).`;
      }
      if (!it.description || !String(it.description).trim()) return `Item ${i + 1}: descrição é obrigatória.`;
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) return `Item ${i + 1}: quantidade inválida.`;
      if (!it.unit || !String(it.unit).trim()) return `Item ${i + 1}: unidade é obrigatória.`;
      if (it.lineType === "MATERIA_PRIMA") {
        if (!it.materialId || !isUuid(it.materialId)) {
          return `Item ${i + 1}: matéria-prima exige material cadastrado (selecione um item ou cadastre nova MP em Suprimentos).`;
        }
      } else {
        if (it.materialId) return `Item ${i + 1}: itens indiretos não devem ter material vinculado.`;
      }
      if (it.costCenterId != null && it.costCenterId !== "" && !isUuid(it.costCenterId)) {
        return `Item ${i + 1}: centro de custo inválido.`;
      }
      if (it.lineType === "MATERIA_PRIMA") {
        const mo = it.minOrderQtySuggested;
        if (mo != null && mo !== "") {
          const n = Number(mo);
          if (!Number.isFinite(n) || n <= 0) {
            return `Item ${i + 1}: quantidade mínima sugerida (MOQ) inválida — use valor positivo ou deixe em branco.`;
          }
        }
      }
    }
    return null;
  }

  function purchaseRequestItemMpExtras(it: any) {
    const isMp = it.lineType === "MATERIA_PRIMA";
    if (!isMp) {
      return {
        supplierReference: null,
        packagingPresentation: null,
        minOrderQtySuggested: null,
      };
    }
    const supRef =
      it.supplierReference != null && String(it.supplierReference).trim()
        ? String(it.supplierReference).trim()
        : null;
    const pack =
      it.packagingPresentation != null && String(it.packagingPresentation).trim()
        ? String(it.packagingPresentation).trim()
        : null;
    let minOrder: number | null = null;
    if (it.minOrderQtySuggested != null && String(it.minOrderQtySuggested).trim() !== "") {
      minOrder = Number(it.minOrderQtySuggested);
    }
    return {
      supplierReference: supRef,
      packagingPresentation: pack,
      minOrderQtySuggested: minOrder,
    };
  }

  app.post("/api/purchase-requests", async (req, res) => {
    try {
      const err = validatePurchaseRequestPayload(req.body);
      if (err) return res.status(400).json({ error: err });

      const {
        requester,
        department,
        requestCategory,
        priority = "NORMAL",
        status = "RASCUNHO",
        justification,
        defaultCostCenterId,
        notes,
        items = [],
      } = req.body;

      const cc = await prisma.costCenter.findUnique({ where: { id: defaultCostCenterId } });
      if (!cc || !cc.isActive) {
        return res.status(400).json({ error: "Centro de custo do cabeçalho inválido ou inativo." });
      }

      const created = await prisma.$transaction(async (tx) => {
        const header = await tx.purchaseRequest.create({
          data: {
            requester: String(requester).trim(),
            department: String(department).trim(),
            requestCategory: requestCategory != null ? String(requestCategory) : null,
            priority,
            status,
            justification: String(justification).trim(),
            defaultCostCenterId,
            notes: notes != null ? String(notes) : null,
          },
        });

        for (const it of items) {
          const costCenterId =
            it.costCenterId && isUuid(it.costCenterId) ? it.costCenterId : null;
          if (costCenterId) {
            const c = await tx.costCenter.findUnique({ where: { id: costCenterId } });
            if (!c || !c.isActive) throw new Error(`Centro de custo do item inválido ou inativo.`);
          }
          if (it.lineType === "MATERIA_PRIMA") {
            const mat = await tx.material.findUnique({ where: { id: it.materialId } });
            if (!mat) throw new Error("Material da linha de matéria-prima não encontrado.");
          }
          const mpExtras = purchaseRequestItemMpExtras(it);
          await tx.purchaseRequestItem.create({
            data: {
              purchaseRequestId: header.id,
              lineType: it.lineType,
              materialId: it.lineType === "MATERIA_PRIMA" ? it.materialId : null,
              description: String(it.description).trim(),
              quantity: it.quantity,
              unit: String(it.unit).trim(),
              costCenterId,
              desiredDate: it.desiredDate ? new Date(it.desiredDate) : null,
              priority: it.priority || null,
              notes: it.notes != null ? String(it.notes) : null,
              suggestedSupplier: it.suggestedSupplier != null ? String(it.suggestedSupplier) : null,
              supplierReference: mpExtras.supplierReference,
              packagingPresentation: mpExtras.packagingPresentation,
              minOrderQtySuggested: mpExtras.minOrderQtySuggested,
              lineStatus: it.lineStatus && ["ABERTA", "CANCELADA"].includes(it.lineStatus) ? it.lineStatus : "ABERTA",
            },
          });
        }

        return tx.purchaseRequest.findUniqueOrThrow({
          where: { id: header.id },
          include: purchaseInclude,
        });
      });

      res.json(created);
    } catch (e: any) {
      console.error("purchase-request create error:", e);
      res.status(500).json({ error: e.message || "Erro ao criar solicitação de compra." });
    }
  });

  app.put("/api/purchase-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });

      const err = validatePurchaseRequestPayload(req.body);
      if (err) return res.status(400).json({ error: err });

      const existing = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: "Solicitação não encontrada." });

      const {
        requester,
        department,
        requestCategory,
        priority = "NORMAL",
        status = "RASCUNHO",
        justification,
        defaultCostCenterId,
        notes,
        items = [],
      } = req.body;

      const cc = await prisma.costCenter.findUnique({ where: { id: defaultCostCenterId } });
      if (!cc || !cc.isActive) {
        return res.status(400).json({ error: "Centro de custo do cabeçalho inválido ou inativo." });
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.purchaseRequest.update({
          where: { id },
          data: {
            requester: String(requester).trim(),
            department: String(department).trim(),
            requestCategory: requestCategory != null ? String(requestCategory) : null,
            priority,
            status,
            justification: String(justification).trim(),
            defaultCostCenterId,
            notes: notes != null ? String(notes) : null,
          },
        });

        await tx.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: id } });

        for (const it of items) {
          const costCenterId =
            it.costCenterId && isUuid(it.costCenterId) ? it.costCenterId : null;
          if (costCenterId) {
            const c = await tx.costCenter.findUnique({ where: { id: costCenterId } });
            if (!c || !c.isActive) throw new Error(`Centro de custo do item inválido ou inativo.`);
          }
          if (it.lineType === "MATERIA_PRIMA") {
            const mat = await tx.material.findUnique({ where: { id: it.materialId } });
            if (!mat) throw new Error("Material da linha de matéria-prima não encontrado.");
          }
          const mpExtrasPut = purchaseRequestItemMpExtras(it);
          await tx.purchaseRequestItem.create({
            data: {
              purchaseRequestId: id,
              lineType: it.lineType,
              materialId: it.lineType === "MATERIA_PRIMA" ? it.materialId : null,
              description: String(it.description).trim(),
              quantity: it.quantity,
              unit: String(it.unit).trim(),
              costCenterId,
              desiredDate: it.desiredDate ? new Date(it.desiredDate) : null,
              priority: it.priority || null,
              notes: it.notes != null ? String(it.notes) : null,
              suggestedSupplier: it.suggestedSupplier != null ? String(it.suggestedSupplier) : null,
              supplierReference: mpExtrasPut.supplierReference,
              packagingPresentation: mpExtrasPut.packagingPresentation,
              minOrderQtySuggested: mpExtrasPut.minOrderQtySuggested,
              lineStatus: it.lineStatus && ["ABERTA", "CANCELADA"].includes(it.lineStatus) ? it.lineStatus : "ABERTA",
            },
          });
        }

        return tx.purchaseRequest.findUniqueOrThrow({
          where: { id },
          include: purchaseInclude,
        });
      });

      res.json(updated);
    } catch (e: any) {
      console.error("purchase-request update error:", e);
      res.status(500).json({ error: e.message || "Erro ao atualizar solicitação de compra." });
    }
  });

  // --- Helper Functions for Recursive BOM ---
  async function checkBOMCycle(parentId: string, childProductId: string): Promise<boolean> {
    if (parentId === childProductId) return true;
    
    const children = await prisma.productBOM.findMany({
      where: { productId: childProductId },
      select: { childProductId: true }
    });

    for (const child of children) {
      if (child.childProductId) {
        if (child.childProductId === parentId) return true;
        const hasCycle = await checkBOMCycle(parentId, child.childProductId);
        if (hasCycle) return true;
      }
    }
    return false;
  }

  async function checkBOMCycleWithTx(
    tx: Prisma.TransactionClient,
    parentId: string,
    childProductId: string
  ): Promise<boolean> {
    if (parentId === childProductId) return true;
    const children = await tx.productBOM.findMany({
      where: { productId: childProductId },
      select: { childProductId: true },
    });
    for (const child of children) {
      if (child.childProductId) {
        if (child.childProductId === parentId) return true;
        if (await checkBOMCycleWithTx(tx, parentId, child.childProductId))
          return true;
      }
    }
    return false;
  }

  async function getFullBOMTree(productId: string): Promise<any> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        ProductBOM: {
          include: {
            Material: true,
            ChildProduct: true
          }
        }
      }
    });

    if (!product) return null;

    const children = await Promise.all((product.ProductBOM || []).map(async (item) => {
      if (item.childProductId) {
        const subTree = await getFullBOMTree(item.childProductId);
        return {
          id: item.id,
          type: "COMPONENT",
          item: subTree,
          quantity: item.quantity,
          lossPercentage: item.lossPercentage,
          notes: item.notes
        };
      } else {
        return {
          id: item.id,
          type: "MATERIAL",
          item: item.Material,
          quantity: item.quantity,
          lossPercentage: item.lossPercentage,
          notes: item.notes
        };
      }
    }));

    return {
      ...product,
      children
    };
  }

  // --- API: Products (Engenharia / BOM / Routing) ---
  // --- API: Products Import ---
  app.get("/api/products/import/template", (req, res) => {
    try {
      const buffer = ServerImporter.generateTemplateMulti(EngineeringImportConfigs);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=template_engenharia.xlsx");
      res.send(buffer);
    } catch (error) {
      console.error("Template generation error:", error);
      res.status(500).json({ error: "Erro ao gerar template" });
    }
  });

  app.post("/api/products/import/preview", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    try {
      const results = await ServerImporter.parseExcelMulti(req.file.buffer, EngineeringImportConfigs);
      
      const cadastro = results["CADASTRO"];
      const estrutura = results["ESTRUTURA"];
      
      const fileSkus = new Set(cadastro.data.map(d => d.sku));
      
      // Cross-sheet validation
      estrutura.data.forEach((item, idx) => {
        const rowNum = idx + 2;
        const parentInFile = cadastro.data.find(d => d.sku === item.parentSku);
        
        if (parentInFile && parentInFile.type === "PRODUCT" && item.childType === "MATERIAL") {
          estrutura.errors.push({
            row: rowNum,
            column: "Tipo Filho",
            message: "Produtos finais não podem receber materiais diretamente. Use componentes."
          });
          estrutura.invalidRows++;
          estrutura.validRows--;
        }
      });

      const importId = crypto.randomUUID();
      importCache.set(importId, results);
      
      // Cleanup after 30 mins
      setTimeout(() => importCache.delete(importId), 30 * 60 * 1000);
      
      res.json({ ...results, importId });
    } catch (error) {
      console.error("Import preview error:", error);
      res.status(500).json({ error: "Erro ao processar planilha" });
    }
  });

  app.post("/api/products/import/confirm", async (req, res) => {
    const { cadastro: bodyCadastro, estrutura: bodyEstrutura, importId } = req.body;
    let cadastro = bodyCadastro;
    let estrutura = bodyEstrutura;

    if (importId && importCache.has(importId)) {
      const cached = importCache.get(importId);
      cadastro = cached["CADASTRO"].data;
      estrutura = cached["ESTRUTURA"].data;
      importCache.delete(importId);
    }
    
    if (!cadastro || !estrutura) {
      return res.status(400).json({ success: false, error: "Dados de cadastro ou estrutura ausentes ou sessão expirada." });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Create Products/Components (somente SKUs novos)
        const skus = cadastro.map((d: any) => d.sku);
        const existing = await tx.product.findMany({
          where: { sku: { in: skus } },
          select: { sku: true }
        });
        const existingSkus = new Set(existing.map((e) => e.sku));
        const toCreate = cadastro.filter((d: any) => !existingSkus.has(d.sku));

        if (toCreate.length > 0) {
          await tx.product.createMany({
            data: toCreate.map((d: any) => ({
              sku: d.sku,
              name: d.name,
              description: d.description || null,
              type: d.type,
              version: d.version || "1.0.0",
              defaultLotSize: d.defaultLotSize !== undefined ? Number(d.defaultLotSize) : 1,
              status: d.status || "ACTIVE"
            }))
          });
        }

        const productsSkippedExisting = cadastro.filter((d: any) =>
          existingSkus.has(d.sku)
        ).length;

        // 2. BOM: substituir estrutura por pai (idempotente na reimportação)
        const allSkus = [
          ...new Set(
            [
              ...skus,
              ...estrutura.map((e: any) => e?.parentSku).filter(Boolean),
              ...estrutura
                .filter(
                  (e: any) =>
                    String(e?.childType ?? "").trim().toUpperCase() === "COMPONENT"
                )
                .map((e: any) => e?.childIdentifier)
                .filter(Boolean)
            ] as string[]
          )
        ];

        const products = await tx.product.findMany({
          where: { sku: { in: allSkus } },
          select: { id: true, sku: true, type: true }
        });
        const skuToId = new Map<string, string>(
          products.map((p) => [p.sku, p.id] as [string, string])
        );
        const skuToType = new Map<string, string>(
          products.map((p) => [p.sku, String(p.type)] as [string, string])
        );

        const matCodes = [
          ...new Set(
            estrutura
              .filter(
                (e: any) =>
                  String(e?.childType ?? "").trim().toUpperCase() === "MATERIAL"
              )
              .map((e: any) => String(e?.childIdentifier ?? "").trim())
              .filter((c: string) => c.length > 0)
          ),
        ] as string[];
        const materials =
          matCodes.length === 0
            ? []
            : await tx.material.findMany({
                where: { code: { in: matCodes } },
                select: { id: true, code: true }
              });
        const matCodeToId = new Map<string, string>(
          materials.map((m) => [m.code, m.id] as [string, string])
        );

        const parentSkuList: string[] = estrutura.map((e: any) =>
          String(e?.parentSku ?? "").trim()
        ).filter((s: string) => s.length > 0);
        const parentSkusInFile: string[] = [...new Set(parentSkuList)];

        let bomParentsStructureReplaced = 0;
        for (const ps of parentSkusInFile) {
          const pid = skuToId.get(ps);
          if (pid) {
            await tx.productBOM.deleteMany({ where: { productId: pid } });
            bomParentsStructureReplaced++;
          }
        }

        const ignoredRows: Array<{
          row: number;
          parentSku: string;
          childType?: string;
          childIdentifier?: string;
          reason: string;
        }> = [];

        const seenBomKeys = new Set<string>();
        const bomData: Array<{
          productId: string;
          materialId: string | null;
          childProductId: string | null;
          quantity: number;
          lossPercentage: number;
          notes: string | null;
        }> = [];

        for (let idx = 0; idx < estrutura.length; idx++) {
          const item = estrutura[idx];
          const rowNum = idx + 2;
          const parentSku = String(item?.parentSku ?? "").trim();
          if (!parentSku) {
            ignoredRows.push({
              row: rowNum,
              parentSku: "",
              reason: "Dado obrigatório ausente (parentSku)."
            });
            continue;
          }

          const parentId = skuToId.get(parentSku);
          if (!parentId) {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              reason: "Produto pai não encontrado no cadastro (SKU sem produto correspondente)."
            });
            continue;
          }

          const childTypeRaw = String(item?.childType ?? "").trim().toUpperCase();
          if (childTypeRaw !== "MATERIAL" && childTypeRaw !== "COMPONENT") {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              childType: childTypeRaw || undefined,
              reason:
                "Tipo de filho inválido ou ausente (use MATERIAL ou COMPONENT)."
            });
            continue;
          }

          const parentType = skuToType.get(parentSku);
          if (parentType === "PRODUCT" && childTypeRaw === "MATERIAL") {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              childType: childTypeRaw,
              reason:
                "Produto final não pode receber material diretamente; use um componente."
            });
            continue;
          }

          const childIdentifier = String(item?.childIdentifier ?? "").trim();
          if (!childIdentifier) {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              reason: "Dado obrigatório ausente (childIdentifier)."
            });
            continue;
          }

          let materialId: string | null = null;
          let childProductId: string | null = null;

          if (childTypeRaw === "MATERIAL") {
            materialId = matCodeToId.get(childIdentifier) ?? null;
            if (!materialId) {
              ignoredRows.push({
                row: rowNum,
                parentSku,
                childType: childTypeRaw,
                childIdentifier,
                reason: "Material não encontrado (código inexistente no cadastro de materiais)."
              });
              continue;
            }
          } else {
            childProductId = skuToId.get(childIdentifier) ?? null;
            if (!childProductId) {
              ignoredRows.push({
                row: rowNum,
                parentSku,
                childType: childTypeRaw,
                childIdentifier,
                reason:
                  "Produto filho não encontrado (SKU de componente inexistente no cadastro)."
              });
              continue;
            }
          }

          const qty = Number(item.quantity);
          if (!Number.isFinite(qty) || qty <= 0) {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              childType: childTypeRaw,
              childIdentifier,
              reason: "Quantidade inválida ou ausente (deve ser número > 0)."
            });
            continue;
          }

          if (childTypeRaw === "COMPONENT" && childProductId) {
            const cycle = await checkBOMCycleWithTx(tx, parentId, childProductId);
            if (cycle) {
              ignoredRows.push({
                row: rowNum,
                parentSku,
                childType: childTypeRaw,
                childIdentifier,
                reason: "Ciclo estrutural detectado (vínculo pai/filho inválido)."
              });
              continue;
            }
          }

          const dedupeKey = `${parentId}|${materialId ?? ""}|${childProductId ?? ""}`;
          if (seenBomKeys.has(dedupeKey)) {
            ignoredRows.push({
              row: rowNum,
              parentSku,
              childType: childTypeRaw,
              childIdentifier,
              reason:
                "Linha duplicada no arquivo para o mesmo vínculo pai/filho (descartada pela idempotência)."
            });
            continue;
          }
          seenBomKeys.add(dedupeKey);

          bomData.push({
            productId: parentId,
            materialId,
            childProductId,
            quantity: qty,
            lossPercentage:
              item.lossPercentage !== undefined ? Number(item.lossPercentage) : 0,
            notes: item.notes ? String(item.notes) : null
          });
        }

        if (bomData.length > 0) {
          await tx.productBOM.createMany({ data: bomData });
        }

        const bomLinesWritten = bomData.length;
        const estruturaRowsIgnored = ignoredRows.length;

        return {
          productsCreated: toCreate.length,
          productsSkippedExisting,
          cadastroRowsProcessed: cadastro.length,
          estruturaRowsProcessed: estrutura.length,
          bomLinesWritten,
          bomCreated: bomLinesWritten,
          bomParentsStructureReplaced,
          estruturaRowsIgnored,
          skipped: productsSkippedExisting,
          estruturaIgnoredDetails: ignoredRows,
          hasStructureWarnings: estruturaRowsIgnored > 0
        };
      });

      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Import confirm error:", error);
      res.status(500).json({ 
        success: false, 
        error: "Erro ao salvar dados no banco de dados. Verifique se há SKUs duplicados ou dados inválidos.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/products", async (req, res) => {
    const products = await prisma.product.findMany({
      include: {
        ProductBOM: { 
          include: { 
            Material: true,
            ChildProduct: true
          } 
        },
        ProductRouting: { include: { Machine: true, Role: true } },
      },
      orderBy: { sku: "asc" },
    });
    res.json(products);
  });

  app.get("/api/products/:id", async (req, res) => {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        ProductBOM: { 
          include: { 
            Material: true,
            ChildProduct: true
          } 
        },
        ProductRouting: { include: { Machine: true, Role: true } },
      },
    });
    res.json(product);
  });

  app.get("/api/products/:id/tree", async (req, res) => {
    const { id } = req.params;
    const tree = await getFullBOMTree(id);
    if (!tree) return res.status(404).json({ error: "Produto não encontrado" });
    res.json(tree);
  });

  app.post("/api/products", async (req, res) => {
    const { sku, name, description, type, version, defaultLotSize, bom, routing, cycleTimeSeconds, cavities, setupTimeMin, efficiencyExpected } = req.body;

    const normalizedSku = sku?.toString().trim().toUpperCase();
    if (!normalizedSku) {
      return res.status(400).json({ error: "O SKU é obrigatório." });
    }

    try {
      const effectiveType = type || "PRODUCT";

      const existing = await prisma.product.findUnique({ where: { sku: normalizedSku } });
      if (existing) {
        return res.status(409).json({ error: "SKU já existe.", code: "SKU_ALREADY_EXISTS" });
      }

      // Validações de BOM
      for (const item of (bom || [])) {
        if (item.childProductId) {
          const child = await prisma.product.findUnique({ where: { id: item.childProductId } });
          if (!child) return res.status(400).json({ error: "Componente não encontrado." });
          
          if (effectiveType === "PRODUCT" && child.type !== "COMPONENT") {
            return res.status(400).json({ error: "Produtos Finais só aceitam Componentes como filhos diretos." });
          }
          if (effectiveType === "MATERIAL") {
            return res.status(400).json({ error: "Matérias-Primas não podem ter estrutura (BOM)." });
          }
        }
        if (item.materialId && effectiveType === "PRODUCT") {
          return res.status(400).json({ error: "Produtos Finais não podem conter Matérias-Primas diretamente. Use Componentes." });
        }
      }

      if (effectiveType === "MATERIAL" && (routing || []).length > 0) {
        return res.status(400).json({ error: "Matérias-Primas não possuem roteiro de produção." });
      }

      // Sanitização dos campos do Processo Padrão (null-safe, NaN-safe)
      const safeCycle = cycleTimeSeconds   == null || cycleTimeSeconds   === "" ? null : Number(cycleTimeSeconds);
      const safeCav   = cavities           == null || cavities           === "" ? null : Number(cavities);
      const safeSetup = setupTimeMin       == null || setupTimeMin       === "" ? null : Number(setupTimeMin);
      const safeEff   = efficiencyExpected == null || efficiencyExpected === "" ? null : Number(efficiencyExpected);

      const hasProcessoField = safeCycle !== null || safeCav !== null || safeSetup !== null || safeEff !== null;

      // Processo Padrão só é permitido em COMPONENT
      if (hasProcessoField && effectiveType !== "COMPONENT")
        return res.status(400).json({ error: "Processo Padrão (cycleTimeSeconds/cavities/setupTimeMin/efficiencyExpected) só é permitido para itens do tipo COMPONENT." });

      // Regra tudo-ou-nada: se ANY campo vier, TODOS os 4 são obrigatórios e válidos
      if (hasProcessoField && effectiveType === "COMPONENT") {
        if (safeCycle === null || !Number.isFinite(safeCycle) || safeCycle <= 0)
          return res.status(400).json({ error: "Processo Padrão: cycleTimeSeconds é obrigatório e deve ser > 0." });
        if (safeCav === null || !Number.isFinite(safeCav) || safeCav < 1)
          return res.status(400).json({ error: "Processo Padrão: cavities é obrigatório e deve ser >= 1." });
        if (safeSetup === null || !Number.isFinite(safeSetup) || safeSetup < 0)
          return res.status(400).json({ error: "Processo Padrão: setupTimeMin é obrigatório e deve ser >= 0." });
        if (safeEff === null || !Number.isFinite(safeEff) || safeEff <= 0 || safeEff > 100)
          return res.status(400).json({ error: "Processo Padrão: efficiencyExpected é obrigatório e deve ser > 0 e <= 100." });
      }

      const product = await prisma.product.create({
        data: {
          sku: normalizedSku,
          name,
          description,
          type: effectiveType,
          version,
          defaultLotSize,
          cycleTimeSeconds: safeCycle,
          cavities: safeCav,
          setupTimeMin: safeSetup,
          efficiencyExpected: safeEff,
          ProductBOM: {
            create: (bom || []).map((item: any) => ({
              materialId: item.materialId,
              childProductId: item.childProductId,
              quantity: item.quantity,
              lossPercentage: item.lossPercentage,
              notes: item.notes,
            }))
          },
          ProductRouting: {
            create: (routing || []).map((step: any) => ({
              sequence: step.sequence,
              description: step.description,
              machineId: step.machineId,
              roleId: step.roleId,
              setupTimeMin: step.setupTimeMin,
              operationTimeMin: step.operationTimeMin,
              efficiencyExpected: step.efficiencyExpected,
              cycleTimeSeconds: step.cycleTimeSeconds,
              cavities: step.cavities,
              notes: step.notes,
            }))
          }
        },
        include: { ProductBOM: true, ProductRouting: true }
      });
      res.json(product);
    } catch (error) {
      console.error("Product creation error:", error);
      res.status(500).json({ error: "Erro ao criar produto." });
    }
  });

  app.put("/api/products/:id", async (req, res) => {
    const { id } = req.params;
    const { sku, name, description, type, version, defaultLotSize, bom, routing, cycleTimeSeconds, cavities, setupTimeMin, efficiencyExpected } = req.body;
    const normalizedSku = sku?.toString().trim().toUpperCase();

    try {
      // effectiveType: usa o tipo do banco se o payload não trouxer type
      const currentProduct = await prisma.product.findUnique({
        where: { id },
        select: { type: true, cycleTimeSeconds: true, cavities: true, setupTimeMin: true, efficiencyExpected: true }
      });
      if (!currentProduct) return res.status(404).json({ error: "Produto não encontrado." });
      const effectiveType = type ?? currentProduct.type;

      if (normalizedSku) {
        const existing = await prisma.product.findFirst({
          where: { sku: normalizedSku, id: { not: id } }
        });
        if (existing) return res.status(409).json({ error: "SKU já existe." });
      }

      for (const item of (bom || [])) {
        if (item.childProductId) {
          if (await checkBOMCycle(id, item.childProductId)) {
            return res.status(400).json({ error: "Ciclo detectado!" });
          }
          const child = await prisma.product.findUnique({ where: { id: item.childProductId } });
          if (effectiveType === "PRODUCT" && child?.type !== "COMPONENT") {
            return res.status(400).json({ error: "Produtos Finais só aceitam Componentes como filhos diretos." });
          }
          if (effectiveType === "MATERIAL") {
            return res.status(400).json({ error: "Matérias-Primas não podem ter estrutura (BOM)." });
          }
        }
        if (item.materialId && effectiveType === "PRODUCT") {
          return res.status(400).json({ error: "Produtos Finais não podem conter Matérias-Primas diretamente. Use Componentes." });
        }
      }

      if (effectiveType === "MATERIAL" && (routing || []).length > 0)
        return res.status(400).json({ error: "Matérias-Primas não possuem roteiro de produção." });

      // Detectar presença EXPLÍCITA de cada campo no payload (chave ausente ≠ null)
      const body = req.body;
      const cycleInPayload = Object.prototype.hasOwnProperty.call(body, "cycleTimeSeconds");
      const cavInPayload   = Object.prototype.hasOwnProperty.call(body, "cavities");
      const setupInPayload = Object.prototype.hasOwnProperty.call(body, "setupTimeMin");
      const effInPayload   = Object.prototype.hasOwnProperty.call(body, "efficiencyExpected");

      // Sanitizar apenas os campos que vieram explicitamente no payload
      const safeCycle = cycleInPayload ? (cycleTimeSeconds == null || cycleTimeSeconds === "" ? null : Number(cycleTimeSeconds)) : undefined;
      const safeCav   = cavInPayload   ? (cavities         == null || cavities         === "" ? null : Number(cavities))         : undefined;
      const safeSetup = setupInPayload ? (setupTimeMin     == null || setupTimeMin     === "" ? null : Number(setupTimeMin))     : undefined;
      const safeEff   = effInPayload   ? (efficiencyExpected == null || efficiencyExpected === "" ? null : Number(efficiencyExpected)) : undefined;

      // Valores resolvidos: payload tem precedência; ausente no payload → preserva do banco
      const resolvedCycle = safeCycle !== undefined ? safeCycle : (currentProduct.cycleTimeSeconds !== null ? Number(currentProduct.cycleTimeSeconds) : null);
      const resolvedCav   = safeCav   !== undefined ? safeCav   : (currentProduct.cavities           !== null ? Number(currentProduct.cavities)           : null);
      const resolvedSetup = safeSetup !== undefined ? safeSetup : (currentProduct.setupTimeMin       !== null ? Number(currentProduct.setupTimeMin)       : null);
      const resolvedEff   = safeEff   !== undefined ? safeEff   : (currentProduct.efficiencyExpected !== null ? Number(currentProduct.efficiencyExpected) : null);

      const hasProcessoField = resolvedCycle !== null || resolvedCav !== null || resolvedSetup !== null || resolvedEff !== null;

      // Processo Padrão só é permitido em COMPONENT
      if (hasProcessoField && effectiveType !== "COMPONENT")
        return res.status(400).json({ error: "Processo Padrão (cycleTimeSeconds/cavities/setupTimeMin/efficiencyExpected) só é permitido para itens do tipo COMPONENT." });

      // Regra tudo-ou-nada aplicada sobre os valores resolvidos
      if (hasProcessoField && effectiveType === "COMPONENT") {
        if (resolvedCycle === null || !Number.isFinite(resolvedCycle) || resolvedCycle <= 0)
          return res.status(400).json({ error: "Processo Padrão: cycleTimeSeconds é obrigatório e deve ser > 0." });
        if (resolvedCav === null || !Number.isFinite(resolvedCav) || resolvedCav < 1)
          return res.status(400).json({ error: "Processo Padrão: cavities é obrigatório e deve ser >= 1." });
        if (resolvedSetup === null || !Number.isFinite(resolvedSetup) || resolvedSetup < 0)
          return res.status(400).json({ error: "Processo Padrão: setupTimeMin é obrigatório e deve ser >= 0." });
        if (resolvedEff === null || !Number.isFinite(resolvedEff) || resolvedEff <= 0 || resolvedEff > 100)
          return res.status(400).json({ error: "Processo Padrão: efficiencyExpected é obrigatório e deve ser > 0 e <= 100." });
      }

      const product = await prisma.$transaction(async (tx) => {
        await tx.productBOM.deleteMany({ where: { productId: id } });
        await tx.productRouting.deleteMany({ where: { productId: id } });
        return await tx.product.update({
          where: { id },
          data: {
            sku: normalizedSku || sku,
            name,
            description,
            type: effectiveType,
            version,
            defaultLotSize,
            cycleTimeSeconds: resolvedCycle,
            cavities: resolvedCav,
            setupTimeMin: resolvedSetup,
            efficiencyExpected: resolvedEff,
            ProductBOM: {
              create: (bom || []).map((item: any) => ({
                materialId: item.materialId,
                childProductId: item.childProductId,
                quantity: item.quantity,
                lossPercentage: item.lossPercentage,
                notes: item.notes,
              }))
            },
            ProductRouting: {
              create: (routing || []).map((step: any) => ({
                sequence: step.sequence,
                description: step.description,
                machineId: step.machineId,
                roleId: step.roleId,
                setupTimeMin: step.setupTimeMin,
                operationTimeMin: step.operationTimeMin,
                efficiencyExpected: step.efficiencyExpected,
                cycleTimeSeconds: step.cycleTimeSeconds,
                cavities: step.cavities,
                notes: step.notes,
              }))
            }
          },
          include: { ProductBOM: true, ProductRouting: true }
        });
      });
      res.json(product);
    } catch (error) {
      console.error("Product update error:", error);
      res.status(500).json({ error: "Erro ao atualizar produto." });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    const { id } = req.params;

    try {
      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          UsedInBOM: {
            include: {
              ParentProduct: true
            }
          },
          ProposalItem: {
            include: {
              Proposal: true
            }
          }
        }
      });

      if (!product) {
        return res.status(404).json({ error: "Produto não encontrado." });
      }

      // Check if used in other BOMs
      if (product.UsedInBOM.length > 0) {
        const parentNames = product.UsedInBOM.map(b => b.ParentProduct.name).join(", ");
        return res.status(409).json({ 
          error: `Não é possível excluir este item pois ele é utilizado na estrutura de: ${parentNames}.` 
        });
      }

      // Check if used in Proposals
      if (product.ProposalItem.length > 0) {
        return res.status(409).json({ 
          error: "Não é possível excluir este item pois ele já possui histórico em propostas comerciais." 
        });
      }

      // Transactional delete of dependencies and product
      await prisma.$transaction([
        prisma.productPricing.deleteMany({ where: { productId: id } }),
        prisma.costCalculationLog.deleteMany({ where: { productId: id } }),
        prisma.product.delete({ where: { id } })
      ]);

      res.json({ success: true });
    } catch (error) {
      console.error("Erro ao excluir produto:", error);
      res.status(500).json({ error: "Erro interno ao excluir o produto." });
    }
  });

  app.post("/api/products/bulk-delete", async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Lista de IDs inválida." });
    }

    const results = {
      total: ids.length,
      deleted: 0,
      blocked: 0,
      details: [] as any[]
    };

    try {
      for (const id of ids) {
        const product = await prisma.product.findUnique({
          where: { id },
          include: {
            UsedInBOM: { include: { ParentProduct: true } },
            ProposalItem: { include: { Proposal: true } }
          }
        });

        if (!product) {
          results.blocked++;
          results.details.push({ id, name: "Desconhecido", status: "blocked", reason: "Produto não encontrado." });
          continue;
        }

        if (product.UsedInBOM.length > 0) {
          const parentNames = product.UsedInBOM.map(b => b.ParentProduct.name).join(", ");
          results.blocked++;
          results.details.push({ 
            id, 
            name: product.name, 
            status: "blocked", 
            reason: `Utilizado na estrutura de: ${parentNames}.` 
          });
          continue;
        }

        if (product.ProposalItem.length > 0) {
          results.blocked++;
          results.details.push({ 
            id, 
            name: product.name, 
            status: "blocked", 
            reason: "Possui histórico em propostas comerciais." 
          });
          continue;
        }

        try {
          await prisma.$transaction([
            prisma.productPricing.deleteMany({ where: { productId: id } }),
            prisma.costCalculationLog.deleteMany({ where: { productId: id } }),
            prisma.product.delete({ where: { id } })
          ]);
          results.deleted++;
          results.details.push({ id, name: product.name, status: "deleted" });
        } catch (err) {
          results.blocked++;
          results.details.push({ id, name: product.name, status: "blocked", reason: "Erro interno ao excluir." });
        }
      }

      res.json({ success: true, ...results });
    } catch (error) {
      console.error("Bulk delete error:", error);
      res.status(500).json({ error: "Erro ao processar exclusão em massa." });
    }
  });

  // --- API: Indirect Costs (OPEX) ---
  app.get("/api/indirect-costs", async (req, res) => {
    const costs = await prisma.indirectCost.findMany({
      orderBy: { category: "asc" },
    });
    res.json(costs);
  });

  app.post("/api/indirect-costs", async (req, res) => {
    const { description, category, monthlyValue, costCenter, allocationCriteria } = req.body;
    const cost = await prisma.indirectCost.create({
      data: { description, category, monthlyValue, costCenter, allocationCriteria }
    });
    res.json(cost);
  });

  app.put("/api/indirect-costs/:id", async (req, res) => {
    const { id } = req.params;
    const { description, category, monthlyValue, costCenter, allocationCriteria, status } = req.body;
    const cost = await prisma.indirectCost.update({
      where: { id },
      data: { description, category, monthlyValue, costCenter, allocationCriteria, status }
    });
    res.json(cost);
  });

  app.delete("/api/indirect-costs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      const target = await prisma.indirectCost.findUnique({ where: { id } });
      if (target?.category === "GLOBAL_PARAM") {
        return res.status(400).json({ error: "PROTECTED_PARAM", message: "Este registro é um parâmetro global do sistema e não pode ser excluído por esta tela." });
      }
      
      await prisma.indirectCost.delete({ where: { id } });
      res.json({ success: true });
    } catch (err) {
      console.error("Erro ao deletar custo indireto:", err);
      res.status(500).json({ error: "Erro ao excluir custo indireto." });
    }
  });

  // --- API: Tax Rules (Módulo Tributário) ---
  app.get("/api/tax-rules", async (req, res) => {
    const rules = await prisma.taxRule.findMany({
      include: { TaxComponent: true },
      orderBy: { name: "asc" },
    });
    res.json(rules);
  });

  app.post("/api/tax-rules", async (req, res) => {
    const { name, description, operation, components } = req.body;
    const rule = await prisma.taxRule.create({
      data: {
        name,
        description,
        operation,
        TaxComponent: {
          create: (components || []).map((c: any) => ({
            name: c.name,
            percentage: c.percentage,
            isRecoverable: c.isRecoverable,
            baseType: c.baseType,
          }))
        }
      },
      include: { TaxComponent: true }
    });
    res.json(rule);
  });

  app.put("/api/tax-rules/:id", async (req, res) => {
    const { id } = req.params;
    const { name, description, operation, components, status } = req.body;

    const rule = await prisma.$transaction(async (tx) => {
      await tx.taxComponent.deleteMany({ where: { taxRuleId: id } });
      return await tx.taxRule.update({
        where: { id },
        data: {
          name,
          description,
          operation,
          status,
          TaxComponent: {
            create: (components || []).map((c: any) => ({
              name: c.name,
              percentage: c.percentage,
              isRecoverable: c.isRecoverable,
              baseType: c.baseType,
            }))
          }
        },
        include: { TaxComponent: true }
      });
    });
    res.json(rule);
  });

  app.delete("/api/tax-rules/:id", async (req, res) => {
    const { id } = req.params;
    await prisma.taxRule.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- API: Product Pricing (Formação de Preço) ---
  app.get("/api/pricing", async (req, res) => {
    const pricings = await prisma.productPricing.findMany({
      include: { Product: true, TaxRule: { include: { TaxComponent: true } } },
    });
    res.json(pricings);
  });

  app.post("/api/pricing", async (req, res) => {
    const { productId, taxRuleId, desiredMargin, commission, freightOut, otherVariables } = req.body;
    const pricing = await prisma.productPricing.upsert({
      where: { productId_taxRuleId: { productId, taxRuleId } },
      update: { desiredMargin, commission, freightOut, otherVariables },
      create: { productId, taxRuleId, desiredMargin, commission, freightOut, otherVariables },
    });
    res.json(pricing);
  });

  app.post("/api/pricing/bulk-delete", async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
       return res.status(400).json({ error: "Nenhum ID fornecido para exclusão." });
    }

    let successCount = 0; let errorCount = 0;
    const errorsList = [];

    for (const id of ids) {
       try {
         await prisma.productPricing.delete({ where: { id } });
         successCount++;
       } catch (err: any) {
         errorCount++;
         if (err.code === 'P2003') {
           errorsList.push({ id, message: "Bloqueio relacional ativo (Vínculo de Restrição)." });
         } else {
           errorsList.push({ id, message: err.message || "Erro genérico." });
         }
       }
    }

    res.json({
       total: ids.length, success: successCount, error: errorCount,
       details: errorsList
    });
  });

  app.delete("/api/pricing/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      const target = await prisma.productPricing.findUnique({ where: { id } });
      if (!target) return res.status(404).json({ error: "Formação de preço não encontrada no sistema." });
      
      await prisma.productPricing.delete({ where: { id } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("Erro ao excluir premissa de preço:", err);
      if (err.code === 'P2003') {
        return res.status(400).json({ error: "Não é possível excluir esta formação de preço porque ela possui vínculos ativos irreversíveis." });
      }
      res.status(500).json({ error: "Erro interno ao tentar apagar a formação." });
    }
  });

  app.get("/api/pricing/:productId/:taxRuleId/calculate", async (req, res) => {
    const { productId, taxRuleId } = req.params;

    try {
      // 1. Buscar dados do produto (custos) - Chamada direta da função interna
      const costData = await getProductCostAnalysis(productId);
      if (!costData) return res.status(404).json({ error: "Produto não encontrado para análise de custo" });
      if (isCostAnalysisFailure(costData)) return res.status(400).json(costData);

      // 2. Buscar premissas de preço
      const pricing = await prisma.productPricing.findUnique({
        where: { productId_taxRuleId: { productId, taxRuleId } },
        include: { TaxRule: { include: { TaxComponent: true } } }
      });

      if (!pricing) return res.status(404).json({ error: "Configuração de preço não encontrada" });

      const summary = (costData as any).summary || costData;
      const ciu = Number(summary.costPerUnit || summary.totalIndustrialCost);
      const opex = Number(summary.totalOPEX_Unit);
    
    // Custo Fabril Completo = CIU (que já inclui CIF)
    const custoFabril = ciu;
    // Custo Gerencial Total = CIU + OPEX
    const custoGerencial = ciu + opex;

    const taxRate = pricing.TaxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100;
    const commRate = Number(pricing.commission) / 100;
    const marginRate = Number(pricing.desiredMargin) / 100;
    const otherRate = Number(pricing.otherVariables) / 100;
    const freight = Number(pricing.freightOut);

    // Cálculo do Preço de Venda (Markup Divisor)
    // PV = (Custo + Frete) / (1 - Impostos - Comissões - Outros - Margem)
    const divisor = 1 - taxRate - commRate - otherRate - marginRate;
    
    if (divisor <= 0) return res.status(400).json({ error: "Margem e impostos excedem 100% do preço." });

    const suggestedPrice = (custoFabril + freight) / divisor;
    const totalTaxes = suggestedPrice * taxRate;
    const totalCommission = suggestedPrice * commRate;
    const totalOther = suggestedPrice * otherRate;

    const contributionMargin = suggestedPrice - totalTaxes - totalCommission - freight - custoFabril;
    const operationalMargin = contributionMargin - opex;

      res.json({
        product: costData.name,
        sku: costData.sku,
        ciu,
        custoFabril,
        custoGerencial,
        premissas: {
          taxRate: taxRate * 100,
          commRate: commRate * 100,
          marginRate: marginRate * 100,
          freight,
        },
        resultados: {
          suggestedPrice,
          totalTaxes,
          totalCommission,
          contributionMargin,
          operationalMargin,
          markup: suggestedPrice / custoFabril,
        }
      });
    } catch (error) {
      console.error("Pricing calculation error:", error);
      res.status(500).json({ error: "Erro ao calcular preço" });
    }
  });

  app.post("/api/pricing/simulate-batch", async (req, res) => {
    const { productIds, taxRuleId, desiredMargin, commission, freightOut, otherVariables } = req.body;
    
    if (!Array.isArray(productIds) || productIds.length === 0) return res.status(400).json({ error: "Nenhum produto selecionado" });
    
    try {
      const taxRule = await prisma.taxRule.findUnique({
        where: { id: taxRuleId },
        include: { TaxComponent: true }
      });
      if (!taxRule) return res.status(404).json({ error: "Regra fiscal não encontrada." });

      const taxRate = taxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100;
      const commRate = Number(commission || 0) / 100;
      const marginRate = Number(desiredMargin || 0) / 100;
      const otherRate = Number(otherVariables || 0) / 100;
      const freight = Number(freightOut || 0);

      const divisor = 1 - taxRate - commRate - otherRate - marginRate;

      const results = [];
      let successCount = 0; let errorCount = 0;

      for (const pid of productIds) {
        try {
          const costData = await getProductCostAnalysis(pid);
          if (!costData || "error" in (costData as any)) {
            errorCount++;
            results.push({ productId: pid, status: "ERROR", message: (costData as any)?.message || "Custo inconclusivo ou sem roteiro" });
            continue;
          }

          const summary = (costData as any).summary || costData;
          const ciu = Number(summary.costPerUnit || summary.totalIndustrialCost);
          
          if (divisor <= 0) {
            errorCount++;
            results.push({ productId: pid, sku: summary.sku, name: summary.name, status: "ERROR", message: "Margem e impostos excedem 100%." });
            continue;
          }

          const suggestedPrice = (ciu + freight) / divisor;

          successCount++;
          results.push({
            productId: pid,
            sku: summary.sku,
            name: summary.name,
            ciu,
            suggestedPrice,
            marginRate: desiredMargin,
            markup: ciu > 0 ? suggestedPrice / ciu : 0,
            status: "SUCCESS"
          });
        } catch (err: any) {
          errorCount++;
          results.push({ productId: pid, status: "ERROR", message: err.message || "Erro genérico no motor" });
        }
      }

      res.json({ summary: { total: productIds.length, success: successCount, error: errorCount }, results });
    } catch (err) {
      console.error("Batch simulate error:", err);
      res.status(500).json({ error: "Falha catastrófica no motor de lote." });
    }
  });

  app.post("/api/pricing/apply-batch", async (req, res) => {
    const { validResults, taxRuleId, desiredMargin, commission, freightOut, otherVariables } = req.body;
    
    if (!Array.isArray(validResults) || validResults.length === 0) return res.status(400).json({ error: "Nenhum resultado válido fornecido" });

    try {
       let appliedCount = 0;
       for (const item of validResults) {
          if (item.status !== "SUCCESS") continue;
          await prisma.productPricing.upsert({
            where: { productId_taxRuleId: { productId: item.productId, taxRuleId } },
            update: { desiredMargin, commission, freightOut, otherVariables },
            create: { productId: item.productId, taxRuleId, desiredMargin, commission, freightOut, otherVariables }
          });
          appliedCount++;
       }
       res.json({ success: true, appliedCount });
    } catch (err) {
      console.error("Batch apply error:", err);
      res.status(500).json({ error: "Erro ao aplicar premissas em banco." });
    }
  });

  // --- API: Simulations (What-if Analysis) ---
  app.get("/api/simulations", async (req, res) => {
    const simulations = await prisma.simulation.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(simulations);
  });

  app.post("/api/simulations", async (req, res) => {
    const data = req.body;
    const simulation = await prisma.simulation.create({ data });
    res.json(simulation);
  });

  app.delete("/api/simulations/:id", async (req, res) => {
    const { id } = req.params;
    await prisma.simulation.delete({ where: { id } });
    res.json({ success: true });
  });

  app.get("/api/simulations/:id/compare", async (req, res) => {
    const { id } = req.params;
    try {
      const sim = await prisma.simulation.findUnique({ where: { id } });
      if (!sim) return res.status(404).json({ error: "Simulação não encontrada" });

      // 1. Buscar Dados Oficiais (Base) - Chamada direta da função interna
      const baseData = await getProductCostAnalysis(sim.productId);
      if (!baseData) return res.status(404).json({ error: "Produto base não encontrado" });
      if (isCostAnalysisFailure(baseData)) return res.status(400).json(baseData);

      // Buscar premissas de preço oficiais
      const pricing = await prisma.productPricing.findUnique({
        where: { productId_taxRuleId: { productId: sim.productId, taxRuleId: sim.taxRuleId } },
        include: { TaxRule: { include: { TaxComponent: true } } }
      });

      if (!pricing) return res.status(404).json({ error: "Configuração de preço base não encontrada" });

      // Simular o retorno do endpoint de cálculo para manter compatibilidade
      const taxRateBase = pricing.TaxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100;
      const ciuBase = Number((baseData as any).totalIndustrialCost);
      const opexBase = Number((baseData as any).totalOPEX_Unit);
      const freightBase = Number(pricing.freightOut);
      const commRateBase = Number(pricing.commission) / 100;
      const marginRateBase = Number(pricing.desiredMargin) / 100;
      const otherRateBase = Number(pricing.otherVariables) / 100;

      const divisorBase = 1 - taxRateBase - commRateBase - otherRateBase - marginRateBase;
      const suggestedPriceBase = divisorBase > 0 ? (ciuBase + freightBase) / divisorBase : 0;

      const base = {
        ciu: ciuBase,
        custoGerencial: ciuBase + opexBase,
        premissas: {
          taxRate: taxRateBase * 100,
          commRate: commRateBase * 100,
          marginRate: marginRateBase * 100,
          freight: freightBase,
        },
        resultados: {
          suggestedPrice: suggestedPriceBase
        }
      };

      // 2. Aplicar Ajustes (Simulação)
    const matAdj = 1 + (Number(sim.materialAdj) / 100);
    const laborAdj = 1 + (Number(sim.laborAdj) / 100);
    const indirectAdj = 1 + (Number(sim.indirectAdj) / 100);
    const efficiencyAdj = 1 + (Number(sim.efficiencyAdj) / 100);
    const marginAdj = 1 + (Number(sim.marginAdj) / 100);

    // Recalcular Custo Industrial Simulado
    const simCIU_Materials = base.ciu * 0.6 * matAdj; // Estimativa: 60% do CIU é material
    const simCIU_Conversion = base.ciu * 0.3 * laborAdj / efficiencyAdj; // Estimativa: 30% é conversão
    const simCIU_CIF = base.ciu * 0.1 * indirectAdj; // Estimativa: 10% é CIF
    
    const simCIU = simCIU_Materials + simCIU_Conversion + simCIU_CIF;
    const simOPEX = base.custoGerencial - base.ciu;
    const simCustoGerencial = simCIU + (simOPEX * indirectAdj);

    // Recalcular Preço Sugerido Simulado
    const taxRate = base.premissas.taxRate / 100;
    const commRate = base.premissas.commRate / 100;
    const marginRate = (base.premissas.marginRate * marginAdj) / 100;
    const freight = base.premissas.freight;

    const divisor = 1 - taxRate - commRate - marginRate;
    const simSuggestedPrice = (simCIU + freight) / divisor;

    res.json({
      simulationMethod: "HEURISTIC_LAYER_SPLIT",
      simulationNote:
        "Cenário simulado reparte o CIU em faixas fixas (60% MP / 30% conversão / 10% CIF) para aplicar alavancas; não reroda o motor getProductCostAnalysis. Base oficial permanece em base.ciu.",
      base,
      simulated: {
        ciu: simCIU,
        custoGerencial: simCustoGerencial,
        suggestedPrice: simSuggestedPrice,
        marginRate: marginRate * 100,
        markup: simSuggestedPrice / simCIU,
      },
      delta: {
        price: simSuggestedPrice - base.resultados.suggestedPrice,
        pricePct: ((simSuggestedPrice / base.resultados.suggestedPrice) - 1) * 100,
        ciu: simCIU - base.ciu,
        ciuPct: ((simCIU / base.ciu) - 1) * 100,
      }
    });
  } catch (error) {
    console.error("Simulation comparison error:", error);
    res.status(500).json({ error: "Erro ao comparar simulação" });
  }
});

  // --- Helper: Cálculo de Custo de Produto ---
  interface AnalysisCache {
    indirectCosts: any[];
    factoryHoursMonthly: number;
    globalHhCost: number;
    energyCost: number;
    workingHours: number;
    opexRatePerHour: number;
  }

  async function initAnalysisCache() {
    const indirects = await prisma.indirectCost.findMany({ where: { status: "ACTIVE" } });
    const factoryHoursParam = indirects.find(c => c.category === "GLOBAL_PARAM" && c.description === "FACTORY_HOURS_MONTHLY");
    const energyParam = indirects.find(c => c.category === "GLOBAL_PARAM" && c.description === "ENERGY_COST");
    const hoursParam = indirects.find(c => c.category === "GLOBAL_PARAM" && c.description === "WORKING_HOURS");
    const hhOverrideParam = indirects.find(c => c.category === "GLOBAL_PARAM" && c.description === "HH_VALUE_OVERRIDE");
    
    const fhMonthlyRaw = Number(factoryHoursParam?.monthlyValue);
    const energyRaw    = Number(energyParam?.monthlyValue);
    const hoursRaw     = Number(hoursParam?.monthlyValue);

    if (!factoryHoursParam || !Number.isFinite(fhMonthlyRaw) || fhMonthlyRaw <= 0)
      throw new Error("CONFIG_MISSING: FACTORY_HOURS_MONTHLY inválido.");
    if (!energyParam || !Number.isFinite(energyRaw))
      throw new Error("CONFIG_MISSING: ENERGY_COST inválido.");
    if (!hoursParam || !Number.isFinite(hoursRaw) || hoursRaw <= 0)
      throw new Error("CONFIG_MISSING: WORKING_HOURS inválido.");

    const allEmps = await prisma.employee.findMany({ include: { Role: true, EmployeePayrollComponent: { include: { PayrollComponent: true } } } });
    let megaPayroll = 0;
    allEmps.forEach(e => {
        const sal = Number(e.salary || e.Role?.baseSalary || 0);
        let loads = 0;
        e.EmployeePayrollComponent.forEach(r => {
            loads += r.PayrollComponent.calculationType === "PERCENTAGE" ? (sal * Number(r.PayrollComponent.value)) / 100 : Number(r.PayrollComponent.value);
        });
        megaPayroll += sal + loads;
    });
    
    const autoHhCost = megaPayroll / (fhMonthlyRaw || 1);
    
    let globalHhCost = 0;
    let hhSource: "AUTO" | "MANUAL" = "AUTO";

    const overrideVal = Number(hhOverrideParam?.monthlyValue);
    if (hhOverrideParam && Number.isFinite(overrideVal) && overrideVal > 0) {
      globalHhCost = overrideVal;
      hhSource = "MANUAL";
    } else {
      globalHhCost = autoHhCost;
      hhSource = "AUTO";
    }

    const totalOpex = indirects.filter(c => c.category !== "CIF" && c.category !== "GLOBAL_PARAM").reduce((acc, c) => acc + Number(c.monthlyValue), 0);

    return { 
      indirectCosts: indirects, 
      factoryHoursMonthly: fhMonthlyRaw, 
      energyCost: energyRaw, 
      workingHours: hoursRaw, 
      globalHhCost,
      hhSource,
      autoHhCost,
      opexRatePerHour: totalOpex / fhMonthlyRaw 
    };
  }

  // --- API: Global Settings Preview ---
  app.get("/api/settings/globals", async (req, res) => {
    try {
      const cache = await initAnalysisCache();
      const indirects = await prisma.indirectCost.findMany({ where: { category: "GLOBAL_PARAM" } });
      
      const energy = indirects.find(c => c.description === "ENERGY_COST");
      const hours = indirects.find(c => c.description === "WORKING_HOURS");
      const factoryH = indirects.find(c => c.description === "FACTORY_HOURS_MONTHLY");
      const hhOverride = indirects.find(c => c.description === "HH_VALUE_OVERRIDE");

      res.json({
        values: {
          energyCost: energy ? Number(energy.monthlyValue) : 0,
          workingHours: hours ? Number(hours.monthlyValue) : 176,
          factoryHours: factoryH ? Number(factoryH.monthlyValue) : 8448,
          hhOverride: hhOverride ? Number(hhOverride.monthlyValue) : null,
        },
        ids: {
          energyId: energy?.id,
          hoursId: hours?.id,
          factoryId: factoryH?.id,
          hhOverrideId: hhOverride?.id
        },
        calculated: {
          hhAuto: cache.autoHhCost,
          hhEffective: cache.globalHhCost,
          hhSource: cache.hhSource
        }
      });
    } catch (error) {
      console.error("Error fetching global settings:", error);
      res.status(500).json({ error: "Erro ao carregar configurações globais." });
    }
  });

  function isCostAnalysisFailure(x: unknown): x is { error: string; message?: string } {
    return typeof x === "object" && x !== null && "error" in x && typeof (x as { error: unknown }).error === "string";
  }

  /** Avisos técnicos (cadastro/custeio suspeito). Não substituem erro fatal. */
  type CostAnalysisWarning = {
    code: string;
    severity: "warning";
    message: string;
    context: "MATERIAL" | "CHILD_COMPONENT" | "BOM_LINE";
    materialId?: string;
    childProductId?: string;
    bomLineId?: string;
    sku?: string;
    name?: string;
  };

  function mergeCostWarnings(
    parent: CostAnalysisWarning[],
    nested: unknown
  ): void {
    if (!nested || typeof nested !== "object" || !("warnings" in nested)) return;
    const w = (nested as { warnings?: unknown }).warnings;
    if (!Array.isArray(w)) return;
    for (const x of w) {
      if (x && typeof x === "object" && "message" in x && "code" in x) {
        parent.push(x as CostAnalysisWarning);
      }
    }
  }

  async function getProductCostAnalysis(
    productId: string,
    cache?: AnalysisCache,
    includeDetails = false,
    pathStack?: Set<string>
  ) {
    if (!cache) {
      try {
        const newCache = await initAnalysisCache();
        return getProductCostAnalysis(productId, newCache, includeDetails, pathStack);
      } catch (e: any) {
        return { error: "CONFIG_MISSING", message: e.message };
      }
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        ProductBOM: { orderBy: { id: "asc" }, include: { Material: true } },
        ProductRouting: { include: { Machine: { include: { MachineCostComponent: true } }, Role: true } },
      },
    });

    if (!product) return null;

    const stack = pathStack ?? new Set<string>();
    if (stack.has(productId)) {
      return {
        error: "BOM_CYCLE",
        message:
          "Ciclo estrutural na BOM: um produto/componente aparece mais de uma vez no caminho recursivo de custeio.",
        cycleProductId: productId,
      };
    }

    stack.add(productId);
    try {
    const lotSize = Number(product.defaultLotSize) || 1;

    const warnings: CostAnalysisWarning[] = [];
    /** Evita segunda passagem recursiva no bloco `details` (mesmo resultado da primeira). */
    const bomLineChildAnalysisCache = new Map<string, Record<string, unknown>>();

    // 1. Materiais / Componentes (Recurso) — recursão com pathStack; ciclo detectado; erros de filho propagam (nunca custo zero por falha silenciosa)
    const materialLineCosts: number[] = [];
    for (const item of product.ProductBOM) {
      if (item.Material) {
        const mat = item.Material;
        const landedCost = Number(mat.currentCost) + Number(mat.freight);
        if (!Number.isFinite(landedCost) || landedCost <= 0) {
          warnings.push({
            code: "MATERIAL_ZERO_OR_INVALID_LANDED_COST",
            severity: "warning",
            message: `Matéria-prima [${mat.code}] (${mat.description}) com custo aterrissado zerado ou inválido — revisar cadastro de custo/frete.`,
            context: "MATERIAL",
            materialId: mat.id,
            sku: mat.code,
            name: mat.description,
            bomLineId: item.id,
          });
        }
        const matEffectiveCost = landedCost / (1 - (Number(mat.standardLoss) / 100));
        const requiredQty = Number(item.quantity) / (1 - (Number(item.lossPercentage) / 100));
        const lineTotal = matEffectiveCost * requiredQty;
        if (lineTotal === 0 && landedCost > 0) {
          warnings.push({
            code: "BOM_LINE_ZERO_TOTAL_DESPITE_MATERIAL_COST",
            severity: "warning",
            message: `Linha BOM [${product.sku}] matéria [${mat.code}]: custo de linha zerado (quantidade/perdas?) — revisar.`,
            context: "MATERIAL",
            materialId: mat.id,
            sku: mat.code,
            bomLineId: item.id,
          });
        }
        materialLineCosts.push(lineTotal);
        continue;
      }

      if (item.childProductId) {
        const childAnalysis = await getProductCostAnalysis(item.childProductId, cache, false, stack);
        if (childAnalysis === null) {
          return {
            error: "CHILD_NOT_FOUND",
            message: `Componente referenciado na BOM de [${product.sku}] não existe (ID órfão).`,
            parentProductId: product.id,
            parentSku: product.sku,
            childProductId: item.childProductId,
            bomLineId: item.id,
          };
        }
        if (isCostAnalysisFailure(childAnalysis)) {
          return {
            error: "CHILD_COST_FAILED",
            message: `Falha ao custear componente filho na BOM de [${product.sku}].`,
            parentProductId: product.id,
            parentSku: product.sku,
            childProductId: item.childProductId,
            bomLineId: item.id,
            cause: childAnalysis,
          };
        }
        bomLineChildAnalysisCache.set(item.id, childAnalysis as Record<string, unknown>);
        mergeCostWarnings(warnings, childAnalysis);

        const childUnitCost = childAnalysis.totalIndustrialCost;
        if (!Number.isFinite(childUnitCost) || childUnitCost <= 0) {
          warnings.push({
            code: "CHILD_ZERO_OR_INVALID_INDUSTRIAL_COST",
            severity: "warning",
            message: `Componente filho [${childAnalysis.sku ?? "?"}] (${childAnalysis.name ?? "—"}) com custo industrial total zerado ou inválido — revisar processo/BOM/custeio do filho.`,
            context: "CHILD_COMPONENT",
            childProductId: item.childProductId,
            sku: childAnalysis.sku,
            name: childAnalysis.name,
            bomLineId: item.id,
          });
        }
        const requiredQty = Number(item.quantity) / (1 - (Number(item.lossPercentage) / 100));
        materialLineCosts.push(childUnitCost * requiredQty);
        continue;
      }

      return {
        error: "BOM_LINE_INCOMPLETE",
        message: `Linha da BOM de [${product.sku}] sem material ou componente associado — estrutura inválida para custeio.`,
        parentProductId: product.id,
        parentSku: product.sku,
        bomLineId: item.id,
      };
    }
    const totalMaterialCost = materialLineCosts.reduce((acc, u) => acc + u, 0);

    // 2. Operações (A Mágica da Prioridade)
    let operationItems: Array<{ 
      totalHH: number, 
      totalHM: number, 
      totalTimeH: number,
      breakdown?: any 
    }> = [];

    if (product.type === "COMPONENT" && product.cycleTimeSeconds !== null && Number(product.cycleTimeSeconds) > 0) {
      // PRIORIDADE 1: Processo Padrão do Componente
      const cycle = Number(product.cycleTimeSeconds);
      const cav = Number(product.cavities);
      const eff = Number(product.efficiencyExpected);
      const setup = Number(product.setupTimeMin);

      if (!Number.isFinite(cycle) || cycle <= 0 || !Number.isFinite(cav) || cav < 1 || !Number.isFinite(eff) || eff <= 0 || !Number.isFinite(setup)) {
        return { error: "PROCESS_INVALID", message: `Componente [${product.sku}]: Processo Padrão com dados inválidos.` };
      }

      const effDecimal = eff / 100;
      const machineHourCost = cache.energyCost / cache.workingHours;
      const cellHourCost = machineHourCost + cache.globalHhCost;
      
      const netPph = (3600 / cycle) * cav * effDecimal;
      const unitTransform = cellHourCost / netPph;
      
      const setupH = setup / 60;
      const setupCost = (setupH * cellHourCost) / lotSize;
      const totalStepCost = unitTransform + setupCost;

      operationItems.push({
        totalHH: totalStepCost * (cellHourCost > 0 ? cache.globalHhCost / cellHourCost : 0),
        totalHM: totalStepCost * (cellHourCost > 0 ? machineHourCost / cellHourCost : 0),
        totalTimeH: (1/netPph) + (setupH/lotSize),
        breakdown: {
          source: "STANDARD_PROCESS",
          description: "Processo Padrão do Componente",
          timeMin: (1/netPph) * 60,
          ratePerMin: cellHourCost / 60,
          machineCost: unitTransform * (cellHourCost > 0 ? machineHourCost / cellHourCost : 0) + (setupCost * (cellHourCost > 0 ? machineHourCost / cellHourCost : 0)),
          laborCost: unitTransform * (cellHourCost > 0 ? cache.globalHhCost / cellHourCost : 0) + (setupCost * (cellHourCost > 0 ? cache.globalHhCost / cellHourCost : 0)),
          total: totalStepCost,
          calculationDetails: {
            cycle, cavities: cav, efficiency: eff, setupTimeMin: setup, lotSize,
            workingHours: cache.workingHours, energyCost: cache.energyCost, factoryHoursMonthly: cache.factoryHoursMonthly,
            globalHhCost: cache.globalHhCost, machineHourCost, cellHourCost,
            netPph, unitTransform, setupCost, totalStepCost
          }
        }
      });

    } else if (product.ProductRouting.length > 0) {
      // PRIORIDADE 2: Roteiro (produto final ou componente com operações explícitas)
      const rolesWithComponents = await Promise.all(product.ProductRouting.map(async (step) => {
        const emp = await prisma.employee.findFirst({
          where: { roleId: step.roleId },
          include: { EmployeePayrollComponent: { include: { PayrollComponent: true } } }
        });
        return { roleId: step.roleId, components: emp?.EmployeePayrollComponent || [] };
      }));

      operationItems = product.ProductRouting.map((step) => {
        const roleData = rolesWithComponents.find(rc => rc.roleId === step.roleId);
        const machineHourCost = cache.energyCost / cache.workingHours;
        const salary = Number(step.Role?.baseSalary || 0);
        let totalPayrollLoad = 0;
        const payrollComponents = roleData?.components || [];
        
        if (payrollComponents.length > 0) {
          payrollComponents.forEach((rel: any) => {
            const comp = rel.PayrollComponent;
            totalPayrollLoad += comp.calculationType === "PERCENTAGE" ? (salary * Number(comp.value)) / 100 : Number(comp.value);
          });
        } else {
          totalPayrollLoad = salary * 0.8;
        }

        const hhCost = (salary + totalPayrollLoad) / Number(step.Role?.monthlyHours || 220);
        const cellHourCost = machineHourCost + hhCost;

        const cycle = Number(step.cycleTimeSeconds) > 0 ? Number(step.cycleTimeSeconds) : (Number(step.operationTimeMin) > 0 ? Number(step.operationTimeMin) * 60 : 30);
        const cav = Number(step.cavities) >= 1 ? Number(step.cavities) : 1;
        const eff = Number(step.efficiencyExpected) > 0 ? Number(step.efficiencyExpected) : 100;
        const effDecimal = eff / 100;

        const netPph = (3600 / cycle) * cav * effDecimal;
        const unitTransform = cellHourCost / netPph;
        const setupH = Number(step.setupTimeMin) / 60;
        const setupCost = (setupH * cellHourCost) / lotSize;
        const totalStepCost = unitTransform + setupCost;

        return {
          totalHH: totalStepCost * (cellHourCost > 0 ? hhCost / cellHourCost : 0),
          totalHM: totalStepCost * (cellHourCost > 0 ? machineHourCost / cellHourCost : 0),
          totalTimeH: (1 / netPph) + (setupH / lotSize),
          breakdown: {
            source: "ROUTING",
            description: step.description || `Op. ${step.sequence}`,
            timeMin: (1/netPph) * 60,
            ratePerMin: cellHourCost / 60,
            machineCost: totalStepCost * (cellHourCost > 0 ? machineHourCost / cellHourCost : 0),
            laborCost: totalStepCost * (cellHourCost > 0 ? hhCost / cellHourCost : 0),
            total: totalStepCost,
            calculationDetails: {
              cycle, cavities: cav, efficiency: eff, setupTimeMin: Number(step.setupTimeMin), lotSize,
              hhCost, machineHourCost, cellHourCost, netPph, unitTransform, setupCost, totalStepCost
            }
          }
        };
      });

    } else if (product.type === "COMPONENT") {
      // Componente fabricado precisa de Processo Padrão (ramo acima) ou de roteiro.
      // PRODUCT pode ser apenas montagem de BOM (materiais + filhos) sem processo próprio — custo industrial = BOM + CIF/OPEX sobre tempo zero.
      return { error: "ROUTING_MISSING", message: `Componente [${product.sku}] sem processo (padrão ou roteiro).` };
    }

    const totalHH_Unit = operationItems.reduce((acc, item) => acc + item.totalHH, 0);
    const totalHM_Unit = operationItems.reduce((acc, item) => acc + item.totalHM, 0);
    const totalTimeH_Unit = operationItems.reduce((acc, item) => acc + item.totalTimeH, 0);

    // 3. CIF/OPEX
    if (!cache) return { error: "FATAL_ERROR", message: "Cache de parâmetros não inicializado." };
    if (cache.factoryHoursMonthly <= 0) {
      return { error: "CONFIG_MISSING", message: "Parâmetro global FACTORY_HOURS_MONTHLY não configurado ou inválido." };
    }
    const totalCIF_Monthly = cache.indirectCosts.filter(c => c.category === "CIF").reduce((acc, c) => acc + Number(c.monthlyValue), 0);
    
    const cifRatePerHour = totalCIF_Monthly / cache.factoryHoursMonthly;
    const opexRatePerHour = cache.opexRatePerHour;
    
    const totalCIF_Unit = totalTimeH_Unit * cifRatePerHour;
    const totalOPEX_Unit = totalTimeH_Unit * opexRatePerHour;

    const totalIndustrialCost = totalMaterialCost + totalHH_Unit + totalHM_Unit + totalCIF_Unit;

    const result: any = {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      totalMaterialCost,
      totalHH_Unit,
      totalHM_Unit,
      totalCIF_Unit,
      totalOPEX_Unit,
      totalIndustrialCost,
      totalGerencialCost: totalIndustrialCost + totalOPEX_Unit,
      warnings,
      warningCount: warnings.length,
    };

    if (includeDetails) {
      const materialsRows: Array<{
        description: string;
        basePrice: number;
        requiredQty: number;
        unitCost: number;
      } | null> = [];
      for (const item of product.ProductBOM) {
        const bomLoss = Number(item.lossPercentage) / 100;
        const requiredQty = Number(item.quantity) / (1 - bomLoss);
        if (item.Material) {
          const mat = item.Material;
          const matStandardLoss = Number(mat.standardLoss) / 100;
          const landedCost = Number(mat.currentCost) + Number(mat.freight);
          const matEffectiveCost = landedCost / (1 - matStandardLoss);
          materialsRows.push({
            description: mat.description,
            basePrice: Number(mat.currentCost),
            requiredQty,
            unitCost: matEffectiveCost * requiredQty,
          });
          continue;
        }
        if (item.childProductId) {
          const childResult = bomLineChildAnalysisCache.get(item.id);
          if (!childResult || isCostAnalysisFailure(childResult)) {
            return {
              error: "INTERNAL_BOM_CACHE_MISS",
              message: `Inconsistência ao montar detalhes da BOM de [${product.sku}] — recálculo de filho ausente (cache).`,
              parentProductId: product.id,
              parentSku: product.sku,
              childProductId: item.childProductId,
              bomLineId: item.id,
            };
          }
          materialsRows.push({
            description: String(childResult.name ?? "—"),
            basePrice: Number(childResult.totalIndustrialCost ?? 0),
            requiredQty,
            unitCost: Number(childResult.totalIndustrialCost ?? 0) * requiredQty,
          });
          continue;
        }
        materialsRows.push(null);
      }
      result.details = {
        materials: materialsRows.filter(Boolean) as Array<{
          description: string;
          basePrice: number;
          requiredQty: number;
          unitCost: number;
        }>,
        processBreakdown: operationItems.map((oi) => oi.breakdown).filter(Boolean),
      };

      const detailMaterials = result.details.materials;
      const lineSum = detailMaterials.reduce((acc, row) => acc + row.unitCost, 0);
      if (
        Number.isFinite(lineSum) &&
        Number.isFinite(totalMaterialCost) &&
        Math.abs(lineSum - totalMaterialCost) > 0.0001
      ) {
        warnings.push({
          code: "BOM_DETAIL_TOTAL_DIVERGENCE",
          severity: "warning",
          message: `Soma do detalhamento da BOM (${lineSum.toFixed(6)}) difere do total consolidado (${totalMaterialCost.toFixed(6)}) — revisar arredondamento ou consistência das linhas.`,
          context: "BOM_LINE",
        });
        result.warningCount = warnings.length;
      }
    }

    return result;
    } finally {
      stack.delete(productId);
    }
  }

  // --- API: Product Cost Analysis (Motor de Cálculo CIU com CIF) ---
  app.get("/api/products/:id/cost-analysis", async (req, res) => {
    try {
      const { id } = req.params;
      const analysis = await getProductCostAnalysis(id, undefined, true);
      if (!analysis) return res.status(404).json({ error: "Produto não encontrado" });
      if ("error" in analysis) return res.status(400).json(analysis);

      // Mapeamento para garantir retrocompatibilidade com o frontend atual
      const calculationExplainability = buildCostAnalysisExplainability(analysis as any);
      res.json({
        ...analysis,
        summary: {
          totalMaterialCost: analysis.totalMaterialCost,
          totalConversionCost: analysis.totalHH_Unit + analysis.totalHM_Unit,
          totalCIF_Unit: analysis.totalCIF_Unit,
          totalOPEX_Unit: analysis.totalOPEX_Unit,
          totalIndustrialCost: analysis.totalIndustrialCost,
          totalGerencialCost: analysis.totalGerencialCost
        },
        calculationExplainability,
        // O breakdown de materiais e operações agora vem direto dos details do motor
        audit: { calculatedAt: new Date().toISOString() }
      });
    } catch (error) {
      console.error("Cost analysis endpoint error:", error);
      res.status(500).json({ error: "Erro interno no cálculo da análise." });
    }
  });

  app.patch("/api/employees/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const employee = await prisma.employee.update({
      where: { id },
      data: { status },
    });
    res.json(employee);
  });

  app.get("/api/products/:id/pricing-snapshot", async (req, res) => {
    const { id } = req.params;
    const { taxRuleId } = req.query;

    try {
      const analysis = await getProductCostAnalysis(id);
      if (!analysis) return res.status(404).json({ error: "Produto não encontrado" });
      if (isCostAnalysisFailure(analysis)) return res.status(400).json(analysis);

      let pricing = null;
      if (taxRuleId) {
        pricing = await prisma.productPricing.findFirst({
          where: { productId: id, taxRuleId: taxRuleId as string },
          include: { TaxRule: { include: { TaxComponent: true } } }
        });
      }

      if (!pricing) {
        pricing = await prisma.productPricing.findFirst({
          where: { productId: id },
          include: { TaxRule: { include: { TaxComponent: true } } }
        });
      }

      const taxRate = pricing?.TaxRule?.TaxComponent?.reduce((acc: number, c: any) => acc + Number(c.percentage), 0) / 100 || 0;
      const commRate = Number(pricing?.commission || 0) / 100;
      const marginRate = Number(pricing?.desiredMargin || 0) / 100;
      const otherRate = Number(pricing?.otherVariables || 0) / 100;
      const freight = Number(pricing?.freightOut || 0);

      const divisor = 1 - taxRate - commRate - otherRate - marginRate;
      const suggestedPrice = divisor > 0 ? (analysis.totalIndustrialCost + freight) / divisor : 0;

      const calculationExplainability = buildPricingSnapshotExplainability({
        analysis: analysis as any,
        taxRate,
        commRate,
        marginRate,
        otherRate,
        freight,
        suggestedPrice,
        divisor,
      });

      // marginPerc = premissa de margem desejada na formação de preço (compat.); preferir desiredMarginPremissaPct
      res.json({
        unitCost: analysis.totalIndustrialCost,
        suggestedPrice,
        taxesPerc: taxRate * 100,
        commissionPerc: commRate * 100,
        freightValue: freight,
        desiredMarginPremissaPct: marginRate * 100,
        marginPerc: marginRate * 100,
        costBase: "CIU_MOTOR",
        calculationExplainability,
      });
    } catch (error) {
      console.error("Pricing snapshot error:", error);
      res.status(500).json({ error: "Erro ao gerar snapshot de preço" });
    }
  });

  /** Agregações para a aba Relatórios (sem BI externo). Respeita filtros de query. */
  app.get("/api/reports/data", async (req, res) => {
    const q = req.query;
    const dateFrom = typeof q.dateFrom === "string" && q.dateFrom ? q.dateFrom : null;
    const dateTo = typeof q.dateTo === "string" && q.dateTo ? q.dateTo : null;
    const customerIdF = typeof q.customerId === "string" && q.customerId ? q.customerId : null;
    const responsibleF =
      typeof q.responsible === "string" && q.responsible.trim() ? q.responsible.trim() : null;
    const statusF =
      typeof q.status === "string" && q.status && q.status !== "ALL" ? q.status : null;
    const minNet = q.minNet != null && q.minNet !== "" ? Number(q.minNet) : null;
    const maxNet = q.maxNet != null && q.maxNet !== "" ? Number(q.maxNet) : null;
    const productIdF =
      typeof q.productId === "string" && q.productId ? q.productId : null;

    const endOfDay = (iso: string) => {
      const d = new Date(iso);
      d.setHours(23, 59, 59, 999);
      return d;
    };

    const where: any = {};
    if (dateFrom) where.createdAt = { ...(where.createdAt || {}), gte: new Date(dateFrom) };
    if (dateTo) where.createdAt = { ...(where.createdAt || {}), lte: endOfDay(dateTo) };
    if (customerIdF) where.customerId = customerIdF;
    if (responsibleF) where.responsible = responsibleF;
    if (statusF) where.status = statusF;
    if (
      (minNet != null && Number.isFinite(minNet)) ||
      (maxNet != null && Number.isFinite(maxNet))
    ) {
      where.totalNetValue = {} as { gte?: number; lte?: number };
      if (minNet != null && Number.isFinite(minNet)) where.totalNetValue.gte = minNet;
      if (maxNet != null && Number.isFinite(maxNet)) where.totalNetValue.lte = maxNet;
    }

    try {
      const proposals = await prisma.proposal.findMany({
        where,
        include: {
          Customer: { select: { id: true, companyName: true, tradeName: true } },
          items: {
            include: {
              Product: { select: { id: true, sku: true, name: true, type: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const probW: Record<string, number> = {
        DRAFT: 0.2,
        ANALYSIS: 0.4,
        SENT: 0.65,
        APPROVED: 1,
        REJECTED: 0,
        EXPIRED: 0.05,
        CANCELED: 0,
      };
      const pipelineOpen = (s: string) =>
        s === "DRAFT" || s === "ANALYSIS" || s === "SENT";
      const now = new Date();

      let proposalsFiltered = proposals;
      if (productIdF) {
        proposalsFiltered = proposals.filter((p) =>
          p.items.some((it) => it.productId === productIdF)
        );
      }

      const num = (v: unknown) => {
        const x = Number(v);
        return Number.isFinite(x) ? x : 0;
      };

      let totalNet = 0;
      let weightedPipeline = 0;
      let pipelineOpenNet = 0;
      let approvedNet = 0;
      const byStatus: Record<string, { count: number; netSum: number }> = {};
      const byResponsible = new Map<string, { count: number; netSum: number }>();
      const byMonth = new Map<string, { month: string; count: number; netSum: number; approvedNet: number }>();

      for (const p of proposalsFiltered) {
        const net = num(p.totalNetValue);
        totalNet += net;
        const st = p.status;
        weightedPipeline += net * (probW[st] ?? 0);
        if (pipelineOpen(st)) pipelineOpenNet += net;
        if (st === "APPROVED") approvedNet += net;
        if (!byStatus[st]) byStatus[st] = { count: 0, netSum: 0 };
        byStatus[st].count++;
        byStatus[st].netSum += net;
        const resp = (p.responsible || "").trim() || "(sem responsável)";
        const br = byResponsible.get(resp) || { count: 0, netSum: 0 };
        br.count++;
        br.netSum += net;
        byResponsible.set(resp, br);
        const c = new Date(p.createdAt);
        const key = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}`;
        const m = byMonth.get(key) || {
          month: key,
          count: 0,
          netSum: 0,
          approvedNet: 0,
        };
        m.count++;
        m.netSum += net;
        if (st === "APPROVED") m.approvedNet += net;
        byMonth.set(key, m);
      }

      const closedWon = proposalsFiltered.filter((p) => p.status === "APPROVED").length;
      const closedLost = proposalsFiltered.filter((p) =>
        ["REJECTED", "CANCELED"].includes(p.status)
      ).length;
      const convDenom = closedWon + closedLost;
      const conversionRate = convDenom > 0 ? closedWon / convDenom : null;

      const custAgg = new Map<
        string,
        { companyName: string; netSum: number; count: number; approvedNet: number; lastAt: Date }
      >();
      for (const p of proposalsFiltered) {
        const cid = p.customerId;
        const name = p.Customer?.companyName || "—";
        const net = num(p.totalNetValue);
        const g = custAgg.get(cid) || {
          companyName: name,
          netSum: 0,
          count: 0,
          approvedNet: 0,
          lastAt: new Date(0),
        };
        g.netSum += net;
        g.count++;
        if (p.status === "APPROVED") g.approvedNet += net;
        const ca = new Date(p.createdAt);
        if (ca > g.lastAt) g.lastAt = ca;
        custAgg.set(cid, g);
      }
      const topCustomersByNet = [...custAgg.entries()]
        .map(([customerId, v]) => ({
          customerId,
          companyName: v.companyName,
          netSum: v.netSum,
          proposalCount: v.count,
        }))
        .sort((a, b) => b.netSum - a.netSum)
        .slice(0, 25);
      const topCustomersByCount = [...custAgg.entries()]
        .map(([customerId, v]) => ({
          customerId,
          companyName: v.companyName,
          proposalCount: v.count,
          netSum: v.netSum,
        }))
        .sort((a, b) => b.proposalCount - a.proposalCount)
        .slice(0, 25);

      const approvedGroup = await prisma.proposal.groupBy({
        by: ["customerId"],
        where: { status: "APPROVED" },
        _sum: { totalNetValue: true },
      });
      const nameMap = new Map<string, string>();
      const customers = await prisma.customer.findMany({ select: { id: true, companyName: true } });
      customers.forEach((c) => nameMap.set(c.id, c.companyName));
      const abcRows = buildCustomerAbcRanking(
        approvedGroup.map((g) => ({
          customerId: g.customerId,
          revenue: Number(g._sum.totalNetValue ?? 0),
        })),
        nameMap
      );

      const STALE_DAYS = 14;
      const staleProposals = proposalsFiltered
        .filter((p) => pipelineOpen(p.status))
        .map((p) => {
          const daysSinceUpd = Math.floor(
            (now.getTime() - new Date(p.updatedAt).getTime()) / 86400000
          );
          return {
            id: p.id,
            number: p.number,
            status: p.status,
            customerName: p.Customer?.companyName || "—",
            responsible: (p.responsible || "").trim() || "—",
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            totalNetValue: num(p.totalNetValue),
            daysSinceUpdate: daysSinceUpd,
            stale: daysSinceUpd >= STALE_DAYS,
          };
        })
        .filter((x) => x.stale)
        .slice(0, 100);

      const validityExpiredOpen: Array<{
        id: string;
        number: number;
        status: string;
        customerName: string;
        daysOpen: number;
      }> = [];
      for (const p of proposalsFiltered) {
        if (!pipelineOpen(p.status)) continue;
        const vd = p.validityDays && p.validityDays > 0 ? p.validityDays : 15;
        const exp = new Date(p.createdAt).getTime() + vd * 86400000;
        if (exp < now.getTime()) {
          validityExpiredOpen.push({
            id: p.id,
            number: p.number,
            status: p.status,
            customerName: p.Customer?.companyName || "—",
            daysOpen: Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / 86400000),
          });
        }
      }

      const mixMap = new Map<
        string,
        {
          productId: string;
          sku: string;
          name: string;
          type: string;
          qty: number;
          revenue: number;
          marginSum: number;
          lines: number;
        }
      >();
      for (const p of proposalsFiltered) {
        for (const it of p.items) {
          const pr = it.Product;
          const pid = it.productId;
          const qty = num(it.quantity);
          const rev = qty * num(it.negotiatedPrice);
          const mg = num(it.marginValue);
          const prev = mixMap.get(pid);
          const sku = pr?.sku || "—";
          const name = pr?.name || "Produto";
          const type = String(pr?.type || "—");
          if (prev) {
            prev.qty += qty;
            prev.revenue += rev;
            prev.marginSum += mg;
            prev.lines += 1;
          } else {
            mixMap.set(pid, {
              productId: pid,
              sku,
              name,
              type,
              qty,
              revenue: rev,
              marginSum: mg,
              lines: 1,
            });
          }
        }
      }
      const mixByProduct = [...mixMap.values()].sort((a, b) => b.revenue - a.revenue);

      const allApprovedList = await prisma.proposal.findMany({
        where: { status: "APPROVED" },
        select: { customerId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      const datesByCustomer = new Map<string, Date[]>();
      for (const row of allApprovedList) {
        const arr = datesByCustomer.get(row.customerId) || [];
        arr.push(row.createdAt);
        datesByCustomer.set(row.customerId, arr);
      }
      function medianIntervals(dates: Date[]): number | null {
        if (dates.length < 2) return null;
        const gaps: number[] = [];
        for (let i = 1; i < dates.length; i++) {
          gaps.push(
            Math.floor((dates[i]!.getTime() - dates[i - 1]!.getTime()) / 86400000)
          );
        }
        const s = [...gaps].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
      }
      const repurchaseRows: Array<{
        customerId: string;
        companyName: string;
        medianDays: number | null;
        lastApprovedAt: string | null;
        daysSinceLast: number | null;
        lateVsMedian: boolean | null;
      }> = [];
      for (const [cid, dates] of datesByCustomer) {
        if (dates.length < 2) continue;
        const med = medianIntervals(dates);
        const last = dates[dates.length - 1]!;
        const daysSince = Math.floor((now.getTime() - last.getTime()) / 86400000);
        const late = med != null && med > 0 ? daysSince > med * 1.15 : null;
        repurchaseRows.push({
          customerId: cid,
          companyName: nameMap.get(cid) || "—",
          medianDays: med,
          lastApprovedAt: last.toISOString(),
          daysSinceLast: daysSince,
          lateVsMedian: late,
        });
      }
      repurchaseRows.sort((a, b) => (b.daysSinceLast || 0) - (a.daysSinceLast || 0));
      const repurchaseLate = repurchaseRows.filter((r) => r.lateVsMedian === true).slice(0, 40);

      const inactiveCustomers = [...custAgg.entries()]
        .filter(([, v]) => v.count > 0)
        .map(([customerId, v]) => ({
          customerId,
          companyName: v.companyName,
          proposalCount: v.count,
          lastProposalAt: v.lastAt.toISOString(),
        }))
        .sort((a, b) => new Date(a.lastProposalAt).getTime() - new Date(b.lastProposalAt).getTime())
        .slice(0, 30);

      const uniqueProductIds = [...new Set(proposalsFiltered.flatMap((p) => p.items.map((i) => i.productId)))];
      const MAX_COST_PRODUCTS = 50;
      const costSampleIds = uniqueProductIds.slice(0, MAX_COST_PRODUCTS);
      const productCostRows: Array<{
        productId: string;
        sku: string;
        name: string;
        totalIndustrialCost: number | null;
        suggestedPricePremissa: number | null;
        avgNegotiatedInPeriod: number | null;
        linesInPeriod: number;
        error?: string;
      }> = [];

      const negPriceByProduct = new Map<string, { sum: number; w: number }>();
      for (const p of proposalsFiltered) {
        for (const it of p.items) {
          const q = num(it.quantity);
          const price = num(it.negotiatedPrice);
          const o = negPriceByProduct.get(it.productId) || { sum: 0, w: 0 };
          o.sum += price * q;
          o.w += q;
          negPriceByProduct.set(it.productId, o);
        }
      }

      for (const pid of costSampleIds) {
        const mix = mixMap.get(pid);
        const analysis = await getProductCostAnalysis(pid);
        let totalIndustrial: number | null = null;
        let suggested = 0;
        let err: string | undefined;
        if (isCostAnalysisFailure(analysis)) {
          err = analysis.error;
        } else {
          totalIndustrial = analysis.totalIndustrialCost;
          const pricing = await prisma.productPricing.findFirst({
            where: { productId: pid },
            include: { TaxRule: { include: { TaxComponent: true } } },
          });
          if (pricing) {
            const taxRate =
              pricing.TaxRule?.TaxComponent?.reduce((acc, c) => acc + Number(c.percentage), 0) / 100 || 0;
            const commRate = Number(pricing.commission) / 100;
            const marginRate = Number(pricing.desiredMargin) / 100;
            const otherRate = Number(pricing.otherVariables) / 100;
            const freight = Number(pricing.freightOut);
            const divisor = 1 - taxRate - commRate - otherRate - marginRate;
            suggested = divisor > 0 ? (analysis.totalIndustrialCost + freight) / divisor : 0;
          }
        }
        const nw = negPriceByProduct.get(pid);
        const avgNeg = nw && nw.w > 0 ? nw.sum / nw.w : null;
        productCostRows.push({
          productId: pid,
          sku: mix?.sku || "—",
          name: mix?.name || "—",
          totalIndustrialCost: totalIndustrial,
          suggestedPricePremissa: err ? null : suggested,
          avgNegotiatedInPeriod: avgNeg,
          linesInPeriod: mix?.lines ?? 0,
          error: err,
        });
      }
      productCostRows.sort((a, b) => {
        const ga =
          a.suggestedPricePremissa != null && a.avgNegotiatedInPeriod != null
            ? a.avgNegotiatedInPeriod - a.suggestedPricePremissa
            : 0;
        const gb =
          b.suggestedPricePremissa != null && b.avgNegotiatedInPeriod != null
            ? b.avgNegotiatedInPeriod - b.suggestedPricePremissa
            : 0;
        return gb - ga;
      });

      let previousPeriod: {
        proposalCount: number;
        totalNet: number;
        approvedNet: number;
      } | null = null;
      if (dateFrom && dateTo) {
        const df = new Date(dateFrom);
        const dt = endOfDay(dateTo);
        const ms = dt.getTime() - df.getTime();
        const prevEnd = new Date(df.getTime() - 86400000);
        prevEnd.setHours(23, 59, 59, 999);
        const prevStart = new Date(prevEnd.getTime() - ms);
        prevStart.setHours(0, 0, 0, 0);
        const prevWhere: any = {
          createdAt: { gte: prevStart, lte: prevEnd },
        };
        if (customerIdF) prevWhere.customerId = customerIdF;
        if (responsibleF) prevWhere.responsible = responsibleF;
        if (statusF) prevWhere.status = statusF;
        const prevList = await prisma.proposal.findMany({
          where: prevWhere,
          include: { items: true },
        });
        let prevFiltered = prevList;
        if (productIdF) {
          prevFiltered = prevList.filter((p) => p.items.some((it) => it.productId === productIdF));
        }
        let pNet = 0;
        let pApp = 0;
        for (const p of prevFiltered) {
          const net = num(p.totalNetValue);
          pNet += net;
          if (p.status === "APPROVED") pApp += net;
        }
        previousPeriod = {
          proposalCount: prevFiltered.length,
          totalNet: pNet,
          approvedNet: pApp,
        };
      }

      res.json({
        generatedAt: now.toISOString(),
        filters: {
          dateFrom,
          dateTo,
          customerId: customerIdF,
          responsible: responsibleF,
          status: statusF,
          minNet,
          maxNet,
          productId: productIdF,
        },
        disclaimers: [
          "Não existe tabela de pedido faturado: valores aprovados usam propostas APPROVED como proxy de negócio fechado.",
          "Curva ABC e recompra usam histórico global de aprovações onde indicado.",
          uniqueProductIds.length > MAX_COST_PRODUCTS
            ? `Custo industrial: amostra de ${MAX_COST_PRODUCTS} produtos entre os do período (${uniqueProductIds.length} distintos).`
            : null,
        ].filter(Boolean),
        commercial: {
          proposalCount: proposalsFiltered.length,
          totalNet,
          approvedNet,
          pipelineOpenNet,
          weightedPipeline,
          ticketAvg: proposalsFiltered.length ? totalNet / proposalsFiltered.length : 0,
          conversionRate,
          closedWon,
          closedLost,
          byStatus,
          byResponsible: [...byResponsible.entries()]
            .map(([responsible, v]) => ({ responsible, ...v }))
            .sort((a, b) => b.netSum - a.netSum),
          byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
          staleProposals,
          validityExpiredOpen,
          topCustomersByNet,
          topCustomersByCount,
        },
        customers: {
          abc: abcRows,
          repurchaseLate,
          inactiveInPeriod: inactiveCustomers,
        },
        products: {
          mixByProduct,
        },
        costing: {
          productsAnalyzed: productCostRows,
          costProductLimit: MAX_COST_PRODUCTS,
          totalDistinctProductsInFilter: uniqueProductIds.length,
        },
        executive: {
          previousPeriod,
        },
      });
    } catch (error) {
      console.error("reports/data error:", error);
      res.status(500).json({ error: "Erro ao montar relatórios agregados." });
    }
  });

  // --- API: Customers (Clientes) ---
  // --- API: Customers (Clientes) ---
  app.get("/api/customers/import/template", (req, res) => {
    try {
      const buffer = ServerImporter.generateTemplate(CustomerImportConfig);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=template_clientes.xlsx");
      res.send(buffer);
    } catch (error) {
      console.error("Template generation error:", error);
      res.status(500).json({ error: "Erro ao gerar template" });
    }
  });

  app.post("/api/customers/import/preview", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    try {
      const result = await ServerImporter.parseExcel(req.file.buffer, CustomerImportConfig);
      const importId = crypto.randomUUID();
      importCache.set(importId, result.data);
      
      // Cleanup after 30 mins
      setTimeout(() => importCache.delete(importId), 30 * 60 * 1000);
      
      res.json({ ...result, importId });
    } catch (error) {
      console.error("Import preview error:", error);
      res.status(500).json({ error: "Erro ao processar planilha" });
    }
  });

  app.post("/api/customers/import/confirm", async (req, res) => {
    const { data: bodyData, importId } = req.body;
    let data = bodyData;

    if (importId && importCache.has(importId)) {
      data = importCache.get(importId);
      importCache.delete(importId);
    }

    if (!Array.isArray(data)) return res.status(400).json({ error: "Dados inválidos ou sessão de importação expirada." });

    try {
      const taxIds = data.map(d => d.taxId);
      const existing = await prisma.customer.findMany({
        where: { taxId: { in: taxIds } },
        select: { taxId: true }
      });
      const existingTaxIds = new Set(existing.map(e => e.taxId));

      const toCreate = data.filter(d => !existingTaxIds.has(d.taxId));
      const rowsSkippedExisting = data.filter(d => existingTaxIds.has(d.taxId)).length;

      if (toCreate.length > 0) {
        await prisma.customer.createMany({
          data: toCreate.map(d => ({
            companyName: d.companyName,
            tradeName: d.tradeName || null,
            taxId: d.taxId,
            stateTaxId: d.stateTaxId || null,
            contactName: d.contactName || null,
            email: d.email || null,
            phone: d.phone || null,
            address: d.address || null,
            city: d.city || null,
            state: d.state || null,
            zipCode: d.zipCode || null,
            segment: d.segment || null,
            notes: d.notes || null,
            status: "ACTIVE"
          }))
        });
      }

      res.json({
        success: true,
        count: toCreate.length,
        skipped: rowsSkippedExisting,
        summary: {
          rowsProcessed: data.length,
          rowsImported: toCreate.length,
          rowsSkippedExisting,
          rowsFailed: 0
        }
      });
    } catch (error) {
      console.error("Import confirm error:", error);
      res.status(500).json({ error: "Erro ao salvar dados no banco" });
    }
  });

  app.get("/api/customers", async (req, res) => {
    const customers = await prisma.customer.findMany({
      orderBy: { companyName: "asc" },
    });
    res.json(customers);
  });

  /** Visão comercial 360°: cliente + propostas com itens e produto (sem pedido faturado separado no schema). */
  app.get("/api/customers/:id/commercial-360", async (req, res) => {
    const { id } = req.params;
    try {
      const customer = await prisma.customer.findUnique({ where: { id } });
      if (!customer) return res.status(404).json({ error: "Cliente não encontrado" });
      const proposals = await prisma.proposal.findMany({
        where: { customerId: id },
        include: {
          items: {
            include: {
              Product: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  type: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const approvedByCustomer = await prisma.proposal.groupBy({
        by: ["customerId"],
        where: { status: "APPROVED" },
        _sum: { totalNetValue: true },
      });
      const abcRows = approvedByCustomer.map((g) => ({
        customerId: g.customerId,
        revenue: Number(g._sum.totalNetValue ?? 0),
      }));
      const portfolioAbc = buildPortfolioAbcForCustomer(abcRows, id);

      res.json({ customer, proposals, portfolioAbc });
    } catch (error) {
      console.error("commercial-360 error:", error);
      res.status(500).json({ error: "Erro ao montar visão comercial do cliente." });
    }
  });

  app.post("/api/customers", async (req, res) => {
    const customer = await prisma.customer.create({ data: req.body });
    res.json(customer);
  });

  app.put("/api/customers/:id", async (req, res) => {
    const { id } = req.params;
    const customer = await prisma.customer.update({
      where: { id },
      data: req.body,
    });
    res.json(customer);
  });

  app.delete("/api/customers/:id", async (req, res) => {
    const { id } = req.params;
    await prisma.customer.delete({ where: { id } });
    res.json({ success: true });
  });

  // --- API: Proposals (Propostas Comerciais) ---
  app.get("/api/proposals", async (req, res) => {
    const proposals = await prisma.proposal.findMany({
      include: { Customer: true },
      orderBy: { number: "desc" },
    });
    res.json(proposals);
  });

  app.get("/api/proposals/:id", async (req, res) => {
    const { id } = req.params;
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: { 
        Customer: true,
        items: { include: { Product: true } }
      },
    });
    res.json(proposal);
  });

  app.post("/api/proposals", async (req, res) => {
    const { items, ...proposalData } = req.body;
    const proposal = await prisma.proposal.create({
      data: {
        ...proposalData,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            unit: item.unit,
            unitCost: item.unitCost,
            suggestedPrice: item.suggestedPrice,
            negotiatedPrice: item.negotiatedPrice,
            discountPerc: item.discountPerc,
            discountValue: item.discountValue,
            marginValue: item.marginValue,
            marginPerc: item.marginPerc,
            taxesPerc: item.taxesPerc,
            taxesValue: item.taxesValue,
            commissionPerc: item.commissionPerc,
            commissionValue: item.commissionValue,
            freightValue: item.freightValue,
            notes: item.notes,
          }))
        }
      },
      include: { items: true }
    });
    res.json(proposal);
  });

  app.put("/api/proposals/:id", async (req, res) => {
    const { id } = req.params;
    const { items, ...proposalData } = req.body;

    const proposal = await prisma.$transaction(async (tx) => {
      await tx.proposalItem.deleteMany({ where: { proposalId: id } });
      return await tx.proposal.update({
        where: { id },
        data: {
          ...proposalData,
          items: {
            create: items.map((item: any) => ({
              productId: item.productId,
              quantity: item.quantity,
              unit: item.unit,
              unitCost: item.unitCost,
              suggestedPrice: item.suggestedPrice,
              negotiatedPrice: item.negotiatedPrice,
              discountPerc: item.discountPerc,
              discountValue: item.discountValue,
              marginValue: item.marginValue,
              marginPerc: item.marginPerc,
              taxesPerc: item.taxesPerc,
              taxesValue: item.taxesValue,
              commissionPerc: item.commissionPerc,
              commissionValue: item.commissionValue,
              freightValue: item.freightValue,
              notes: item.notes,
            }))
          }
        },
        include: { items: true }
      });
    });
    res.json(proposal);
  });

  app.patch("/api/proposals/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const proposal = await prisma.proposal.update({
      where: { id },
      data: { status },
    });
    res.json(proposal);
  });

  app.delete("/api/proposals/:id", async (req, res) => {
    const { id } = req.params;
    await prisma.proposal.delete({ where: { id } });
    res.json({ success: true });
  });

  // Global Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Express Error:", err);
    res.status(500).json({ 
      error: err.message || "Internal Server Error",
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(port), host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });
}

startServer();