// Starts the server and client dev processes together; Ctrl-C stops both.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const procs = [
  { name: "server", color: 36, args: ["run", "dev", "-w", "@puck/server"] },
  { name: "client", color: 35, args: ["run", "dev", "-w", "@puck/client"] },
];

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exitCode = code;
}

for (const { name, color, args } of procs) {
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => console.log(prefix + line));
  }
  child.on("exit", (code, signal) => {
    console.log(`${prefix}exited (${signal ?? code})`);
    shutdown(shuttingDown ? process.exitCode : 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
