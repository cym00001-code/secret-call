# secret-room

无账号双人密聊网站 MVP V2。两个人输入相同房间号和房间口令后，会进入同一个临时房间。服务端不接触明文，不保存口令和密钥，只短期保存未焚毁的密文与必要状态，用于断线、刷新、重新进入后的恢复。

## 技术栈

- Frontend: Next.js + TypeScript + Tailwind CSS
- Backend: Node.js + Fastify
- Realtime: `ws` WebSocket
- Crypto: Web Crypto API
- Storage: 内存 `Map`
- Rate Limit: IP HMAC 哈希 + 内存滑动窗口
- Deploy: Nginx + PM2

## V2 变化

V1 使用临时 ECDH 会话密钥，刷新后无法恢复会话。V2 改为浏览器端根据房间号和口令派生长期 `roomMessageKey`：

- 用户刷新或关闭页面后，本地内存密钥和明文自然丢失。
- 用户重新输入相同房间号和口令后，会重新派生同一个 `roomMessageKey`。
- 服务端返回尚未焚毁、未过期的密文历史。
- 浏览器用重新派生的 `roomMessageKey` 解密恢复。
- 手动销毁、TTL 过期、服务端重启后不可恢复。

## 安全边界

- 服务端不保存明文。
- 服务端不保存原始房间号、原始口令、`roomMessageKey`、`baseKey`、`psk/sessionKey/privateKey`。
- 服务端短期保存密文、IV、AAD、消息 ID、发送方临时 clientId、焚毁时间和投递状态。
- `roomIdHash` 只用于房间匹配。
- 明文和密钥只存在浏览器内存中，不写入 `localStorage`、`sessionStorage`、IndexedDB 或 cookie。
- IP 只用于风控，不展示给用户，不返回前端，不和聊天内容绑定持久保存。
- 弱口令存在被离线猜测的风险。请使用较长、随机、不容易猜的口令。
- 本项目不适合高强度对抗场景。
- 无法阻止截图或拍屏。
- 服务端重启会丢失内存房间，这是 MVP 限制。
- 手动销毁后无法恢复。
- 已焚毁消息不恢复。

## 加密方案

浏览器端派生：

1. `normalizedRoomNumber = roomNumber.trim().normalize("NFKC")`
2. `normalizedPassphrase = passphrase.trim().normalize("NFKC")`
3. `inputMaterial = normalizedRoomNumber + ":" + normalizedPassphrase`
4. `baseBits = PBKDF2(inputMaterial, salt = "secret-room-v2:" + normalizedRoomNumber, SHA-256, 250000 iterations)`
5. `roomIdHash = SHA-256("room-id:v2" + derived room id material)`
6. `roomMessageKey = AES-GCM key derived from baseBits with purpose "message-key:v2"`
7. `securityCode = short fingerprint(roomMessageKey fingerprint + roomIdHash)`

每条消息：

- AES-GCM 加密。
- 每条消息使用独立随机 96-bit IV。
- AAD 使用固定字段顺序的稳定二进制序列化，不使用普通对象 `JSON.stringify`。
- AAD 字段：`version`、`roomIdHash`、`messageId`、`senderClientId`、`burnAfterMs`、`createdAt`。

稳定序列化格式：每个字段为 UTF-8 编码，并写入 `uint32be length + bytes`。

## 房间生命周期

- `waiting`：第一个人进入，等待另一端。
- `active`：双方在线。
- `peer_offline`：一方离开，另一方仍在线，房间和未焚毁密文保留。
- `suspended`：双方都离线，房间短期保留。
- `destroyed`：任意一方二次确认销毁后，服务端立即删除房间、clients、pending 密文、状态和 burned id。
- `expired`：TTL 到期后服务端清理。

V2 不再因为一方离开就销毁房间。

默认 TTL：

- 房间最大存活时间：24 小时。
- 双方都离线后保留：2 小时。
- 未焚毁密文最多保留：2 小时。
- 已焚毁消息立即从 pending 中删除。
- burned message id 短期保留：2 小时，用于避免重复恢复。

## 消息状态机

客户端消息状态：

- `sending`：正在发送。
- `server_ack`：服务端已收到。
- `stored`：服务端已暂存密文。
- `delivered`：对方客户端已收到密文。
- `decrypted`：对方客户端已成功解密。
- `visible`：对方页面可见且消息已渲染。
- `seen`：对方确认看见。
- `burning`：焚毁倒计时中。
- `burned`：已焚毁。
- `failed`：发送失败。
- `peer_offline`：对方离线，等待其重新进入。
- `undecryptable`：无法解密。

## 阅后即焚

1. A 发送密文消息。
2. 服务端返回 `message:server_ack`，并把密文保存到 `pendingMessages`。
3. 如果 B 在线，服务端转发 `message:receive`。
4. 如果 B 离线，消息保持 pending，不触发 seen，不触发倒计时。
5. B 收到密文后发送 `message:delivered`。
6. B 解密成功后发送 `message:decrypted`。
7. B 只有在消息已渲染、页面可见、没有隐藏窗口遮罩、房间为 `active` 且 WebSocket 有效时，才发送 `message:visible` 和 `message:seen`。
8. 双方收到 `message:seen` 后开始倒计时。
9. 倒计时结束后客户端发送 `message:burn`。
10. 服务端广播 `message:burn`，并从 `pendingMessages` 删除消息。

