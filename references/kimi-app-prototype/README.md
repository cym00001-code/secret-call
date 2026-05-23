# Kimi App Prototype

这是用户用 Kimi 生成的独立 Vite/React 前端原型，已从仓库外层 `app/` 归档到这里。

定位：

- 只做视觉、布局、交互氛围参考。
- 不属于生产 `apps/web`。
- 不参与当前 workspace 构建、部署、发布。
- 不允许直接修改或替代 `useSecretRoom.ts`、`crypto.ts`、协议类型、服务端、测试选择器、消息状态机和阅后即焚逻辑。

如果要借用这里的设计：

1. 先确认对应功能在 `apps/web/` 的真实业务状态。
2. 只迁移表现层样式或组件思路。
3. 保留生产页面的安全逻辑、数据流和 `data-testid`。
4. 跑 `pnpm lint`、`pnpm typecheck`，涉及房间流程时跑 `pnpm test:e2e`。

本目录保留原型自身的 `package.json` 和 `package-lock.json`，用于必要时单独打开查看；不要把它接入根 `pnpm-workspace.yaml`。
