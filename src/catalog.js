const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.json$/u;

export class PuzzleCatalogError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "PuzzleCatalogError";
    this.code = code;
    this.path = path;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRealDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function assertKeys(value, allowed, path) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new PuzzleCatalogError("UNKNOWN_CATALOG_KEY", `${path}.${unknown}`, "Unknown catalog field.");
}

export function validatePuzzleCatalog(catalog) {
  if (!isRecord(catalog)) throw new PuzzleCatalogError("INVALID_CATALOG", "$", "Puzzle catalog must be an object.");
  assertKeys(catalog, ["schemaVersion", "defaultDate", "puzzles"], "$");
  if (catalog.schemaVersion !== 1) {
    throw new PuzzleCatalogError("UNSUPPORTED_CATALOG_SCHEMA", "$.schemaVersion", "Catalog schemaVersion must be 1.");
  }
  if (!isRealDate(catalog.defaultDate)) {
    throw new PuzzleCatalogError("INVALID_DEFAULT_DATE", "$.defaultDate", "Catalog defaultDate must be a real YYYY-MM-DD date.");
  }
  if (!Array.isArray(catalog.puzzles) || catalog.puzzles.length === 0) {
    throw new PuzzleCatalogError("EMPTY_CATALOG", "$.puzzles", "Puzzle catalog must contain at least one entry.");
  }

  const seenDates = new Set();
  const entries = catalog.puzzles.map((entry, index) => {
    const path = `$.puzzles[${index}]`;
    if (!isRecord(entry)) throw new PuzzleCatalogError("INVALID_CATALOG_ENTRY", path, "Catalog entry must be an object.");
    assertKeys(entry, ["date", "file"], path);
    if (!isRealDate(entry.date)) {
      throw new PuzzleCatalogError("INVALID_CATALOG_DATE", `${path}.date`, "Entry date must be a real YYYY-MM-DD date.");
    }
    if (seenDates.has(entry.date)) {
      throw new PuzzleCatalogError("DUPLICATE_CATALOG_DATE", `${path}.date`, `Date '${entry.date}' appears more than once.`);
    }
    if (typeof entry.file !== "string" || !FILE_PATTERN.test(entry.file)) {
      throw new PuzzleCatalogError("UNSAFE_PUZZLE_FILE", `${path}.file`, "Puzzle file must be a safe JSON file name in the catalog directory.");
    }
    seenDates.add(entry.date);
    return { date: entry.date, file: entry.file };
  });
  if (!seenDates.has(catalog.defaultDate)) {
    throw new PuzzleCatalogError("MISSING_DEFAULT_ENTRY", "$.defaultDate", "Catalog defaultDate must match one puzzle entry.");
  }
  return {
    schemaVersion: 1,
    defaultDate: catalog.defaultDate,
    puzzles: entries.sort((left, right) => right.date.localeCompare(left.date))
  };
}

export function resolvePuzzleEntry(catalog, requestedDate = null) {
  const validated = validatePuzzleCatalog(catalog);
  const selectedDate = requestedDate === null ? validated.defaultDate : requestedDate;
  if (!isRealDate(selectedDate)) {
    throw new PuzzleCatalogError("INVALID_PUZZLE_DATE", "$query.date", "Requested puzzle date must be a real YYYY-MM-DD date.");
  }
  const entry = validated.puzzles.find((candidate) => candidate.date === selectedDate);
  if (!entry) {
    throw new PuzzleCatalogError("UNKNOWN_PUZZLE_DATE", "$query.date", `No puzzle is listed for ${selectedDate}.`);
  }
  return { catalog: validated, entry };
}

export function readRequestedPuzzleDate(searchParams) {
  const values = searchParams.getAll("date");
  if (values.length > 1) {
    throw new PuzzleCatalogError("DUPLICATE_PUZZLE_DATE", "$query.date", "Puzzle date must appear at most once.");
  }
  return values.length === 1 ? values[0] : null;
}
