import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type CoverageMetric = { covered: number; pct: number; total: number };

type CoverageSummaryEntry = {
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
  statements: CoverageMetric;
};

export type CoverageSummary = Record<string, CoverageSummaryEntry>;

type StatementLocation = { start?: { line?: number } };

export type FileDetail = {
  s?: Record<string, number>;
  statementMap?: Record<string, StatementLocation>;
};

export const readCoverageSummary = async (
  cwd: string,
): Promise<CoverageSummary> => {
  const raw = await readFile(
    resolve(cwd, "coverage/coverage-summary.json"),
    "utf-8",
  );
  return JSON.parse(raw) as CoverageSummary;
};

export const readCoverageFinal = async (
  cwd: string,
): Promise<Record<string, FileDetail | undefined>> => {
  try {
    const raw = await readFile(
      resolve(cwd, "coverage/coverage-final.json"),
      "utf-8",
    );
    return JSON.parse(raw) as Record<string, FileDetail | undefined>;
  } catch {
    return {};
  }
};
