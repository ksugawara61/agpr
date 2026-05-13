import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { registerMeasureCommand } from "./presentations/measure/register-measure-command.js";

const program = new Command();

program
  .name("difflit")
  .description(packageJson.description)
  .version(packageJson.version);

registerMeasureCommand(program);

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
