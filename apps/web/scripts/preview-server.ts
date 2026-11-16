// The built web app (`vite build` first) under `vite preview`, for the scripts that drive it in a
// browser with a stubbed api: the layout audit and the Connect walk. Stop it with
// `process.kill(-server.pid, "SIGTERM")`.
import { type ChildProcess, spawn } from "node:child_process";
import * as Http from "node:http";
import * as Path from "node:path";

const appDir = Path.resolve(import.meta.dirname, "..");

// node:http keeps the script off the `fetch` global, which oxlint reserves for platform packages.
export const status = (url: string): Promise<number> =>
  new Promise((resolve) => {
    const req = Http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(0));
  });

/** Serves the built app on `port` with `vite preview`, unless something already answers there. */
export const serve = async (port: number): Promise<ChildProcess | undefined> => {
  const baseUrl = `http://localhost:${port}`;
  if ((await status(`${baseUrl}/login`)) === 200) return undefined;
  const child = spawn(
    "node_modules/.bin/vite",
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: appDir, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 60_000;
  while ((await status(`${baseUrl}/login`)) !== 200) {
    if (Date.now() > deadline || child.exitCode !== null) {
      throw new Error(`vite preview didn't start (run \`vite build\` first?)\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return child;
};
