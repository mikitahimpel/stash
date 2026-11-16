import { describe, expect, it } from "@effect/vitest";
import * as ConnectValues from "../src/connect-values.ts";

const origin = "https://stash.example.com";

describe("Connect guide values", () => {
  it("builds the Shortcut URL with the device and url last", () => {
    expect(ConnectValues.shortcutUrl(origin, "device-ios")).toBe(
      "https://stash.example.com/save?device=device-ios&url=",
    );
  });

  it("builds a bookmarklet that opens /save with the page's title and URL", () => {
    const code = ConnectValues.bookmarklet(origin);
    expect(code.startsWith("javascript:")).toBe(true);
    const location = { href: "https://example.com/a?b=1&c=2" };
    // Runs the bookmarklet's body against a fake page.
    new Function("location", "document", code.slice("javascript:".length))(location, {
      title: "A & B",
    });
    expect(location.href).toBe(
      "https://stash.example.com/save?title=A%20%26%20B&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2",
    );
  });

  it("builds the install and uninstall commands for the Mac", () => {
    expect(ConnectValues.macInstallCommand(origin, "stash_synthetic-token")).toBe(
      "curl -fsSL 'https://stash.example.com/downloads/install-mac-agent.sh' | " +
        "STASH_URL='https://stash.example.com' STASH_DEVICE_TOKEN='stash_synthetic-token' bash",
    );
    expect(ConnectValues.macUninstallCommand(origin)).toBe(
      "curl -fsSL 'https://stash.example.com/downloads/install-mac-agent.sh' | bash -s -- --uninstall",
    );
  });

  it("prefills the advanced Shortcut and the extension download", () => {
    expect(ConnectValues.saveLinkEndpoint(origin)).toBe("https://stash.example.com/api/links");
    expect(ConnectValues.bearer("stash_x")).toBe("Bearer stash_x");
    expect(ConnectValues.extensionDownload(origin)).toBe(
      "https://stash.example.com/downloads/stash-extension.xpi",
    );
  });

  it("installs the Mac agent without the token in the command", () => {
    expect(ConnectValues.macInstallCommandPrompt("https://stash.example.com")).toBe(
      "curl -fsSL 'https://stash.example.com/downloads/install-mac-agent.sh' | " +
        "STASH_URL='https://stash.example.com' bash",
    );
  });
});
