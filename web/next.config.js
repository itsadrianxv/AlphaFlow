/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./env.js";

/** @type {import("next").NextConfig} */
const config = {
  serverExternalPackages: ["@prisma/client", "prisma"],
  transpilePackages: ["echarts", "zrender"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "opendoodles.s3-us-west-1.amazonaws.com",
        pathname: "/dancing.svg",
      },
    ],
  },
  experimental: {
    authInterrupts: true,
  },
};

export default config;
