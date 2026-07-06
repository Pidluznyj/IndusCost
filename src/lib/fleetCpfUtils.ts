/** Utilitários de CPF para cadastro/identificação pública de frota. */

export function normalizeCpfDigits(cpf: string): string {
  return cpf.replace(/\D/g, "").slice(0, 11);
}

export function formatCpfMask(value: string): string {
  const digits = normalizeCpfDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function isValidCpf(cpf: string): boolean {
  const digits = normalizeCpfDigits(cpf);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calcCheck = (base: string, factor: number): number => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += parseInt(base[i]!, 10) * (factor - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calcCheck(digits.slice(0, 9), 10);
  const d2 = calcCheck(digits.slice(0, 10), 11);
  return d1 === parseInt(digits[9]!, 10) && d2 === parseInt(digits[10]!, 10);
}

export function maskCpfForDisplay(cpf: string): string {
  const digits = normalizeCpfDigits(cpf);
  if (digits.length !== 11) return "***";
  return `***.***.***-${digits.slice(9)}`;
}
