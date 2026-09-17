// Manual synthetic acceptance only: reserved address, no transmitted application content.
import { spawn } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import net from "node:net";

async function deniedConnection() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "192.0.2.1", port: 9 });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error) => resolve(error.code === "EPERM" || error.code === "EACCES"));
  });
}

if (process.argv[2] === "--descendant") {
  process.stdout.write(JSON.stringify({ denied: await deniedConnection() }) + "\n");
} else {
  const parentNetworkDenied = await deniedConnection();
  const child = spawn(process.execPath, [import.meta.filename, "--descendant"], {
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let bytes = "";
  child.stdout.on("data", (chunk) => {
    bytes += chunk;
    if (bytes.length > 128) child.kill("SIGKILL");
  });
  const code = await new Promise((resolve) => {
    child.once("error", () => resolve(-1));
    child.once("close", resolve);
  });
  let descendantNetworkDenied = false;
  try {
    descendantNetworkDenied = code === 0 && JSON.parse(bytes).denied === true;
  } catch {}
  let sourceReadDenied = false;
  let descriptor;
  try {
    descriptor = openSync(process.argv[2], "r");
    readSync(descriptor, Buffer.alloc(1), 0, 1, 0);
  } catch (error) {
    sourceReadDenied = error.code === "EPERM" || error.code === "EACCES";
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  process.stdout.write(
    JSON.stringify({ parentNetworkDenied, descendantNetworkDenied, sourceReadDenied }) + "\n",
  );
}
