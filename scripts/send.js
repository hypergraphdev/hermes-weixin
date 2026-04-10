#!/usr/bin/env node
/**
 * C4 Bridge Adapter for zylos-weixin send script.
 *
 * C4 c4-send.js calls channel scripts with positional args:
 *   node send.js <endpoint> <message>
 *
 * But dist/scripts/send.js expects named flags:
 *   node send.js --channel weixin --endpoint <id> --content <text>
 *
 * This adapter translates between the two interfaces.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error("Usage: send.js <endpoint> <message>");
  process.exit(1);
}

const endpoint = args[0];
const message = args[1];

try {
  execFileSync("node", [
    path.join(__dirname, "..", "dist", "scripts", "send.js"),
    "--channel", "weixin",
    "--endpoint", endpoint,
    "--content", message
  ], { stdio: "inherit" });
} catch (e) {
  process.exit(e.status || 1);
}
