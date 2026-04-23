/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/platform/env/index.js";

/** @type {import("next").NextConfig} */
const config = {
  serverExternalPackages: ["@prisma/client", "prisma"],
  transpilePackages: ["echarts", "zrender"],
};

export default config;
