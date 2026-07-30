import "server-only";

import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

// 固定虚拟哈希用于不存在账号的登录路径，缩小响应时间差异。
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$WjJQYmhvdVFkMXM0UUZzNg$mGI0NqWf8EwE0W3dLgF9z8qM9p1vGw9CzV8ENyJZwQY";

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function verifyDummyPassword(password: string): Promise<boolean> {
  return verifyPassword(DUMMY_PASSWORD_HASH, password);
}
