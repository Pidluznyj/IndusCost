import React from "react";

export function PrintTable({
  className = "",
  colGroup,
  children,
}: {
  className?: string;
  colGroup?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <table className={`print-table ${className}`.trim()}>
      {colGroup}
      {children}
    </table>
  );
}
