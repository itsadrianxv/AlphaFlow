import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    AUTH_WECHAT_ID: z.string().optional(),
    AUTH_WECHAT_SECRET: z.string().optional(),
    AUTH_QQ_ID: z.string().optional(),
    AUTH_QQ_SECRET: z.string().optional(),
    AUTH_CREDENTIALS_USERNAME: z.string().optional(),
    AUTH_CREDENTIALS_PASSWORD: z.string().optional(),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
    PYTHON_INTELLIGENCE_SERVICE_URL: z
      .string()
      .url()
      .default("http://127.0.0.1:8000"),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
    WORKFLOW_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_WECHAT_ID: process.env.AUTH_WECHAT_ID,
    AUTH_WECHAT_SECRET: process.env.AUTH_WECHAT_SECRET,
    AUTH_QQ_ID: process.env.AUTH_QQ_ID,
    AUTH_QQ_SECRET: process.env.AUTH_QQ_SECRET,
    AUTH_CREDENTIALS_USERNAME: process.env.AUTH_CREDENTIALS_USERNAME,
    AUTH_CREDENTIALS_PASSWORD: process.env.AUTH_CREDENTIALS_PASSWORD,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    PYTHON_INTELLIGENCE_SERVICE_URL: process.env.PYTHON_INTELLIGENCE_SERVICE_URL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    WORKFLOW_WORKER_POLL_INTERVAL_MS: process.env.WORKFLOW_WORKER_POLL_INTERVAL_MS,
    NODE_ENV: process.env.NODE_ENV,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
