import { describe, expect, it } from "@effect/vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

describe("standalone installer", () => {
  const standalone = join(agentDir, "install-standalone.sh");
  const run = (args: ReadonlyArray<string>, extra: Record<string, string>) =>
    execFileSync("bash", [standalone, ...args], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"], HOME: "/Users/example", ...extra },
    });
  // Synthetic values; the token has XML special characters on purpose.
  const values = {
    NODE_BIN: "/opt/example/bin/node",
    STASH_URL: "https://stash.example.com/",
    STASH_DEVICE_TOKEN: "stash_synthetic<&>token",
  };

  it("renders a plist that runs the downloaded agent with Node and the token", () => {
    const plist = Plist.parse(run(["--print"], values));
    expect(plist).toEqual({
      Label: "com.stash.mac-agent",
      ProgramArguments: [
        values.NODE_BIN,
        "/Users/example/Library/Application Support/stash-mac-agent/stash-mac-agent.mjs",
      ],
      WorkingDirectory: "/Users/example/Library/Application Support/stash-mac-agent",
      EnvironmentVariables: {
        PATH: "/opt/example/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        STASH_API_URL: "https://stash.example.com/api",
        STASH_DEVICE_TOKEN: values.STASH_DEVICE_TOKEN,
      },
      RunAtLoad: true,
      KeepAlive: true,
      ThrottleInterval: 60,
      ProcessType: "Background",
      StandardOutPath: "/Users/example/Library/Logs/stash-mac-agent/mac-agent.log",
      StandardErrorPath: "/Users/example/Library/Logs/stash-mac-agent/mac-agent.err.log",
    });
  });

  it("refuses to run without the address or the token", () => {
    expect(() => run(["--print"], { ...values, STASH_URL: "" })).toThrow();
    expect(() =>
      run(["--print"], { ...values, STASH_DEVICE_TOKEN: "", STASH_TOKEN_TTY: "/nonexistent" }),
    ).toThrow();
  });

  it("asks for the token in the terminal when it is not in env", () => {
    const tty = join(mkdtempSync(join(tmpdir(), "stash-tty-")), "tty");
    writeFileSync(tty, "stash_synthetic_typed_token\n");
    const plist = Plist.parse(
      run(["--print"], { ...values, STASH_DEVICE_TOKEN: "", STASH_TOKEN_TTY: tty }),
    ) as { EnvironmentVariables: Record<string, string> };
    expect(plist.EnvironmentVariables["STASH_DEVICE_TOKEN"]).toBe("stash_synthetic_typed_token");
  });
});
