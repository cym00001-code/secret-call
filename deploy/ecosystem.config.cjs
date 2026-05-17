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
        HOST: "127.0.0.1"
      }
    },
    {
      name: "secret-room-web",
      cwd: "/www/wwwroot/secret-room/apps/web",
      script: "../../node_modules/next/dist/bin/next",
      args: "start --port 3100 --hostname 127.0.0.1",
      interpreter: "node",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
