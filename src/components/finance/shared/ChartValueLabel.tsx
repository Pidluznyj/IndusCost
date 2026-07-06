import React from "react";
import type { LabelProps } from "recharts";
import {
  buildChartBarLabelProps,
  buildChartLineLabelProps,
} from "@/src/lib/chartValueLabels";

export function ChartBarValueLabel(
  props: LabelProps & { fontSize?: number }
) {
  const built = buildChartBarLabelProps({
    x: props.x as number,
    y: props.y as number,
    width: props.width as number,
    value: props.value as number,
  });
  if (!built) return null;
  return (
    <text
      x={built.x}
      y={built.y}
      fill={built.fill}
      fontSize={props.fontSize ?? 9}
      fontWeight={600}
      textAnchor="middle"
    >
      {built.text}
    </text>
  );
}

export function ChartLineValueLabel(
  props: LabelProps & { fontSize?: number }
) {
  const built = buildChartLineLabelProps({
    x: props.x as number,
    y: props.y as number,
    value: props.value as number,
  });
  if (!built) return null;
  return (
    <text
      x={built.x}
      y={built.y}
      fill="#1E3A5F"
      fontSize={props.fontSize ?? 8}
      fontWeight={600}
      textAnchor="middle"
    >
      {built.text}
    </text>
  );
}
