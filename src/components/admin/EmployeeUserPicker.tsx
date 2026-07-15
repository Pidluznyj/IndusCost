import React, { useMemo } from "react";
import {
  SearchableSelect,
  type SelectOption,
} from "@/src/components/shared/SearchableSelect";
import type { EligibleEmployeeForUserDto } from "@/src/lib/adminUserEmployeeLink";

type EmployeeUserPickerProps = {
  employees: EligibleEmployeeForUserDto[];
  value: string;
  onChange: (employeeId: string, employee: EligibleEmployeeForUserDto | null) => void;
  loading?: boolean;
  disabled?: boolean;
};

export const EmployeeUserPicker: React.FC<EmployeeUserPickerProps> = ({
  employees,
  value,
  onChange,
  loading = false,
  disabled = false,
}) => {
  const options = useMemo((): SelectOption[] => {
    return employees.map((emp) => ({
      value: emp.id,
      label: emp.displayName,
      sublabel: [emp.department, emp.personalEmail].filter(Boolean).join(" · ") || "Sem e-mail no RH",
      searchTerms: emp.searchText,
    }));
  }, [employees]);

  return (
    <div className="space-y-1" data-testid="employee-user-picker">
      <label className="text-[11px] font-semibold text-muted-foreground">
        Pessoa / RH <span className="text-destructive">*</span>
      </label>
      <SearchableSelect
        value={value}
        onChange={(nextId) => {
          const emp = employees.find((row) => row.id === nextId) ?? null;
          onChange(nextId, emp);
        }}
        options={options}
        placeholder={loading ? "Carregando pessoas…" : "Selecione uma pessoa ativa…"}
        searchInputPlaceholder="Buscar por nome, departamento ou e-mail…"
        emptyMessage="Nenhuma pessoa elegível. Cadastre em Pessoas / RH ou confira se já tem usuário."
        disabled={disabled || loading}
      />
      <p className="text-[11px] text-muted-foreground">
        Só pessoas ativas sem usuário de acesso entram nesta lista.
      </p>
    </div>
  );
};
