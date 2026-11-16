import * as ApiTesting from "@stash/web-api-client/testing";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";

// A stub api that keeps devices, their activity and tokens in memory, in wire (JSON) form, with
// synthetic values only. `arrive` simulates a device getting in touch, as a save would.

const body = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : {};

export interface DeviceJson {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly createdAt: string;
}

export const fakeApi = (mcpUrl: string | null = "https://mcp.example.com/mcp") => {
  const calls: Array<string> = [];
  const devices: Array<DeviceJson> = [];
  const activity = new Map<string, { lastSeenAt: string | null; lastSave: unknown }>();
  const tokens: Array<Record<string, unknown>> = [];
  const approved = new Set<string>();
  const routes: ApiTesting.Routes = {
    "GET /devices": () => ApiTesting.json(devices),
    "GET /devices/activity": () =>
      ApiTesting.json(
        devices.map((device) => ({
          deviceId: device.id,
          ...(activity.get(device.id) ?? { lastSeenAt: null, lastSave: null }),
        })),
      ),
    "POST /devices": (request) => {
      const payload = body(request) as { name: string; kind: string };
      calls.push(`register ${payload.name} ${payload.kind}`);
      const device = {
        id: `device-${devices.length + 1}`,
        name: payload.name,
        kind: payload.kind,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      devices.push(device);
      return ApiTesting.json(device, 201);
    },
    "GET /tokens": () => ApiTesting.json(tokens),
    "POST /tokens": (request) => {
      const { deviceId } = body(request) as { deviceId: string };
      calls.push(`create token ${deviceId}`);
      const token = {
        id: `token-${tokens.length + 1}`,
        deviceId,
        name: null,
        createdAt: "2026-01-02T00:00:00.000Z",
        revokedAt: null,
        lastUsedAt: null,
      };
      tokens.push(token);
      return ApiTesting.json({ ...token, token: `stash_synthetic_${token.id}` }, 201);
    },
    "POST /pairings": (request) => {
      const { code, name } = body(request) as { code: string; name: string };
      if (approved.has(code)) {
        return ApiTesting.json({ _tag: "Conflict", message: "This pairing code is used" }, 409);
      }
      approved.add(code);
      const device = {
        id: `device-${devices.length + 1}`,
        name,
        kind: "zen",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      devices.push(device);
      calls.push(`approve ${code} ${device.id} ${name}`);
      return ApiTesting.json(device, 201);
    },
    "GET /connect/info": () => ApiTesting.json({ mcpUrl }),
  };
  const arrive = (deviceId: string, at: string, title?: string) =>
    activity.set(deviceId, {
      lastSeenAt: at,
      lastSave:
        title === undefined
          ? null
          : { at, linkId: "link-1", url: "https://example.com/arrived", title },
    });
  const useClaude = (at: string) =>
    tokens.push({
      id: `token-${tokens.length + 1}`,
      deviceId: null,
      name: "Claude (MCP)",
      createdAt: at,
      revokedAt: null,
      lastUsedAt: at,
    });
  return { calls, routes, devices, arrive, useClaude };
};