## WebSocket 事件

客户端发送：

- `room:join`
- `room:leave`
- `room:destroy`
- `room:sync`
- `message:send`
- `message:delivered`
- `message:decrypted`
- `message:visible`
- `message:seen`
- `message:burn`
- `ping`

服务端发送：

- `room:waiting`
- `room:active`
- `room:peer_offline`
- `room:suspended`
- `room:resumed`
- `room:destroyed`
- `room:expired`
- `room:unavailable`
- `room:sync`
- `message:server_ack`
- `message:receive`
- `message:history`
- `message:delivered`
- `message:decrypted`
- `message:visible`
- `message:seen`
- `message:burn`
- `message:failed`
- `peer:left`
- `peer:reconnected`
- `error`
- `pong`

`message:history` 只包含未焚毁、未过期的密文消息，不包含明文、口令、密钥、IP 或设备信息。

## IP 风控

服务端使用：

```text
ipRiskHash = HMAC-SHA256(IP_HASH_SECRET, ip + yyyy-mm-dd)
```

限制：

- 同一 `ipRiskHash` 每分钟最多尝试进入 20 次房间。
- 同一 `ipRiskHash` 每分钟最多发送 60 条消息。
- 同一 `ipRiskHash` 每 10 秒最多尝试唤醒 5 个不同 `roomIdHash`。

日志只记录事件类型、`roomIdHash/clientId/messageId` 前 8 位、状态变化、错误类型和风控结果。禁止记录完整 payload、完整密文、IV、AAD、明文、口令、密钥和完整 IP。

## 本地运行

在项目根目录运行：

```bash
corepack enable
pnpm install
pnpm dev
```

也可以分别启动：

```bash
pnpm dev:server
pnpm dev:web
```

默认端口：

- Web: `http://localhost:3100`
- Server: `ws://localhost:3101/ws`

## 本地测试

1. 打开两个浏览器窗口访问 `http://localhost:3100`。
2. 输入相同房间号和口令。
3. 第一个窗口显示“等待另一端唤醒房间”。
4. 第二个窗口进入后双方显示“双方面在线”。
5. 第三个窗口输入同房间号和口令，只看到“房间暂不可用”。
6. 一方关闭页面，另一方显示“对方已离线，房间仍保留”。
7. 在线方发送消息，状态应显示“对方离线，等待其重新进入”或“已暂存”。
8. 离线方重新输入相同房间号和口令，应恢复未焚毁密文并解密。
9. 页面切到后台或点击“隐藏窗口”时，不应触发已看见回执。
10. 页面重新可见后，已渲染的对方消息才会触发焚毁倒计时。
11. 倒计时结束后双方删除消息，重进后不再恢复。
12. 点击“销毁房间”，输入“销毁”二次确认后，房间不可恢复。

## 检查命令

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` 会启动本地 web/server，并用真实 Chromium 浏览器覆盖双人加入、第三人模糊拒绝、刷新恢复未焚毁密文、隐藏窗口不触发 seen。

## 环境变量

复制 `.env.example` 到服务器环境，不要提交真实 secret。

```bash
PORT=3101
HOST=0.0.0.0
IP_HASH_SECRET=replace-with-a-long-random-secret
ROOM_TTL_MS=86400000
ROOM_SUSPENDED_TTL_MS=7200000
MESSAGE_TTL_MS=7200000
BURNED_ID_TTL_MS=7200000
CLIENT_TIMEOUT_MS=35000
NEXT_PUBLIC_WS_URL=wss://your-domain.example/ws
```

## 云服务器部署

生产环境必须使用 HTTPS/WSS。公网 HTTP 下浏览器通常不会开放 Web Crypto，用户会无法进入房间。

建议目录：

```bash
/www/wwwroot/secret-room
```

安装和构建：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

PM2：

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

Nginx：

1. `/` 代理到 `127.0.0.1:3100`。
2. `/ws` 代理到 `127.0.0.1:3101/ws`。
3. `/ws` 必须保留 `Upgrade` 和 `Connection` 头。
4. HTTP 自动跳转 HTTPS。

当前云服务器已使用 Let's Encrypt 可信 IP 地址证书：

- HTTPS: `https://8.138.150.200`
- WSS: `wss://8.138.150.200/ws`
- 旧 HTTP 入口 `http://8.138.150.200:39085` 会跳转到 HTTPS

Let's Encrypt IP 地址证书是短周期证书，有效期约 6 天。服务器已通过 Certbot 续期任务定期检查并在更新后重载 Nginx。正式上线仍建议绑定已备案域名并配置常规可信 CA 证书，方便长期运维和品牌访问。

## Git 备份

```bash
git status
git add .
git commit -m "feat: stabilize secret-room v2"
git push
```

不要提交 `.env`、GitHub token、SSH 私钥、服务器密码或任何真实凭证。

## 后续优化

- 引入 PAKE / OPAQUE，降低弱口令离线猜测风险。
- 引入 Argon2id WASM，并针对移动端做耗时自适应。
- 增加 Playwright 多窗口端到端测试。
- 增加更细的消息重传和断线自动重连策略。
- 在不泄露隐私的前提下增加运行指标。
