import { readFile } from "node:fs/promises";

export const readTextFile = async (path: string): Promise<string> =>
  readFile(path, "utf8");
