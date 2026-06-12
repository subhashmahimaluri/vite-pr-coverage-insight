/**
 * Parser for Stryker's mutation-testing-report-schema JSON (the `json`
 * reporter's output, also produced by mutation tools in other ecosystems).
 * Coverage says the code *ran*; the mutation score says the tests would
 * *notice a bug* — a surviving mutant is a seeded bug the suite missed.
 *
 * Defensive by design: report shapes vary across tool versions, so unknown
 * shapes degrade to "no data", never a crash.
 */

export type SurvivedMutant = {
  file: string;
  line: number;
  mutator: string;
  /** what the mutant changed the code into, when the tool reports it */
  replacement?: string;
};

export type MutationSummary = {
  /** detected / valid * 100, Stryker's standard score; null when no valid mutants */
  score: number | null;
  detected: number;
  survived: number;
  noCoverage: number;
  total: number;
  /** survived + noCoverage mutants, grouped by workspace-relative file */
  survivedByFile: Record<string, SurvivedMutant[]>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relativizeKey(file: string, root?: string): string {
  let out = file.replace(/\\/g, '/');
  if (root) {
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    if (out.startsWith(normalizedRoot)) out = out.slice(normalizedRoot.length);
  }
  return out;
}

export function parseMutationReport(raw: string, root?: string): MutationSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`mutation report is not valid JSON: ${(error as Error).message}`);
  }
  const data = isObject(parsed) ? parsed : {};
  const files = isObject(data.files) ? data.files : {};

  let detected = 0;
  let survived = 0;
  let noCoverage = 0;
  let total = 0;
  const survivedByFile: Record<string, SurvivedMutant[]> = {};

  for (const [fileKey, rawFile] of Object.entries(files)) {
    if (!isObject(rawFile)) continue;
    const mutants = Array.isArray(rawFile.mutants) ? rawFile.mutants : [];
    const file = relativizeKey(fileKey, root);
    for (const rawMutant of mutants) {
      if (!isObject(rawMutant)) continue;
      const status = typeof rawMutant.status === 'string' ? rawMutant.status : '';
      // Ignored / CompileError / RuntimeError mutants are not "valid" — they
      // don't count toward the score (Stryker's definition)
      if (status === 'Killed' || status === 'Timeout') {
        detected += 1;
        total += 1;
      } else if (status === 'Survived' || status === 'NoCoverage') {
        if (status === 'Survived') survived += 1;
        else noCoverage += 1;
        total += 1;
        const location = isObject(rawMutant.location) ? rawMutant.location : {};
        const start = isObject(location.start) ? location.start : {};
        (survivedByFile[file] ??= []).push({
          file,
          line: typeof start.line === 'number' && Number.isFinite(start.line) ? start.line : 0,
          mutator:
            typeof rawMutant.mutatorName === 'string' ? rawMutant.mutatorName : 'unknown mutator',
          ...(typeof rawMutant.replacement === 'string'
            ? { replacement: rawMutant.replacement }
            : {}),
        });
      }
    }
  }

  return {
    score: total > 0 ? Math.round((detected / total) * 10000) / 100 : null,
    detected,
    survived,
    noCoverage,
    total,
    survivedByFile,
  };
}
