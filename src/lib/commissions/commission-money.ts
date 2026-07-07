import { Prisma } from "@prisma/client";
import { roundMoney } from "./commission-money.shared.js";

export * from "./commission-money.shared.js";

/** Converte Decimal Prisma ou número para number finito. */
export function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && "toNumber" in value) {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function toPrismaDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(roundMoney(value));
}
