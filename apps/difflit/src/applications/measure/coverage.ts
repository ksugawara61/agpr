import { relative, resolve } from "node:path";
import type {
  CoverageSummary,
  FileDetail,
} from "@agpr/repositories/coverage-files";
import type { DiffFile } from "@agpr/repositories/git";

type CoverageMetric = { covered: number; pct: number; total: number };

type FileCoverage = {
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
  path: string;
  statements: CoverageMetric;
  uncoveredLines: number[];
};

export type DiffCoverageResult = {
  files: FileCoverage[];
  runner: "vitest";
  summary: {
    branches: CoverageMetric;
    coveredFiles: number;
    functions: CoverageMetric;
    lines: CoverageMetric;
    statements: CoverageMetric;
    totalFiles: number;
  };
  timestamp: string;
  uncoveredFiles: string[];
};

type Totals = {
  branchCovered: number;
  branchTotal: number;
  fnCovered: number;
  fnTotal: number;
  lineCovered: number;
  lineTotal: number;
  stmtCovered: number;
  stmtTotal: number;
};

const normalizePath = (path: string): string => path.split("\\").join("/");

const emptyMetric = (): CoverageMetric => ({ covered: 0, pct: 0, total: 0 });

const getUncoveredLines = (fileDetail: FileDetail | undefined): number[] => {
  if (fileDetail?.s === undefined) {
    return [];
  }
  const lines = Object.entries(fileDetail.s)
    .filter(([, count]) => count === 0)
    .map(([id]) => fileDetail.statementMap?.[id]?.start?.line)
    .filter((line): line is number => typeof line === "number");
  return [...new Set(lines)].sort((a, b) => a - b);
};

const addMissingDiffFiles = (
  files: FileCoverage[],
  uncoveredFiles: string[],
  diffFiles: DiffFile[],
  cwd: string,
): void => {
  const coveredPaths = new Set(
    files.map((file) => normalizePath(resolve(cwd, file.path))),
  );
  const missingFiles = diffFiles.filter(
    (file) => !coveredPaths.has(normalizePath(resolve(cwd, file.path))),
  );

  files.push(
    ...missingFiles.map((file) => ({
      branches: emptyMetric(),
      functions: emptyMetric(),
      lines: emptyMetric(),
      path: file.path,
      statements: emptyMetric(),
      uncoveredLines: [],
    })),
  );
  uncoveredFiles.push(...missingFiles.map((file) => file.path));
};

const computePct = (covered: number, total: number): number =>
  total === 0 ? 0 : Math.round((covered / total) * 10000) / 100;

const buildCoverageResult = (
  files: FileCoverage[],
  uncoveredFiles: string[],
  totals: Totals,
): DiffCoverageResult => ({
  files,
  runner: "vitest",
  summary: {
    branches: {
      covered: totals.branchCovered,
      pct: computePct(totals.branchCovered, totals.branchTotal),
      total: totals.branchTotal,
    },
    coveredFiles: files.filter((file) => file.lines.pct > 0).length,
    functions: {
      covered: totals.fnCovered,
      pct: computePct(totals.fnCovered, totals.fnTotal),
      total: totals.fnTotal,
    },
    lines: {
      covered: totals.lineCovered,
      pct: computePct(totals.lineCovered, totals.lineTotal),
      total: totals.lineTotal,
    },
    statements: {
      covered: totals.stmtCovered,
      pct: computePct(totals.stmtCovered, totals.stmtTotal),
      total: totals.stmtTotal,
    },
    totalFiles: files.length,
  },
  timestamp: new Date().toISOString(),
  uncoveredFiles,
});

export const computeFileCoverages = (
  summaryData: CoverageSummary,
  detailData: Record<string, FileDetail | undefined>,
  cwd: string,
  diffFiles: DiffFile[],
): DiffCoverageResult => {
  const diffPaths = new Set(
    diffFiles.map((file) => normalizePath(resolve(cwd, file.path))),
  );
  const totals: Totals = {
    branchCovered: 0,
    branchTotal: 0,
    fnCovered: 0,
    fnTotal: 0,
    lineCovered: 0,
    lineTotal: 0,
    stmtCovered: 0,
    stmtTotal: 0,
  };
  const files = Object.entries(summaryData).flatMap(([coveragePath, data]) => {
    if (coveragePath === "total") {
      return [];
    }

    const absPath = normalizePath(resolve(cwd, coveragePath));
    if (!diffPaths.has(absPath)) {
      return [];
    }

    totals.stmtTotal += data.statements.total;
    totals.stmtCovered += data.statements.covered;
    totals.lineTotal += data.lines.total;
    totals.lineCovered += data.lines.covered;
    totals.fnTotal += data.functions.total;
    totals.fnCovered += data.functions.covered;
    totals.branchTotal += data.branches.total;
    totals.branchCovered += data.branches.covered;

    const relPath = normalizePath(relative(cwd, absPath));
    const detail =
      detailData[coveragePath] ?? detailData[absPath] ?? detailData[relPath];
    return [
      {
        branches: data.branches,
        functions: data.functions,
        lines: data.lines,
        path: relPath,
        statements: data.statements,
        uncoveredLines: getUncoveredLines(detail),
      },
    ];
  });
  const uncoveredFiles = files
    .filter((file) => file.lines.pct < 50)
    .map((file) => file.path);

  addMissingDiffFiles(files, uncoveredFiles, diffFiles, cwd);
  return buildCoverageResult(files, uncoveredFiles, totals);
};
