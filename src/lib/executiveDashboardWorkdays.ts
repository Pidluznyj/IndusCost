/** Dias úteis (seg–sex) para métricas gerenciais — sem feriados nesta fase. */

export function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

export function countWorkdaysInRange(start: Date, end: Date): number {
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= endDay) {
    if (isWeekday(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

export function endOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

export function countWorkdaysElapsedInMonth(now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return countWorkdaysInRange(start, end);
}

export function countWorkdaysElapsedInYear(now: Date): number {
  const start = startOfYear(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return countWorkdaysInRange(start, end);
}

export function countWorkdaysInMonth(year: number, monthIndex: number): number {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return countWorkdaysInRange(start, end);
}

export function countWorkdaysInYear(year: number): number {
  return countWorkdaysInRange(startOfYear(new Date(year, 0, 1)), endOfYear(new Date(year, 0, 1)));
}
