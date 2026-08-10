import type { TrailSummaryDto } from "../../types/api";

export interface DifficultySummary {
  byLabel: Record<string, number>;
  commonTags: [string, string][];
}

export const EMPTY_DIFFICULTY_SUMMARY: DifficultySummary = {
  byLabel: {},
  commonTags: [],
};

export const DIFFICULTY_LEGEND = [
  { label: "?", color: "#6b7280" },
  { label: "<T1", color: "#6b7280" },
  { label: "T1", color: "#6b7280" },
  { label: "T2", color: "#6b7280" },
  { label: "T3", color: "#05070a" },
  { label: "T4", color: "#6b7280" },
  { label: "T5", color: "#05070a" },
  { label: "T6", color: "#05070a" },
];

export const SUPPLEMENT_LEGEND = [
  { label: "T3 auf rot", color: "#05070a" },
  { label: "T5/T6 auf blau", color: "#05070a" },
];

const SAC_SCALE_BY_OSM_VALUE: Record<string, { label: string }> = {
  strolling: { label: "<T1" },
  hiking: { label: "T1" },
  mountain_hiking: { label: "T2" },
  demanding_mountain_hiking: { label: "T3" },
  alpine_hiking: { label: "T4" },
  demanding_alpine_hiking: { label: "T5" },
  difficult_alpine_hiking: { label: "T6" },
};

export function formatSacScale(value: string | null | undefined): string {
  if (!value) {
    return "?";
  }
  return SAC_SCALE_BY_OSM_VALUE[value]?.label ?? value;
}

export function formatOfficialCategory(category: string | null): string {
  if (category === "hiking_trail") {
    return "Wanderweg";
  }
  if (category === "mountain_hiking_trail") {
    return "Bergwanderweg";
  }
  if (category === "alpine_hiking_trail") {
    return "Alpinwanderweg";
  }
  return "Unbekannt";
}

export function formatMatchQuality(score: number): string {
  if (score >= 0.9) {
    return "high";
  }
  if (score >= 0.78) {
    return "medium";
  }
  return "low";
}

export function toDifficultySummary(
  summary: TrailSummaryDto,
): DifficultySummary {
  return {
    byLabel: summary.byLabel,
    commonTags: summary.commonTags.map((tag) => [tag.key, tag.value]),
  };
}
