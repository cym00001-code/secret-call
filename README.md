# secret-room

无账号双人密聊网站 MVP。两个人输入相同的房间号和房间口令后，才能唤醒同一个临时房间。房间最多两人，服务端只负责匹配房间和转发密文。

## 功能

- 无注册、无登录、无昵称、无头像、无好友关系
- 双人临时房间，第三人只能看到模糊提示
- 浏览器端 ECDH + HKDF + AES-GCM 端到端加密
- 服务端不接触口令、psk、sessionKey、ECDH privateKey 和明文消息
- 每条消息独立随机 IV，AAD 使用固定字段顺序的稳定二进制编码
- 阅后即焚基于 `message:seen` 事件触发，默认 30 秒，可选 5/10/30/60 秒
- 页面失焦自动模糊聊天内容，支持手动隐藏窗口
- IP 仅用于内存风控，不展示给用户，不写入永久数据库

## 项目结构

```text
secret-room/
  apps/
    web/       Next.js + TypeScript + Tailwind CSS
    server/    Node.js + Fastify + ws
  deploy/
    ecosystem.config.cjs
    nginx.secret-room.example.conf
  package.json
  pnpm-workspace.yaml
  .env.example
  README.md
```

## 本地安装

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
```

如果当前 Node 环境没有 `corepack` 命令，可以使用：

```bash
npx -y pnpm@9.15.4 install
```

本地开发可以使用 HTTP/WS：

```bash
pnpm dev
```

默认地址：

- Web: <http://localhost:3100>
- Server health: <http://localhost:3101/health>
- WebSocket: `ws://localhost:3101/ws`

也可以分开运行：

```bash
pnpm dev:server
pnpm dev:web
```

## 本地测试两个浏览器

1. 打开两个浏览器窗口，访问 <http://localhost:3100>。
2. 两边输入相同的房间号和房间口令。
3. 第一个窗口会显示“等待另一端唤醒房间”。
4. 第二个窗口进入后，双方进入聊天界面，并显示相同的安全码。
5. 通过其他可信渠道核对安全码。
6. 任意一方发送文本消息。对方成功解密后会触发 `message:seen`，双方开始倒计时。
7. 倒计时结束后触发 `message:burn`，双方界面删除该消息。
8. 打开第三个窗口输入相同信息，只会看到“房间暂不可用”。
9. 切到其他窗口或隐藏浏览器，聊天内容会自动模糊。

## 检查命令

```bash
pnpm lint
pnpm typecheck
pnpm build
```

没有全局 pnpm 时，把命令前缀换成 `npx -y pnpm@9.15.4`。

## 环境变量

复制示例文件：

```bash
cp .env.example .env
```

生产环境必须设置一个足够长的 `IP_HASH_SECRET`。不要把真实 `.env`、服务器密码、SSH 私钥、GitHub token 或任何真实凭证提交到仓库。

## 加密设计

浏览器根据房间号和口令派生：

- `psk`: 使用 PBKDF2-SHA256 从口令和房间号派生，只存在浏览器内存
- `roomIdHash`: 从房间号和 `psk` 派生，可发送服务端，仅用于房间匹配

双方进入房间后：

1. 每端生成临时 ECDH P-256 密钥对。
2. 服务端只转发双方临时公钥。
3. 浏览器端通过 ECDH 得到 `sharedSecret`。
4. 使用 HKDF 生成 AES-GCM 会话密钥：

```text
ikm = ECDH sharedSecret
salt = psk
info = encodeFrame(["secret-room-v1", roomIdHash, sortedPublicKeyA, sortedPublicKeyB])
```

双方公钥按字符串字典序排序后参与 transcript 和安全码生成，确保两端安全码一致。

每条消息：

- 使用 AES-GCM
- 使用独立随机 96-bit IV
- AAD 使用固定字段顺序：

```text
encodeFrame(["sr-aad-v1", roomIdHash, messageId, senderClientId, burnAfterMs, createdAt])
```

`encodeFrame` 对每个字段写入 `uint32be length + utf8 bytes`，不使用普通对象随意 stringify。

## WebSocket 事件

已实现事件：

- `room:join`
- `room:waiting`
- `room:active`
- `room:unavailable`
- `message:send`
- `message:receive`
- `message:seen`
- `message:burn`
- `peer:left`
- `room:destroy`
- `room:destroyed`
- `error`
- `ping`
- `pong`

## IP 风控

服务端只在内存中使用短期风险标识：

```text
ipRiskHash = HMAC-SHA256(IP_HASH_SECRET, ip + yyyy-mm-dd)
```

限制：

- 同一 `ipRiskHash` 每分钟最多尝试进入 20 次房间
- 同一 `ipRiskHash` 每分钟最多发送 60 条消息
- 同一 `ipRiskHash` 每 10 秒最多尝试唤醒 5 个不同 `roomIdHash`

日志只允许记录事件类型、`roomIdHash` 前 8 位、`clientId` 前 8 位、错误类型和风控结果。不要记录完整 IP、完整 payload、口令、明文消息或密钥。

## 云服务器部署

生产环境必须使用 HTTPS/WSS。不要用纯 HTTP/WS 暴露公网服务。

建议目录：

```bash
/www/wwwroot/secret-room
```

部署步骤示例：

```bash
cd /www/wwwroot/secret-room
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm build

cp .env.example .env
# 编辑 .env，设置真实 IP_HASH_SECRET

pm2 start deploy/ecosystem.config.cjs
pm2 save
```

Nginx：

1. 先为你的域名签发有效 TLS 证书，例如使用 acme.sh、Certbot 或宝塔面板。
2. 参考 `deploy/nginx.secret-room.example.conf`。
3. `/` 代理到 `127.0.0.1:3100`。
4. `/ws` 代理到 `127.0.0.1:3101/ws`，必须保留 `Upgrade` 和 `Connection` 头。
5. 将 HTTP 自动跳转到 HTTPS。

宝塔 Nginx 常见重载命令：

```bash
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
```

## Git 备份

首次初始化：

```bash
git init
git branch -M main
git remote add origin https://github.com/cym00001-code/secret-call.git
git add .
git commit -m "feat: implement secret-room mvp"
git push -u origin main
```

不要把任何 token、SSH 私钥、服务器密码、真实 `.env` 提交到仓库。

## 安全边界与已知限制

- MVP 不做数据库和聊天记录持久化，服务重启会清空所有房间。
- 服务端仍可拒绝连接、丢弃消息、延迟消息或替换临时公钥；请务必核对安全码。未核对安全码时，恶意服务端理论上可以中间人攻击。
- 弱房间口令可能被不可信服务端离线猜测；请使用高强度口令。
- 阅后即焚只能删除双方界面的本地消息，不能阻止截图、录屏、拍照或恶意客户端保存明文。
- 当前 MVP 只支持文本消息，不支持图片、文件、语音、账号、好友、群聊、历史记录或管理后台。
- 生产公网必须配置有效 TLS；仅本地开发允许 `localhost` 使用 HTTP/WS。

## 下一步建议

- 引入 PAKE/OPAQUE，降低弱口令离线猜测风险。
- 加入 CSP、COOP/COEP 等更严格的浏览器安全头。
- 增加 Playwright 端到端测试，覆盖双窗口、第三人、限流、断线和倒计时销毁。
- 增加可观测性指标，但继续禁止记录明文、完整 payload、完整 IP 和密钥材料。
