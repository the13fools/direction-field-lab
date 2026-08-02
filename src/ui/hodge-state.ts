import type { HodgeFields, HodgeMetrics } from "../solver/messages";

export const DEFAULT_HODGE_FIELD: keyof HodgeFields = "input";

export interface FormattedHodgeMetrics {
  curl: string;
  divergence: string;
  orthogonality: string;
  reconstruction: string;
}

export function formatHodgeMetrics(
  value: HodgeMetrics | undefined,
  decomposed: boolean,
): FormattedHodgeMetrics {
  if (!value || !decomposed) {
    return {
      curl: "not computed",
      divergence: "not computed",
      orthogonality: "not computed",
      reconstruction: value ? value.reconstructionNorm.toExponential(2) : "—",
    };
  }
  return {
    curl: value.harmonicCurlMax.toExponential(2),
    divergence: value.harmonicDivergenceMax.toExponential(2),
    orthogonality: value.orthogonalityDefect.toExponential(2),
    reconstruction: value.reconstructionNorm.toExponential(2),
  };
}
