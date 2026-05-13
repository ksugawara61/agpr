import type { DiffCoverageResult } from "./coverage.js";

const getCoverageIcon = (pct: number): string => {
  if (pct >= 80) {
    return "✅";
  }
  if (pct >= 50) {
    return "⚠️";
  }
  return "❌";
};

export const formatResult = (
  result: DiffCoverageResult,
  threshold: number | undefined,
): string => {
  const output = [
    "=== Diff Coverage Report (vitest) ===\n",
    `Files changed: ${result.summary.totalFiles}`,
    `Lines:      ${result.summary.lines.pct}% (${result.summary.lines.covered}/${result.summary.lines.total})`,
    `Statements: ${result.summary.statements.pct}% (${result.summary.statements.covered}/${result.summary.statements.total})`,
    `Functions:  ${result.summary.functions.pct}% (${result.summary.functions.covered}/${result.summary.functions.total})`,
    `Branches:   ${result.summary.branches.pct}% (${result.summary.branches.covered}/${result.summary.branches.total})`,
  ];

  if (threshold !== undefined) {
    const passed = result.summary.lines.pct >= threshold;
    output.push(`\nThreshold: ${threshold}% -> ${passed ? "PASS" : "FAIL"}`);
  }

  output.push("\n--- Per File ---");
  output.push(
    ...result.files.flatMap((file) => {
      const lines = [
        `${getCoverageIcon(file.lines.pct)} ${file.path}`,
        `   Lines: ${file.lines.pct}%  Stmts: ${file.statements.pct}%  Fns: ${file.functions.pct}%  Branches: ${file.branches.pct}%`,
      ];
      if (file.uncoveredLines.length > 0) {
        const preview = file.uncoveredLines.slice(0, 10).join(", ");
        const more =
          file.uncoveredLines.length > 10
            ? ` ... (+${file.uncoveredLines.length - 10})`
            : "";
        lines.push(`   Uncovered lines: ${preview}${more}`);
      }
      return lines;
    }),
  );

  return output.join("\n");
};
