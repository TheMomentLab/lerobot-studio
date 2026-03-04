export function parseDatasetId(id: string): { user: string; repo: string } | null {
  const [user, repo] = id.split("/");
  if (!user || !repo) return null;
  return { user, repo };
}

export function formatMetric(value: number | null | undefined, unit: string): string {
  return Number.isFinite(value) ? `${value} ${unit}` : "—";
}
