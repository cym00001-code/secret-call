import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: {
    command: "pnpm dev",
    env: {
      DISABLE_RATE_LIMIT: "1",
      SECRET_ROOM_SQLITE_ADAPTER: "cli",
      OFFLINE_SECRET_DB_PATH: "C:/Windows/Temp/secret-room-e2e/offline-secrets.sqlite"
    },
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 90_000
  }
});
