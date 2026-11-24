import type { Merchant, PayerField, SchoolLevel } from "./types";

/**
 * Cohort options — the dropdowns a school or university lets its payers pick
 * from.
 *
 * A payer types the student's name and *selects* faculty, department, class or
 * year; the payee publishes the lists from its business portal. Values land on
 * the receipt exactly as published, which is what makes the portal's grouping
 * trustworthy ("Faculty of Science" never arrives as "science", "Science" and
 * "fac. of science").
 *
 * Once a payee saves a catalogue it becomes authoritative: the server rejects
 * any value that is not on the list. Payees that never opened the editor fall
 * back to a sensible default for their level, and accept free text — so nothing
 * breaks for a school that has not touched the settings yet.
 */

export const MAX_FACULTIES = 12;
export const MAX_DEPARTMENTS_PER_FACULTY = 20;
export const MAX_OPTIONS = 16;
export const MAX_LABEL = 40;

export interface Faculty {
  name: string;
  departments: string[];
}

export interface CohortCatalogue {
  faculties: Faculty[];
  years: string[];
  classes: string[];
}

const UNIVERSITY_DEFAULT: CohortCatalogue = {
  faculties: [
    { name: "Faculty of Science", departments: ["Computer Science", "Mathematics", "Physics", "Biology"] },
    { name: "Faculty of Arts & Humanities", departments: ["English", "French", "History", "Philosophy"] },
    { name: "Faculty of Law & Political Science", departments: ["Law", "Political Science"] },
    { name: "Faculty of Economics & Management", departments: ["Economics", "Accounting", "Management"] },
    { name: "Faculty of Medicine", departments: ["Nursing", "Biomedical Sciences", "Public Health"] },
    { name: "Faculty of Education", departments: ["Curriculum Studies", "Educational Psychology"] },
  ],
  years: ["Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Masters 1", "Masters 2"],
  classes: [],
};

const SECONDARY_DEFAULT: CohortCatalogue = {
  faculties: [],
  years: [],
  classes: ["Form 1", "Form 2", "Form 3", "Form 4", "Form 5", "Lower Sixth", "Upper Sixth"],
};

const PRIMARY_DEFAULT: CohortCatalogue = {
  faculties: [],
  years: [],
  classes: ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6"],
};

const EMPTY: CohortCatalogue = { faculties: [], years: [], classes: [] };

const copy = (catalogue: CohortCatalogue): CohortCatalogue => ({
  faculties: catalogue.faculties.map((f) => ({ name: f.name, departments: [...f.departments] })),
  years: [...catalogue.years],
  classes: [...catalogue.classes],
});

/** What a school of this level offers before it customises anything. */
export function defaultCohorts(level?: SchoolLevel): CohortCatalogue {
  if (level === "university") return copy(UNIVERSITY_DEFAULT);
  if (level === "secondary") return copy(SECONDARY_DEFAULT);
  if (level === "primary") return copy(PRIMARY_DEFAULT);
  return copy(EMPTY);
}

export function cohortsFor(merchant: Merchant): CohortCatalogue {
  if (merchant.cohorts) return merchant.cohorts;
  if (merchant.category !== "education") return copy(EMPTY);
  return defaultCohorts(merchant.schoolLevel);
}

/** True once the payee has saved a catalogue — from then on the list is law. */
export function cohortsPublished(merchant: Merchant): boolean {
  return Boolean(merchant.cohorts);
}

export function facultyNames(merchant: Merchant): string[] {
  return cohortsFor(merchant).faculties.map((f) => f.name);
}

/** The options for one payer field on a published catalogue. */
export function fieldOptions(catalogue: CohortCatalogue, field: PayerField, faculty?: string): string[] {
  if (field === "class") return catalogue.classes;
  if (field === "year") return catalogue.years;
  if (field === "faculty") return catalogue.faculties.map((f) => f.name);
  const wanted = (faculty ?? "").trim().toLowerCase();
  if (!wanted) return [];
  const match = catalogue.faculties.find((f) => f.name.toLowerCase() === wanted);
  return match?.departments ?? [];
}

/** The options for one payer field, given what the payer has chosen so far. */
export function optionsForField(merchant: Merchant, field: PayerField, faculty?: string): string[] {
  const catalogue = cohortsFor(merchant);
  if (field === "class") return catalogue.classes;
  if (field === "year") return catalogue.years;
  if (field === "faculty") return catalogue.faculties.map((f) => f.name);
  const wanted = (faculty ?? "").trim().toLowerCase();
  if (!wanted) return [];
  const match = catalogue.faculties.find((f) => f.name.toLowerCase() === wanted);
  return match?.departments ?? [];
}

const fold = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** The published spelling for a submitted value, or null when it is not listed. */
export function matchOption(options: string[], value: string): string | null {
  const wanted = fold(value);
  if (!wanted) return null;
  return options.find((option) => fold(option) === wanted) ?? null;
}

const clean = (value: unknown, max = MAX_LABEL): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);

function uniqueList(input: unknown, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  for (const item of raw) {
    const value = clean(item);
    if (!value) continue;
    const key = fold(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

/** Validate and normalise a catalogue submitted from the portal. Throws human errors. */
export function normaliseCohorts(input: unknown): CohortCatalogue {
  const raw = (input ?? {}) as { faculties?: unknown; years?: unknown; classes?: unknown };
  const facultiesRaw = Array.isArray(raw.faculties) ? raw.faculties : [];
  if (facultiesRaw.length > MAX_FACULTIES) throw new Error(`List at most ${MAX_FACULTIES} faculties`);

  const faculties: Faculty[] = [];
  const seen = new Set<string>();
  for (const entry of facultiesRaw) {
    const item = (entry ?? {}) as { name?: unknown; departments?: unknown };
    const name = clean(item.name);
    if (!name) continue;
    const key = fold(name);
    if (seen.has(key)) throw new Error(`"${name}" is listed twice`);
    seen.add(key);
    faculties.push({ name, departments: uniqueList(item.departments, MAX_DEPARTMENTS_PER_FACULTY) });
  }

  return {
    faculties,
    years: uniqueList(raw.years, MAX_OPTIONS),
    classes: uniqueList(raw.classes, MAX_OPTIONS),
  };
}

/**
 * Keep the catalogue honest against the level: a university cannot keep classes,
 * a school cannot keep faculties.
 */
export function catalogueFitsLevel(catalogue: CohortCatalogue, level?: SchoolLevel): CohortCatalogue {
  if (level === "university") return { ...catalogue, classes: [] };
  if (level === "primary" || level === "secondary") return { ...catalogue, faculties: [] };
  return catalogue;
}
