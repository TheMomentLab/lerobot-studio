export type CalibrationListFile = {
  id: string;
  guessed_type?: string;
  rel_path?: string;
  modified?: string;
  size?: number;
};

export type CalibrationListEntry = CalibrationListFile & {
  raw_ids?: string[];
  shared_profile?: boolean;
};

const BI_SUFFIX_RE = /_(left|right)$/i;

export function isBiCalibrationFile(file: CalibrationListFile): boolean {
  const relPath = typeof file.rel_path === "string" ? file.rel_path : "";
  const guessedType = typeof file.guessed_type === "string" ? file.guessed_type : "";
  return guessedType.startsWith("bi_") || relPath.includes("/bi_") || relPath.startsWith("robots/bi_") || relPath.startsWith("teleoperators/bi_");
}

export function toBiSharedProfileId(id: string): string {
  return (id || "").trim().replace(BI_SUFFIX_RE, "");
}

export function deriveBiSharedSelection(leftValue: unknown, rightValue: unknown): string {
  const left = typeof leftValue === "string" ? leftValue.trim() : "";
  const right = typeof rightValue === "string" ? rightValue.trim() : "";
  if (left.endsWith("_left")) return left.slice(0, -"_left".length);
  if (right.endsWith("_right")) return right.slice(0, -"_right".length);
  return toBiSharedProfileId(left || right);
}

export function buildCalibrationProfileOptions(
  files: CalibrationListFile[],
  kind: "follower" | "leader",
  bimanual: boolean,
): string[] {
  const ids = new Set<string>();
  for (const file of files) {
    const guessedType = file.guessed_type ?? "";
    if (!guessedType.includes(kind) || isBiCalibrationFile(file) !== bimanual) {
      continue;
    }
    const nextId = bimanual ? toBiSharedProfileId(file.id) : file.id;
    if (nextId) {
      ids.add(nextId);
    }
  }
  return Array.from(ids);
}

export function buildCalibrationListEntries(
  files: CalibrationListFile[],
  scope: "Single" | "Bi",
): CalibrationListEntry[] {
  const filtered = files.filter((file) => (scope === "Bi" ? isBiCalibrationFile(file) : !isBiCalibrationFile(file)));
  if (scope === "Single") {
    return filtered;
  }

  const entries: CalibrationListEntry[] = [];
  const seen = new Set<string>();
  for (const file of filtered) {
    const sharedId = toBiSharedProfileId(file.id);
    const guessedType = file.guessed_type ?? "";
    const key = `${guessedType}:${sharedId}`;
    if (!sharedId || seen.has(key)) {
      continue;
    }
    const group = filtered.filter(
      (candidate) => (candidate.guessed_type ?? "") === guessedType && toBiSharedProfileId(candidate.id) === sharedId,
    );
    entries.push({
      ...file,
      id: sharedId,
      raw_ids: group.map((candidate) => candidate.id),
      shared_profile: true,
      size: group.reduce((total, candidate) => total + (candidate.size ?? 0), 0),
    });
    seen.add(key);
  }
  return entries;
}
