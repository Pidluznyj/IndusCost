/**
 * Auditoria READ-ONLY do `companyCode` das contas financeiras da Tesouraria.
 *
 *   npm run audit:treasury-company-code
 *   npm run audit:treasury-company-code -- --json
 *
 * Não escreve nada. Existe porque a coluna é `TEXT NOT NULL`, então o único
 * estado inválido possível é string vazia ou só espaços — que o filtro do
 * banco (`not: ""`) não pega por completo e os serviços tratam com `.trim()`.
 * Este comando mostra se esse estado existe de fato, e se há duplicidade de
 * código entre contas ativas.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const asJson = hasFlag("--json");
  const prisma = new PrismaClient();

  try {
    const accounts = await prisma.treasuryFinancialAccount.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        companyCode: true,
        isActive: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    const active = accounts.filter((a) => a.isActive);
    const emptyCode = accounts.filter((a) => a.companyCode === "");
    const whitespaceOnly = accounts.filter(
      (a) => a.companyCode !== "" && a.companyCode.trim() === ""
    );
    const activeUnusable = active.filter((a) => a.companyCode.trim() === "");

    const byCode = new Map<string, string[]>();
    for (const a of active) {
      const key = a.companyCode.trim();
      if (key === "") continue;
      byCode.set(key, [...(byCode.get(key) ?? []), `${a.code} — ${a.name}`]);
    }
    const duplicated = [...byCode.entries()].filter(([, list]) => list.length > 1);

    const report = {
      columnIsNotNull: true, // schema: String (TEXT NOT NULL na migration)
      totalAccounts: accounts.length,
      activeAccounts: active.length,
      emptyCompanyCode: emptyCode.length,
      whitespaceOnlyCompanyCode: whitespaceOnly.length,
      activeWithoutUsableCompanyCode: activeUnusable.length,
      duplicatedCompanyCodeAmongActive: duplicated.length,
      details: {
        activeWithoutUsableCompanyCode: activeUnusable.map((a) => ({
          code: a.code,
          name: a.name,
        })),
        duplicated: duplicated.map(([code, accountsList]) => ({
          companyCode: code,
          accounts: accountsList,
        })),
      },
    };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("\n[audit:treasury-company-code] somente leitura\n");
      console.log(`  contas ................................ ${report.totalAccounts}`);
      console.log(`  ativas ................................ ${report.activeAccounts}`);
      console.log(`  companyCode vazio ("") ................ ${report.emptyCompanyCode}`);
      console.log(`  companyCode só com espaços ............ ${report.whitespaceOnlyCompanyCode}`);
      console.log(`  ATIVAS sem código utilizável .......... ${report.activeWithoutUsableCompanyCode}`);
      console.log(`  código duplicado entre ativas ......... ${report.duplicatedCompanyCodeAmongActive}`);

      if (activeUnusable.length > 0) {
        console.log("\n  contas ativas sem código utilizável:");
        for (const a of activeUnusable) console.log(`    - ${a.code} — ${a.name}`);
        console.log(
          "    (essas contas ficam fora das telas que exigem empresa)"
        );
      }
      if (duplicated.length > 0) {
        console.log("\n  códigos duplicados entre contas ativas:");
        for (const [code, list] of duplicated) {
          console.log(`    - ${code}: ${list.join(" | ")}`);
        }
        console.log(
          "    (a resolução de empresa pega a primeira por sortOrder/name)"
        );
      }
      console.log("\n  Nenhum dado foi alterado.\n");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[audit:treasury-company-code] falhou:", err);
  process.exitCode = 1;
});
