import { resolve } from "node:path";
import { type Command, InvalidArgumentError } from "commander";
import { formatDiffFiles } from "../../applications/diff/index.js";
import { formatResult } from "../../applications/measure/format.js";
import {
  type MeasureOptions,
  measureWithDiffFiles,
  resolveMeasureDiffFiles,
} from "../../applications/measure/index.js";
import { parseCsv } from "../shared/csv.js";

type MeasureCommandOptions = {
  base?: string;
  cmd?: string;
  cwd: string;
  diffOnly?: boolean;
  exclude?: string;
  ext: string;
  include?: string;
  json?: boolean;
  threshold?: number;
};

const parseThreshold = (value: string): number => {
  const threshold = Number.parseFloat(value);
  if (!Number.isFinite(threshold)) {
    throw new InvalidArgumentError("threshold must be a number");
  }
  return threshold;
};

const buildMeasureOptions = (
  rawOptions: MeasureCommandOptions,
): MeasureOptions => ({
  base: rawOptions.base,
  cwd: resolve(rawOptions.cwd),
  exclude: parseCsv(rawOptions.exclude),
  extensions: parseCsv(rawOptions.ext),
  include: parseCsv(rawOptions.include),
  testCommand: rawOptions.cmd,
  threshold: rawOptions.threshold,
});

const runMeasureCommand = async (
  rawOptions: MeasureCommandOptions,
): Promise<void> => {
  try {
    const measureOptions = buildMeasureOptions(rawOptions);
    const diffFiles = await resolveMeasureDiffFiles(measureOptions);

    if (diffFiles.length === 0) {
      console.log("No changed source files found.");
      return;
    }

    if (rawOptions.diffOnly) {
      console.log(formatDiffFiles(diffFiles));
      return;
    }

    console.error(
      `Measuring diff coverage against ${rawOptions.base ?? "merge-base of HEAD and main"} (runner: vitest)...`,
    );
    console.error(
      `Changed files: ${diffFiles.map((file) => file.path).join(", ")}`,
    );
    console.error("Running Vitest...\n");

    const outcome = await measureWithDiffFiles(measureOptions, diffFiles);
    console.log(
      rawOptions.json
        ? JSON.stringify(outcome.coverage, null, 2)
        : formatResult(outcome.coverage, rawOptions.threshold),
    );

    if (outcome.thresholdMet === false) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
};

export const registerMeasureCommand = (program: Command): void => {
  program
    .command("measure", { isDefault: true })
    .description("Measure Vitest coverage for changed files")
    .option(
      "-b, --base <branch>",
      "Base branch for diff (default: merge-base of HEAD and main)",
    )
    .option("-c, --cwd <path>", "Project root directory", process.cwd())
    .option("--cmd <command>", "Override Vitest command (e.g. 'pnpm vitest')")
    .option(
      "--ext <extensions>",
      "Comma-separated file extensions",
      "ts,tsx,js,jsx",
    )
    .option(
      "--threshold <number>",
      "Fail if line coverage is below this %",
      parseThreshold,
    )
    .option("--json", "Output raw JSON")
    .option("--diff-only", "Only show diff files, don't run tests")
    .option(
      "--exclude <patterns>",
      "Comma-separated glob patterns to exclude files (e.g. '*.mocks.ts,src/fixtures/**')",
    )
    .option(
      "--include <patterns>",
      "Comma-separated glob patterns to include files (e.g. 'src/**,packages/api/**')",
    )
    .action(async (rawOptions: MeasureCommandOptions) => {
      await runMeasureCommand(rawOptions);
    });
};
