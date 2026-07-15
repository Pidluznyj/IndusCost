/**
 * Diagnóstico de duplicidade de e-mail corporativo (Employee) e conflitos com AppUser / Person.
 * Somente leitura — não aplica migration nem constraint.
 *
 * Uso:
 *   npx tsx scripts/diagnoseEmployeeCorporateEmailDuplicates.ts
 */

import { PrismaClient } from "@prisma/client";

type GroupRow = { key: string; count: number; ids: string[]; samples: string[] };

async function main() {
  const prisma = new PrismaClient();
  try {
    const employees = await prisma.employee.findMany({
      where: { corporateEmail: { not: null } },
      select: { id: true, name: true, corporateEmail: true, status: true },
      orderBy: { name: "asc" },
    });

    const byLower = new Map<string, typeof employees>();
    for (const e of employees) {
      const key = (e.corporateEmail ?? "").trim().toLowerCase();
      if (!key) continue;
      const list = byLower.get(key) ?? [];
      list.push(e);
      byLower.set(key, list);
    }

    const employeeDups: GroupRow[] = [];
    for (const [key, list] of byLower) {
      if (list.length > 1) {
        employeeDups.push({
          key,
          count: list.length,
          ids: list.map((x) => x.id),
          samples: list.map((x) => `${x.name} (${x.status ?? "?"})`),
        });
      }
    }

    const appUsers = await prisma.appUser.findMany({
      select: { id: true, email: true, employeeId: true, name: true },
    });
    const appByLower = new Map(appUsers.map((u) => [u.email.trim().toLowerCase(), u]));

    const collisionsWithAppUser: Array<{
      email: string;
      employeeId: string;
      employeeName: string;
      appUserId: string;
      appUserEmployeeId: string | null;
      kind: "same_employee" | "free_user" | "other_employee";
    }> = [];

    for (const e of employees) {
      const key = (e.corporateEmail ?? "").trim().toLowerCase();
      const u = appByLower.get(key);
      if (!u) continue;
      const kind =
        u.employeeId === e.id
          ? "same_employee"
          : u.employeeId
            ? "other_employee"
            : "free_user";
      collisionsWithAppUser.push({
        email: key,
        employeeId: e.id,
        employeeName: e.name,
        appUserId: u.id,
        appUserEmployeeId: u.employeeId,
        kind,
      });
    }

    const people = await prisma.person.findMany({
      where: { corporateEmail: { not: null } },
      select: { id: true, displayName: true, corporateEmail: true },
    });
    const personByLower = new Map<string, typeof people>();
    for (const p of people) {
      const key = (p.corporateEmail ?? "").trim().toLowerCase();
      if (!key) continue;
      const list = personByLower.get(key) ?? [];
      list.push(p);
      personByLower.set(key, list);
    }
    const personDups: GroupRow[] = [];
    for (const [key, list] of personByLower) {
      if (list.length > 1) {
        personDups.push({
          key,
          count: list.length,
          ids: list.map((x) => x.id),
          samples: list.map((x) => x.displayName),
        });
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      employeeCorporateEmailFilled: employees.length,
      employeeDuplicatesCi: employeeDups,
      personCorporateEmailDuplicatesCi: personDups,
      employeeVsAppUser: {
        same_employee: collisionsWithAppUser.filter((c) => c.kind === "same_employee").length,
        free_user: collisionsWithAppUser.filter((c) => c.kind === "free_user").length,
        other_employee: collisionsWithAppUser.filter((c) => c.kind === "other_employee"),
      },
      notes: [
        "Índice Employee_corporateEmail_lower_uidx já é unique parcial (NULL permitido).",
        "Person.corporateEmail NÃO tem UNIQUE no banco (hábitos históricos).",
        "Não execute constraint adicional em produção até zerar employeeDuplicatesCi.",
        "AppUser.email não é reescrito ao salvar Employee.",
      ],
    };

    console.log(JSON.stringify(report, null, 2));
    if (employeeDups.length > 0) {
      console.error(
        `\n[diagnose] ${employeeDups.length} grupo(s) duplicado(s) em Employee.corporateEmail — resolva antes de reforçar constraints.`
      );
      process.exitCode = 2;
    } else {
      console.error("\n[diagnose] Nenhuma duplicidade CI em Employee.corporateEmail.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
