export type LoginIdentifierType = "PHONE" | "EMAIL";

export type NormalizedLoginIdentifier = {
  value: string;
  type: LoginIdentifierType;
};

export type PasswordRequirement =
  | "length"
  | "uppercase"
  | "lowercase"
  | "number"
  | "special";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeLoginIdentifier(
  input: string,
): NormalizedLoginIdentifier | null {
  const value = input.trim();

  if (MAINLAND_PHONE_PATTERN.test(value)) {
    return { value, type: "PHONE" };
  }

  const normalizedEmail = value.toLowerCase();
  if (normalizedEmail.length <= 254 && EMAIL_PATTERN.test(normalizedEmail)) {
    return { value: normalizedEmail, type: "EMAIL" };
  }

  return null;
}

export function getPasswordRequirements(password: string) {
  return {
    length:
      password.length >= PASSWORD_MIN_LENGTH &&
      password.length <= PASSWORD_MAX_LENGTH,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  } satisfies Record<PasswordRequirement, boolean>;
}

export function isPasswordValid(password: string): boolean {
  return Object.values(getPasswordRequirements(password)).every(Boolean);
}
