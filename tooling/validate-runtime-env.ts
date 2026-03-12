import { validatePrimaryAuthSecret } from "../src/server/auth/secret-utils";

const validationError = validatePrimaryAuthSecret({
  nodeEnv: process.env.NODE_ENV,
  authSecret: process.env.AUTH_SECRET,
  nextAuthSecret: process.env.NEXTAUTH_SECRET,
});

if (validationError) {
  console.error(`[runtime-env] ${validationError}`);
  process.exit(1);
}
