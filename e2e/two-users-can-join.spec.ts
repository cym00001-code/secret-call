import { expect, test, type Browser, type Page } from "@playwright/test";

const joinRoom = async (page: Page, room: string, passphrase: string) => {
  await page.goto("/");
  await page.getByPlaceholder("输入房间号").fill(room);
  await page.getByPlaceholder("输入房间口令").fill(passphrase);
  await page.getByRole("button", { name: /唤醒房间/ }).click();
};

const joinTwoUsers = async (browser: Browser, room: string, passphrase: string) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await joinRoom(pageA, room, passphrase);
  await expect(pageA.getByText("等待另一端唤醒房间")).toBeVisible();
  await joinRoom(pageB, room, passphrase);
  await expect(pageA.getByText("双方在线")).toBeVisible();
  await expect(pageB.getByText("双方在线")).toBeVisible();

  return { contextA, contextB, pageA, pageB };
};

const readCountdownSeconds = async (page: Page) => {
  const text = await page.getByTestId("burn-countdown").last().innerText();
  return Number(text.replace("s", ""));
};

test("two users can join the same room without endless loading", async ({ browser }) => {
  const room = `test-room-001-${Date.now()}`;
  const passphrase = "test-pass-001";
  const { contextA, contextB, pageB } = await joinTwoUsers(browser, room, passphrase);
  await expect(pageB.getByText("正在唤醒")).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test("third user only sees an unavailable room", async ({ browser }) => {
  const contextC = await browser.newContext();
  const pageC = await contextC.newPage();
  const room = `test-room-third-${Date.now()}`;
  const passphrase = "test-pass-001";
  const { contextA, contextB } = await joinTwoUsers(browser, room, passphrase);

  await joinRoom(pageC, room, passphrase);
  await expect(pageC.getByRole("heading", { name: "房间暂不可用" })).toBeVisible();
  await expect(pageC.getByText("房间已满")).toHaveCount(0);
  await expect(pageC.getByText("房间不存在")).toHaveCount(0);

  await contextA.close();
  await contextB.close();
  await contextC.close();
});

test("refresh can restore an unburned encrypted message", async ({ browser }) => {
  const room = `test-room-refresh-${Date.now()}`;
  const passphrase = "test-pass-001";
  const secretText = "刷新恢复测试消息";
  const { contextA, contextB, pageA, pageB } = await joinTwoUsers(browser, room, passphrase);

  await pageA.getByPlaceholder("输入加密消息...").fill(secretText);
  await pageA.getByRole("button", { name: /发送/ }).click();
  await expect(pageB.getByText(secretText)).toHaveCount(0);
  await expect(pageB.getByText("点击确认查看并启动倒计时")).toBeVisible();

  await pageB.reload();
  await pageB.getByPlaceholder("输入房间号").fill(room);
  await pageB.getByPlaceholder("输入房间口令").fill(passphrase);
  await pageB.getByRole("button", { name: /唤醒房间/ }).click();
  await expect(pageB.getByText(secretText)).toHaveCount(0);
  await expect(pageB.getByText("点击确认查看并启动倒计时")).toBeVisible();

  await pageB.getByRole("button", { name: "确认查看消息并启动焚毁倒计时" }).click();
  await expect(pageB.getByText(secretText)).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test("received message does not start burn countdown until the receiver clicks it", async ({ browser }) => {
  const room = `test-room-hidden-${Date.now()}`;
  const passphrase = "test-pass-001";
  const secretText = "隐藏窗口测试消息";
  const { contextA, contextB, pageA, pageB } = await joinTwoUsers(browser, room, passphrase);

  await pageB.getByRole("button", { name: /隐藏/ }).click();
  await expect(pageB.getByText("窗口已隐藏")).toBeVisible();

  await pageA.getByPlaceholder("输入加密消息...").fill(secretText);
  await pageA.getByRole("button", { name: /发送/ }).click();
  await expect(pageA.getByText(/秒后焚毁/)).toHaveCount(0, { timeout: 3000 });

  await pageB.getByRole("button", { name: /恢复显示/ }).click();
  await expect(pageB.getByText(secretText)).toHaveCount(0);
  await expect(pageB.getByText("点击确认查看并启动倒计时")).toBeVisible();
  await expect(pageA.getByText(/秒后焚毁/)).toHaveCount(0, { timeout: 3000 });

  await pageB.getByRole("button", { name: "确认查看消息并启动焚毁倒计时" }).click();
  await expect(pageB.getByText(secretText)).toBeVisible();
  await expect(pageA.getByText(/秒后焚毁/)).toBeVisible();
  await expect(pageB.getByText(/秒后焚毁/)).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test("visible peer message also waits for an explicit click before burning", async ({ browser }) => {
  const room = `test-room-unfocused-visible-${Date.now()}`;
  const passphrase = "test-pass-001";
  const secretText = "失焦但可见测试消息";
  const { contextA, contextB, pageA, pageB } = await joinTwoUsers(browser, room, passphrase);

  await pageB.evaluate(() => window.dispatchEvent(new Event("blur")));
  await pageA.getByPlaceholder("输入加密消息...").fill(secretText);
  await pageA.getByRole("button", { name: /发送/ }).click();

  await expect(pageB.getByText(secretText)).toHaveCount(0);
  await expect(pageB.getByText("点击确认查看并启动倒计时")).toBeVisible();
  await expect(pageA.getByText(/秒后焚毁/)).toHaveCount(0, { timeout: 3000 });

  await pageB.getByRole("button", { name: "确认查看消息并启动焚毁倒计时" }).click();
  await expect(pageB.getByText(secretText)).toBeVisible();
  await expect(pageA.getByText(/秒后焚毁/)).toBeVisible();
  await expect(pageB.getByText(/秒后焚毁/)).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test("click reveal starts synced 5s burn countdown and deletes on both sides", async ({ browser }) => {
  const room = `test-room-synced-burn-${Date.now()}`;
  const passphrase = "test-pass-001";
  const secretText = `五秒同步删除-${Date.now()}`;
  const { contextA, contextB, pageA, pageB } = await joinTwoUsers(browser, room, passphrase);

  await pageA.getByRole("button", { name: "5s" }).click();
  await pageA.getByPlaceholder("输入加密消息...").fill(secretText);
  await pageA.getByRole("button", { name: /发送/ }).click();

  await expect(pageA.getByText(secretText)).toBeVisible();
  await expect(pageB.getByText(secretText)).toHaveCount(0);
  await expect(pageB.getByText("点击确认查看并启动倒计时")).toBeVisible();
  await expect(pageA.getByText(/秒后焚毁/)).toHaveCount(0, { timeout: 3000 });
  await expect(pageB.getByText(/秒后焚毁/)).toHaveCount(0, { timeout: 3000 });

  await pageB.getByRole("button", { name: "确认查看消息并启动焚毁倒计时" }).click();
  await expect(pageB.getByText(secretText)).toBeVisible();
  await expect(pageA.getByText(/秒后焚毁/)).toBeVisible();
  await expect(pageB.getByText(/秒后焚毁/)).toBeVisible();

  await expect
    .poll(async () => {
      const [leftA, leftB] = await Promise.all([readCountdownSeconds(pageA), readCountdownSeconds(pageB)]);
      return Math.abs(leftA - leftB);
    })
    .toBeLessThanOrEqual(1);

  await expect(pageA.getByText(secretText)).toHaveCount(0, { timeout: 7000 });
  await expect(pageB.getByText(secretText)).toHaveCount(0, { timeout: 7000 });
  await expect(pageA.getByText(/秒后焚毁/)).toHaveCount(0);
  await expect(pageB.getByText(/秒后焚毁/)).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});
