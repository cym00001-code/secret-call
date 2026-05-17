module.exports = {
  apps: [
    {
      name: "secret-room-server",
      cwd: "/www/wwwroot/secret-room/apps/server",
      script: "dist/index.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: "3101",
        HOST: "127.0.0.1",
        ROOM_TTL_MS: "86400000",
        ROOM_SUSPENDED_TTL_MS: "7200000",
        MESSAGE_TTL_MS: "7200000",
        BURNED_ID_TTL_MS: "7200000",
        CLIENT_TIMEOUT_MS: "35000"
      }
    },
    {
      name: "secret-room-web",
      cwd: "/www/wwwroot/secret-room/apps/web",
      script: "node_modules/next/dist/bin/next",
      args: "start --port 3100 --hostname 127.0.0.1",
      interpreter: "node",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
