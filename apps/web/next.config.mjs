import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const isCapacitorExport = process.env.CAPACITOR_EXPORT === "1";

const nextConfig = {
  poweredByHeader: false,
  ...(isCapacitorExport
    ? {
        output: "export",
        trailingSlash: true,
        images: {
          unoptimized: true
        }
      }
    : {}),
  outputFileTracingRoot: path.join(__dirname, "../.."),
  eslint: {
    ignoreDuringBuilds: true
  },
  ...(isCapacitorExport
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/",
              headers: [
                {
                  key: "Cache-Control",
                  value: "no-store, no-cache, must-revalidate"
                }
              ]
            }
          ];
        },
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: "http://127.0.0.1:3101/api/:path*"
            }
          ];
        }
      })
};

export default nextConfig;
