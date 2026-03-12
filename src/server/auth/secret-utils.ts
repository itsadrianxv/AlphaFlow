export const AUTH_SECRET_EXAMPLE_VALUE = "replace-with-a-random-secret";
export const MIN_PRODUCTION_AUTH_SECRET_LENGTH = 32;
const AUTH_SECRET_ROTATION_ERROR_MESSAGE = "no matching decryption secret";

type AuthSecretCandidate = string | null | undefined;

type CollectAuthSecretsInput = {
  authSecret?: AuthSecretCandidate;
  authSecret1?: AuthSecretCandidate;
  authSecret2?: AuthSecretCandidate;
  authSecret3?: AuthSecretCandidate;
  nextAuthSecret?: AuthSecretCandidate;
};

type ValidatePrimaryAuthSecretInput = {
  nodeEnv?: string | null;
  authSecret?: AuthSecretCandidate;
  nextAuthSecret?: AuthSecretCandidate;
};

const normalizeSecret = (value?: AuthSecretCandidate) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : undefined;
};

export const collectAuthSecrets = (input: CollectAuthSecretsInput) => {
  const orderedCandidates = [
    input.authSecret,
    input.authSecret1,
    input.authSecret2,
    input.authSecret3,
    input.nextAuthSecret,
  ];

  const secrets: string[] = [];

  for (const candidate of orderedCandidates) {
    const normalized = normalizeSecret(candidate);

    if (!normalized || secrets.includes(normalized)) {
      continue;
    }

    secrets.push(normalized);
  }

  return secrets;
};

export const getPrimaryAuthSecret = (
  input: Omit<
    CollectAuthSecretsInput,
    "authSecret1" | "authSecret2" | "authSecret3"
  >,
) => normalizeSecret(input.authSecret) ?? normalizeSecret(input.nextAuthSecret);

export const validatePrimaryAuthSecret = (
  input: ValidatePrimaryAuthSecretInput,
) => {
  if (input.nodeEnv !== "production") {
    return null;
  }

  const primarySecret = getPrimaryAuthSecret(input);

  if (!primarySecret) {
    return "AUTH_SECRET is required in production. Generate one with `npx auth secret` before starting the container.";
  }

  if (primarySecret === AUTH_SECRET_EXAMPLE_VALUE) {
    return "AUTH_SECRET is still using the example placeholder. Generate a real secret with `npx auth secret`. If you are rotating from an older deployment, keep the previous value in AUTH_SECRET_1 so existing sessions can still be decrypted.";
  }

  if (primarySecret.length < MIN_PRODUCTION_AUTH_SECRET_LENGTH) {
    return `AUTH_SECRET must be at least ${MIN_PRODUCTION_AUTH_SECRET_LENGTH} characters in production.`;
  }

  return null;
};

export const isSecretRotationErrorMessage = (message?: string | null) =>
  message === AUTH_SECRET_ROTATION_ERROR_MESSAGE;
