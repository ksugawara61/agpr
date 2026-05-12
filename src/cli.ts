import { Command } from "commander";
import packageJson from "../package.json";

const program = new Command();

program
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version);

program.parse();
