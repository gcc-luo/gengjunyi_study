import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function mergeAllowedOrigins(existing: string, ...required: string[]): string {
  const command = [
    "source ops/lib/lan-origins.sh",
    `merge_allowed_origins ${JSON.stringify(existing)} ${required.map((value) => JSON.stringify(value)).join(" ")}`,
  ].join("; ");
  const result = spawnSync("bash", ["-lc", command], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `origin merge exited with ${result.status}`);
  }
  return result.stdout.trim();
}

function resolveAllowedOrigins(
  overrideIsSet: boolean,
  override: string,
  existing: string,
  ...required: string[]
): string {
  const command = [
    "source ops/lib/lan-origins.sh",
    `resolve_allowed_origins ${overrideIsSet ? "true" : "false"} ${JSON.stringify(override)} ${JSON.stringify(existing)} ${required.map((value) => JSON.stringify(value)).join(" ")}`,
  ].join("; ");
  const result = spawnSync("bash", ["-lc", command], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `origin resolution exited with ${result.status}`);
  }
  return result.stdout.replace(/\r?\n$/u, "");
}

describe("LAN deployment origin allowlist", () => {
  it("adds the current LAN origin to an older localhost-only allowlist", () => {
    expect(mergeAllowedOrigins(
      "http://localhost:8189,http://127.0.0.1:8189",
      "http://192.168.109.74:8189",
      "http://localhost:8189",
      "http://127.0.0.1:8189",
    )).toBe(
      "http://localhost:8189,http://127.0.0.1:8189,http://192.168.109.74:8189",
    );
  });

  it("preserves custom origins while removing duplicate entries", () => {
    expect(mergeAllowedOrigins(
      "http://phone.test:8189,http://localhost:8189,http://phone.test:8189",
      "http://192.168.109.74:8189",
      "http://localhost:8189",
    )).toBe(
      "http://phone.test:8189,http://localhost:8189,http://192.168.109.74:8189",
    );
  });

  it("preserves an explicitly empty override instead of widening it", () => {
    expect(resolveAllowedOrigins(
      true,
      "",
      "http://localhost:8189",
      "http://192.168.109.74:8189",
    )).toBe("");
  });

  it("preserves an explicit custom override without adding defaults", () => {
    expect(resolveAllowedOrigins(
      true,
      "http://phone.test:8189",
      "http://localhost:8189",
      "http://192.168.109.74:8189",
    )).toBe("http://phone.test:8189");
  });
});
