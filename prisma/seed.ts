import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log("Iniciando seed...");

  // 1. Criar Cargos
  const roleOperador = await prisma.role.upsert({
    where: { name: "Operador de Torno" },
    update: {},
    create: {
      name: "Operador de Torno",
      baseSalary: 2800,
      monthlyHours: 220,
    },
  });

  const roleSoldador = await prisma.role.upsert({
    where: { name: "Soldador Industrial" },
    update: {},
    create: {
      name: "Soldador Industrial",
      baseSalary: 3500,
      monthlyHours: 220,
    },
  });

  const roleSupervisor = await prisma.role.upsert({
    where: { name: "Supervisor de Produção" },
    update: {},
    create: {
      name: "Supervisor de Produção",
      baseSalary: 5500,
      monthlyHours: 200,
    },
  });

  // 2. Criar Componentes de Folha
  const compFGTS = await prisma.payrollComponent.upsert({
    where: { name: "FGTS" },
    update: {},
    create: { name: "FGTS", type: "CHARGE", calculationType: "PERCENTAGE", value: 8 },
  });

  const compINSS = await prisma.payrollComponent.upsert({
    where: { name: "INSS Patronal" },
    update: {},
    create: { name: "INSS Patronal", type: "CHARGE", calculationType: "PERCENTAGE", value: 20 },
  });

  const compFerias = await prisma.payrollComponent.upsert({
    where: { name: "Provisão Férias + 1/3" },
    update: {},
    create: { name: "Provisão Férias + 1/3", type: "PROVISION", calculationType: "PERCENTAGE", value: 11.11 },
  });

  const comp13 = await prisma.payrollComponent.upsert({
    where: { name: "Provisão 13º Salário" },
    update: {},
    create: { name: "Provisão 13º Salário", type: "PROVISION", calculationType: "PERCENTAGE", value: 8.33 },
  });

  const compVT = await prisma.payrollComponent.upsert({
    where: { name: "Vale Transporte" },
    update: {},
    create: { name: "Vale Transporte", type: "BENEFIT", calculationType: "FIXED", value: 220 },
  });

  const compRefeicao = await prisma.payrollComponent.upsert({
    where: { name: "Vale Refeição" },
    update: {},
    create: { name: "Vale Refeição", type: "BENEFIT", calculationType: "FIXED", value: 550 },
  });

  // 3. Limpar funcionários antigos para evitar duplicidade no seed
  await prisma.employeePayrollComponent.deleteMany({});
  await prisma.employee.deleteMany({});

  // 4. Criar Funcionários com Componentes
  const employeesData = [
    {
      name: "João Silva",
      roleId: roleOperador.id,
      department: "Usinagem",
      costCenter: "CC-001",
      classification: "DIRETO",
      salary: 2800,
      monthlyHours: 220,
      productivity: 100,
    },
    {
      name: "Maria Oliveira",
      roleId: roleSoldador.id,
      department: "Soldagem",
      costCenter: "CC-002",
      classification: "DIRETO",
      salary: 3650,
      monthlyHours: 220,
      productivity: 95,
    },
    {
      name: "Carlos Souza",
      roleId: roleSupervisor.id,
      department: "Fábrica",
      costCenter: "CC-000",
      classification: "INDIRETO",
      salary: 5500,
      monthlyHours: 200,
      productivity: 100,
    },
  ];

  for (const emp of employeesData) {
    await prisma.employee.create({
      data: {
        ...emp,
        EmployeePayrollComponent: {
          create: [
            { payrollComponentId: compFGTS.id },
            { payrollComponentId: compINSS.id },
            { payrollComponentId: compFerias.id },
            { payrollComponentId: comp13.id },
            { payrollComponentId: compVT.id },
            { payrollComponentId: compRefeicao.id },
          ]
        }
      }
    });
  }

  // 5. Criar Materiais
  const materialsData = [
    {
      code: "MP-001",
      description: "Aço Carbono 1020 - Barra 1/2\"",
      unit: "KG",
      category: "MATERIA_PRIMA",
      supplier: "Gerdau S.A.",
      currentCost: 12.50,
      averageCost: 11.80,
      standardCost: 12.00,
      freight: 0.45,
      standardLoss: 5.0,
      conversionFactor: 1,
    },
    {
      code: "MP-002",
      description: "Polímero PP Virgem - Natural",
      unit: "KG",
      category: "MATERIA_PRIMA",
      supplier: "Braskem",
      currentCost: 8.90,
      averageCost: 9.10,
      standardCost: 8.50,
      freight: 0.30,
      standardLoss: 2.5,
      conversionFactor: 1,
    },
    {
      code: "INS-001",
      description: "Eletrodo Revestido 6013 3.25mm",
      unit: "KG",
      category: "INSUMO",
      supplier: "ESAB",
      currentCost: 24.00,
      averageCost: 23.50,
      standardCost: 22.00,
      freight: 1.20,
      standardLoss: 15.0,
      conversionFactor: 1,
    },
    {
      code: "EMB-001",
      description: "Caixa de Papelão 40x40x40",
      unit: "UN",
      category: "EMBALAGEM",
      supplier: "Klabin",
      currentCost: 3.20,
      averageCost: 3.15,
      standardCost: 3.00,
      freight: 0.15,
      standardLoss: 0.5,
      conversionFactor: 1,
    },
  ];

  for (const mat of materialsData) {
    await prisma.material.upsert({
      where: { code: mat.code },
      update: mat,
      create: {
        ...mat,
        MaterialPriceHistory: {
          create: [
            { price: mat.currentCost * 0.9, freight: mat.freight, effectiveDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            { price: mat.currentCost, freight: mat.freight },
          ]
        }
      }
    });
  }

  // 6. Criar Produto Completo (Engenharia)
  const productData = {
    sku: "PRD-001",
    name: "Eixo de Transmissão Industrial X1",
    description: "Eixo usinado em aço carbono com acabamento retificado e montagem de rolamentos.",
    version: "1.0.0",
    defaultLotSize: 10,
  };

  const product = await prisma.product.upsert({
    where: { sku: productData.sku },
    update: productData,
    create: productData,
  });

  // Buscar IDs necessários para o produto
  const aco = await prisma.material.findUnique({ where: { code: "MP-001" } });
  const eletrodo = await prisma.material.findUnique({ where: { code: "INS-001" } });
  const caixa = await prisma.material.findUnique({ where: { code: "EMB-001" } });
  
  const torno = await prisma.machine.findUnique({ where: { code: "MAC-001" } });
  const operario = await prisma.role.findFirst({ where: { name: "Operador de Torno" } });

  if (aco && torno && operario) {
    // BOM
    await prisma.productBOM.deleteMany({ where: { productId: product.id } });
    await prisma.productBOM.createMany({
      data: [
        { productId: product.id, materialId: aco.id, quantity: 2.5, lossPercentage: 10, notes: "Bruto para usinagem" },
        { productId: product.id, materialId: eletrodo.id, quantity: 0.1, lossPercentage: 20, notes: "Solda de reforço" },
        { productId: product.id, materialId: caixa.id, quantity: 1, lossPercentage: 0, notes: "Embalagem individual" },
      ]
    });

    // Routing
    await prisma.productRouting.deleteMany({ where: { productId: product.id } });
    await prisma.productRouting.createMany({
      data: [
        { 
          productId: product.id, 
          sequence: 10, 
          description: "Torneamento de Desbaste", 
          machineId: torno.id, 
          roleId: operario.id, 
          setupTimeMin: 30, 
          operationTimeMin: 15, 
          efficiencyExpected: 90,
          notes: "Velocidade de corte reduzida para acabamento"
        },
        { 
          productId: product.id, 
          sequence: 20, 
          description: "Retífica de Precisão", 
          machineId: torno.id, 
          roleId: operario.id, 
          setupTimeMin: 15, 
          operationTimeMin: 10, 
          efficiencyExpected: 95,
          notes: "Tolerância H7"
        },
      ]
    });
  }

  // 7. Criar Custos Indiretos e OPEX
  const indirectCostsData = [
    {
      description: "Energia Elétrica - Fábrica",
      category: "CIF",
      monthlyValue: 15000.00,
      costCenter: "PRODUCAO",
      allocationCriteria: "HM_TOTAL",
    },
    {
      description: "Aluguel Galpão Industrial",
      category: "CIF",
      monthlyValue: 25000.00,
      costCenter: "PRODUCAO",
      allocationCriteria: "FIXED",
    },
    {
      description: "Manutenção Predial",
      category: "CIF",
      monthlyValue: 4500.00,
      costCenter: "MANUTENCAO",
      allocationCriteria: "HH_TOTAL",
    },
    {
      description: "Salários Administrativos",
      category: "ADMINISTRATIVO",
      monthlyValue: 35000.00,
      costCenter: "ADM",
      allocationCriteria: "FIXED",
    },
    {
      description: "Marketing e Vendas",
      category: "COMERCIAL",
      monthlyValue: 12000.00,
      costCenter: "VENDAS",
      allocationCriteria: "FIXED",
    },
    {
      description: "Software ERP",
      category: "OPEX_GERAL",
      monthlyValue: 2800.00,
      costCenter: "TI",
      allocationCriteria: "FIXED",
    },
  ];

  for (const cost of indirectCostsData) {
    await prisma.indirectCost.create({ data: cost });
  }

  // 8. Criar Regras Tributárias
  const taxRulesData = [
    {
      name: "Venda Interna SP (Indústria)",
      operation: "VENDA",
      TaxComponent: {
        create: [
          { name: "ICMS SP", percentage: 18.00, baseType: "GROSS_PRICE" },
          { name: "PIS", percentage: 1.65, baseType: "GROSS_PRICE" },
          { name: "COFINS", percentage: 7.60, baseType: "GROSS_PRICE" },
          { name: "IPI", percentage: 5.00, baseType: "GROSS_PRICE" },
        ]
      }
    },
    {
      name: "Venda Interestadual (Sul/Sudeste)",
      operation: "VENDA",
      TaxComponent: {
        create: [
          { name: "ICMS Inter", percentage: 12.00, baseType: "GROSS_PRICE" },
          { name: "PIS", percentage: 1.65, baseType: "GROSS_PRICE" },
          { name: "COFINS", percentage: 7.60, baseType: "GROSS_PRICE" },
        ]
      }
    },
    {
      name: "Exportação",
      operation: "VENDA",
      TaxComponent: {
        create: [
          { name: "ICMS Exp", percentage: 0.00, baseType: "GROSS_PRICE" },
          { name: "PIS Exp", percentage: 0.00, baseType: "GROSS_PRICE" },
          { name: "COFINS Exp", percentage: 0.00, baseType: "GROSS_PRICE" },
        ]
      }
    }
  ];

  for (const rule of taxRulesData) {
    await prisma.taxRule.upsert({
      where: { name: rule.name },
      update: {},
      create: rule,
    });
  }

  // 9. Criar Premissas de Preço
  const product001 = await prisma.product.findUnique({ where: { sku: "PRD-001" } });
  const taxSP = await prisma.taxRule.findUnique({ where: { name: "Venda Interna SP (Indústria)" } });
  const taxInter = await prisma.taxRule.findUnique({ where: { name: "Venda Interestadual (Sul/Sudeste)" } });

  if (product001 && taxSP && taxInter) {
    const pricings = [
      {
        productId: product001.id,
        taxRuleId: taxSP.id,
        desiredMargin: 18.00,
        commission: 5.00,
        freightOut: 12.50,
        otherVariables: 1.50,
      },
      {
        productId: product001.id,
        taxRuleId: taxInter.id,
        desiredMargin: 15.00,
        commission: 7.00,
        freightOut: 45.00,
        otherVariables: 1.50,
      }
    ];

    for (const p of pricings) {
      await prisma.productPricing.upsert({
        where: { productId_taxRuleId: { productId: p.productId, taxRuleId: p.taxRuleId } },
        update: {},
        create: p,
      });
    }
  }

  // 10. Criar Simulação de Exemplo
  if (product001 && taxSP) {
    await prisma.simulation.create({
      data: {
        name: "Cenário: Alta de 15% no Aço + Dissídio 5%",
        description: "Simulação de estresse para repasse de preços no próximo trimestre.",
        productId: product001.id,
        taxRuleId: taxSP.id,
        materialAdj: 15.0,
        laborAdj: 5.0,
        efficiencyAdj: 2.0, // Ganho de eficiência compensatório
        marginAdj: 0.0,
      }
    });
  }

  console.log("Seed finalizado com sucesso!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
