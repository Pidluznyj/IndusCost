// Liga/desliga o usuário líder de teste (fictício) num banco LOCAL. Usado pela parte 8 do roteiro.
import { PrismaClient } from "@prisma/client";
const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw new Error("recusado: DATABASE_URL não é local");
const prisma = new PrismaClient();
await prisma.appUser.update({ where: { email: "lider.teste@induscost.test" }, data: { isActive: process.argv[2] === "true", permissionsVersion: { increment: 1 } } });
await prisma.$disconnect();
