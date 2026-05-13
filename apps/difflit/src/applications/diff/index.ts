import type { DiffFile } from "../../repositories/git.js";

export const formatDiffFiles = (diffFiles: DiffFile[]): string =>
  [
    "Changed source files:",
    ...diffFiles.map(
      (file) => `- ${file.path} (+${file.additions}/-${file.deletions})`,
    ),
  ].join("\n");
