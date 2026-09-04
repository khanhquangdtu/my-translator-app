// Runs the AWS CLI against this project's .aws/ profile instead of ~/.aws.
// Usage: npm run aws -- sts get-caller-identity
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = path.join(root, ".aws", "config");
const credentials = path.join(root, ".aws", "credentials");

if (!existsSync(credentials)) {
  console.error(`No ${credentials}. Copy .aws/credentials.example and fill in your keys.`);
  process.exit(1);
}

const { status } = spawnSync("aws", process.argv.slice(2), {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    AWS_CONFIG_FILE: config,
    AWS_SHARED_CREDENTIALS_FILE: credentials,
    AWS_PROFILE: process.env.AWS_PROFILE || "my-translator-pwa",
  },
});
process.exit(status ?? 1);
