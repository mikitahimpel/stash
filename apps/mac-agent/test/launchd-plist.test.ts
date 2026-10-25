import { describe, expect, it } from "@effect/vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Plist from "plist";

const agentDir = dirname(dirname(fileURLToPath(import.meta.url)));
const installScript = join(agentDir, "install.sh");
const template = join(agentDir, "launchd/com.stash.mac-agent.plist");

// Synthetic paths; the env file path has XML and sed special characters on purpose.
const env = {
  NODE_BIN: "/opt/example/bin/node",
  PP_BIN: "/opt/example/bin/pp",
  STASH_AGENT_ENV_FILE: "/Users/example/stash & <co>|x\\y/.env",
  STASH_AGENT_LOG_DIR: "/Users/example/Library/Logs/stash-mac-agent",
};

const render = () =>
  execFileSync("bash", [installScript, "--print"], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"], HOME: "/Users/example", ...env },
  });

describe("launchd plist", () => {
  it("renders into a valid plist with every placeholder filled", () => {
    const xml = render();
    expect(xml).not.toMatch(/__[A-Z_]+__/);

    const plist = Plist.parse(xml);
    expect(plist).toEqual({
      Label: "com.stash.mac-agent",
      ProgramArguments: [
        env.PP_BIN,
        "run",
        "--env-file",
        env.STASH_AGENT_ENV_FILE,
        "--",
        env.NODE_BIN,
        join(agentDir, "src/main.ts"),
      ],
      WorkingDirectory: agentDir,
      EnvironmentVariables: {
        PATH: "/opt/example/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        PROTON_PASS_AGENT_REASON: "stash mac-agent: post iCloud tabs",
      },
      RunAtLoad: true,
      KeepAlive: true,
      ThrottleInterval: 60,
      ProcessType: "Background",
      StandardOutPath: `${env.STASH_AGENT_LOG_DIR}/mac-agent.log`,
      StandardErrorPath: `${env.STASH_AGENT_LOG_DIR}/mac-agent.err.log`,
    });
  });

  it("keeps the template free of personal values", () => {
    const xml = readFileSync(template, "utf8");
    expect(xml).not.toMatch(/\/Users\/|\/home\//);
    expect(xml).not.toMatch(/pass:\/\/\w/);
    expect(Plist.parse(xml)).toMatchObject({ Label: "com.stash.mac-agent" });
  });

  it("has scripts that parse", () => {
    for (const script of ["install.sh", "uninstall.sh"]) {
      execFileSync("bash", ["-n", join(agentDir, script)]);
    }
  });
});
