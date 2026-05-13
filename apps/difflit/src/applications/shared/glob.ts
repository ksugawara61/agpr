export const globToRegex = (glob: string): RegExp => {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\?/g, "[^/]")
    .split("**/")
    .map((segment) => segment.split("**").join(".*").split("*").join("[^/]*"))
    .join("(.*/)?");
  return new RegExp(
    glob.includes("/") ? `^${escaped}($|/)` : `(^|/)${escaped}$`,
  );
};
