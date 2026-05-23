# Project Structure

本文件是后续协作的目录地图。新增功能前先看这里，避免把原型、产物、部署文件和生产代码混在一起。

## 主线代码

- `apps/web/`：生产 Web 前端，Next.js。房间页、密信页、加密逻辑、页面样式都在这里维护。
- `apps/server/`：生产服务端，Fastify + WebSocket。房间状态机、离线密信 API、限流和协议校验都在这里维护。
- `apps/mobile/`：Capacitor 移动端壳工程。Android/iOS 原生能力、打包配置和平台工程都在这里维护。
- `e2e/`：Playwright 端到端测试。涉及双人房间、第三人拒绝、阅后即焚、刷新恢复等流程时优先补这里。

## 发布与部署

- `scripts/`：固定发布入口。Android 发版使用 `pnpm release:android` 或 `.\scripts\release-android.ps1`。
- `deploy/`：PM2 和 Nginx 配置模板。只放部署配置，不放运行日志和服务器私密信息。
- `download/`：服务器 `/download` 静态页源文件。
- `download/releases/manifest.json`：下载页读取的版本清单，必须提交。
- `download/releases/*.apk`：本地发布产物，不提交 Git，只上传服务器。

## 参考资料

- `references/kimi-app-prototype/`：Kimi 生成的独立 Vite/React 前端原型，只作为视觉和交互参考。
- 参考原型不参与 workspace、lint、build、release，也不能直接接入协议、加密、状态机或服务端。
- 需要采用 Kimi 的设计时，只手工挑选表现层想法迁入 `apps/web/`，并保留现有骨架和测试选择器。

## 资产与数据

- `assets/`：项目级源资产，例如应用图标母版。
- `apps/web/public/`：Web 可直接访问的静态资源。
- `download/assets/`：下载页静态资源。
- `data/`：本地或服务器运行数据，不提交 Git。

## 根目录规则

- 根目录只放 workspace 配置、质量检查配置、全局文档和发布入口。
- 临时说明、交接草稿、测试截图、浏览器报告、构建产物不要放根目录。
- 凭据、签名文件、`.env`、服务器密码、私钥永远不提交。
