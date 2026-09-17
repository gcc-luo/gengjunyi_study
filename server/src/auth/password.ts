import { randomBytes } from "node:crypto";
import argon2 from "argon2";

export const minimumParentPasswordLength = 12;
export const maximumParentPasswordLength = 1024;

export function isAcceptableParentPassword(password: string): boolean {
  const length = Array.from(password).length;
  return (
    password.trim().length > 0 &&
    length >= minimumParentPasswordLength &&
    length <= maximumParentPasswordLength
  );
}

const argon2Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, argon2Options);
}

export async function verifyPassword(
  password: string,
  passwordHash?: string,
): Promise<boolean> {
  const hash = passwordHash ?? await (dummyHash ??= hashPassword(randomBytes(32).toString("base64url")));
  try {
    const matches = await argon2.verify(hash, password);
    return passwordHash !== undefined && matches;
  } catch {
    return false;
  }
}
