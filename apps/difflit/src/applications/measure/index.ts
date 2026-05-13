import {
  readCoverageFinal,
  readCoverageSummary,
} from "../../repositories/coverage-files.js";
import type { DiffFile } from "../../repositories/git.js";
import { getDiffFiles } from "../../repositories/git.js";
import { runVitest } from "../../repositories/runners/vitest.js";
import { globToRegex } from "../shared/glob.js";
import { computeFileCoverages, type DiffCoverageResult } from "./coverage.js";

export type MeasureOptions = {
  base?: string;
  cwd: string;
  exclude: string[];
  extensions: string[];
  include: string[];
  testCommand?: string;
  threshold?: number;
};

export type MeasureOutcome = {
  coverage: DiffCoverageResult;
  diffFiles: DiffFile[];
  thresholdMet: boolean | null;
};

export const resolveMeasureDiffFiles = async (
  options: MeasureOptions,
): Promise<DiffFile[]> =>
  getDiffFiles({
    base: options.base,
    cwd: options.cwd,
    excludePatterns: options.exclude.map(globToRegex),
    extensions: options.extensions,
    includePatterns: options.include.map(globToRegex),
  });

const computeThresholdMet = (
  result: DiffCoverageResult,
  threshold: number | undefined,
): boolean | null =>
  threshold === undefined ? null : result.summary.lines.pct >= threshold;

export const measureWithDiffFiles = async (
  options: MeasureOptions,
  diffFiles: DiffFile[],
): Promise<MeasureOutcome> => {
  await runVitest({
    cwd: options.cwd,
    diffFilePaths: diffFiles.map((file) => file.path),
    testCommand: options.testCommand,
  });

  let summaryData: Awaited<ReturnType<typeof readCoverageSummary>>;
  try {
    summaryData = await readCoverageSummary(options.cwd);
  } catch {
    throw new Error(
      "Failed to read coverage report. Check the Vitest output above.",
    );
  }

  const detailData = await readCoverageFinal(options.cwd);
  const coverage = computeFileCoverages(
    summaryData,
    detailData,
    options.cwd,
    diffFiles,
  );

  return {
    coverage,
    diffFiles,
    thresholdMet: computeThresholdMet(coverage, options.threshold),
  };
};
