import { Command } from "commander";
import packageJson from "../package.json";
import { registerCreateDraftPullRequestCommand } from "./presentations/pull-request/register-create-draft-pull-request-command.js";
import { registerUpdatePullRequestCommand } from "./presentations/pull-request/register-update-pull-request-command.js";
import { registerReviewCommand } from "./presentations/review/register-review-command.js";
import { registerReviewReplyCommand } from "./presentations/review/register-review-reply-command.js";

const program = new Command();

program
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version);

registerReviewCommand(program);
registerReviewReplyCommand(program);
registerCreateDraftPullRequestCommand(program);
registerUpdatePullRequestCommand(program);

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
