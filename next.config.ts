import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  outputFileTracingIncludes: { "/api/**/*": ["./db/migrations/**/*.sql"] },
};

export default nextConfig;
