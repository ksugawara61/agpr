import type { DiffFile } from "@agpr/repositories/git";

export const formatDiffFiles = (diffFiles: DiffFile[]): string =>
  [
    "Changed source files:",
    ...diffFiles.map(
      (file) => `- ${file.path} (+${file.additions}/-${file.deletions})`,
    ),
  ].join("\n");
