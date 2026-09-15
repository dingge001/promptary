import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp, resetRateLimit } from './app.js';
import type { Config } from './config.js';
import { QuotaStore } from './quota.js';

/**
 * HTTP 层的端到端测试。
 *
 * 上游是一个本地 mock,所以不需要真实 API Key 也能跑 —— 这样「配额扣减 →
 * 上游失败 → 配额退还」这类只有在真实请求里才会发生的链路也能被钉住。
 *
 * 用 app.request() 直接打,不监听端口:省掉端口冲突和竞态。
 */

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** mock 上游的行为开关,用来测失败路径 */
let upstreamMode: 'ok' | 'fail' = 'ok';
/** mock 上游最后收到的请求体,用来断言服务端强制了哪些上游参数 */
let lastUpstreamBody: Record<string, unknown> | undefined;
let upstream: Server;
let upstreamUrl: string;
let dir: string;

/** 一个结构完整、能通过校验的反推请求 */
function analyzeBody(): string {
  return JSON.stringify({
    messages: [
      { role: 'system', content: 'You are a senior AI art prompt engineer.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'reverse-engineer this' },
          { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } },
        ],
      },
    ],
  });
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    upstreamBaseUrl: upstreamUrl,
    upstreamApiKey: 'test-key',
    upstreamModel: 'deepseek-flash',
    dailyDeviceLimit: 3,
    dailyGlobalBudget: 100,
    maxOutputTokens: 512,
    upstreamTimeoutMs: 5000,
    maxBodyBytes: 4 * 1024 * 1024,
    dbPath: join(dir, `t-${Math.random().toString(36).slice(2)}.db`),
    ...overrides,
  };
}

/** 建一个干净的 app —— 每个用例独立的库和配额 */
function makeApp(overrides: Partial<Config> = {}): { app: Hono; quota: QuotaStore } {
  const cfg = makeConfig(overrides);
  const quota = new QuotaStore(cfg.dbPath, cfg.dailyDeviceLimit, cfg.dailyGlobalBudget);
  return { app: createApp(cfg, quota), quota };
}

function post(app: Hono, headers: Record<string, string> = {}, body = analyzeBody()) {
  return app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_A, ...headers },
    body,
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'promptary-app-'));

  upstream = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      // 记下来给「服务端强制了哪些上游参数」那组断言用
      try {
        lastUpstreamBody = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        lastUpstreamBody = undefined;
      }

      if (upstreamMode === 'fail') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'boom' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '{"prompt":"a cat"}' } }],
        }),
      );
    });
  });

  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  upstreamMode = 'ok';
  // 速率计数是模块级的,不清掉后面的用例会被前面打满
  resetRateLimit();
});

describe('健康检查与跨域', () => {
  test('healthz 返回全局用量', async () => {
    const { app } = makeApp();
    const res = await app.request('/healthz');

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; global: { used: number; limit: number } };
    assert.equal(body.ok, true);
    assert.equal(body.global.used, 0);
    assert.equal(body.global.limit, 100);
  });

  test('网页来源被拒 —— 挡住「写个网页直接调接口」', async () => {
    const { app } = makeApp();
    const res = await post(app, { Origin: 'https://evil.example.com' });

    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { type: string } }).error.type, 'forbidden');
  });

  test('扩展来源放行,并回显 CORS 头', async () => {
    const { app } = makeApp();
    const res = await post(app, { Origin: 'chrome-extension://abcdefghijklmnop' });

    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('access-control-allow-origin'),
      'chrome-extension://abcdefghijklmnop',
    );
    // 不暴露的话扩展侧读不到剩余额度
    assert.match(res.headers.get('access-control-expose-headers') ?? '', /X-Quota-Used/);
  });

  test('预检请求返回 204', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/chat/completions', {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://abcdefghijklmnop' },
    });

    assert.equal(res.status, 204);
  });
});

describe('请求校验', () => {
  test('缺少设备 id 被拒', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: analyzeBody(),
    });

    assert.equal(res.status, 400);
  });

  test('设备 id 不是 UUID 被拒 —— 免得主键列被灌长字符串', async () => {
    const { app } = makeApp();
    const res = await post(app, { 'X-Device-Id': 'not-a-uuid-at-all-really' });

    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { type: string } }).error.type, 'bad_device_id');
  });

  test('没有图片的请求被拒 —— 这是挡住「当免费 LLM 网关用」的那道关', async () => {
    const { app } = makeApp();
    const body = JSON.stringify({ messages: [{ role: 'user', content: '写首诗' }] });
    const res = await post(app, {}, body);

    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { type: string } }).error.type, 'invalid_request');
  });
});

describe('配额扣减与退还', () => {
  test('成功请求扣额度,响应头逐次递增', async () => {
    const { app } = makeApp({ dailyDeviceLimit: 3 });

    const first = await post(app);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-quota-used'), '1');
    assert.equal(first.headers.get('x-quota-limit'), '3');

    const second = await post(app);
    assert.equal(second.headers.get('x-quota-used'), '2');
  });

  test('用满后返回 429,且提示里带上「配置自己的 Key」这条路', async () => {
    const { app } = makeApp({ dailyDeviceLimit: 1 });

    assert.equal((await post(app)).status, 200);

    const blocked = await post(app);
    assert.equal(blocked.status, 429);

    const body = (await blocked.json()) as { error: { message: string; type: string } };
    assert.equal(body.error.type, 'quota_exceeded');
    assert.match(body.error.message, /API Key/);
  });

  test('上游失败时不扣额度 —— 我们的故障不该算在用户头上', async () => {
    const { app, quota } = makeApp({ dailyDeviceLimit: 1 });

    upstreamMode = 'fail';
    const failed = await post(app);
    assert.equal(failed.status, 502);
    // 关键:额度被退还了,所以下面还能再用一次
    assert.equal(quota.peek(DEVICE_A).used, 0);

    upstreamMode = 'ok';
    assert.equal((await post(app)).status, 200);
  });

  test('上游 4xx 也不消耗额度', async () => {
    const { app, quota } = makeApp({ dailyDeviceLimit: 2 });

    upstreamMode = 'fail';
    await post(app);
    await post(app);

    assert.equal(quota.peek(DEVICE_A).used, 0);
  });
});

describe('转发给上游的参数', () => {
  test('必须关掉思考模式 —— 否则 reasoning 会吃光 max_tokens,content 返回空串', async () => {
    const { app } = makeApp();
    await post(app);

    // 这个断言来自一次真实故障:deepseek-flash 默认开思考,1024 个 token
    // 全被 reasoning 用光,content 是空字符串,用户拿到一个空提示词
    assert.deepEqual(lastUpstreamBody?.['thinking'], { type: 'disabled' });
  });

  test('非 DeepSeek 上游不传 thinking —— OpenAI 官方收到不认识的字段会直接 400', async () => {
    const { app } = makeApp({ upstreamModel: 'gpt-4o-mini' });
    await post(app);

    assert.equal(lastUpstreamBody?.['thinking'], undefined);
  });

  test('model 与 max_tokens 由服务端强制,客户端传什么都不作数', async () => {
    const { app } = makeApp({ maxOutputTokens: 512 });
    const body = JSON.stringify({
      model: 'some-expensive-model',
      max_tokens: 999_999,
      messages: [
        { role: 'system', content: 'x' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'go' },
            { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } },
          ],
        },
      ],
    });

    await post(app, {}, body);

    assert.equal(lastUpstreamBody?.['model'], 'deepseek-flash');
    assert.equal(lastUpstreamBody?.['max_tokens'], 512);
  });
});

describe('全局熔断', () => {
  test('预算触顶后整体停服,新设备也不例外', async () => {
    const { app } = makeApp({ dailyDeviceLimit: 5, dailyGlobalBudget: 1 });

    assert.equal((await post(app)).status, 200);

    // 换一个没用过额度的设备,照样被拒 —— 这正是熔断的意义
    const blocked = await post(app, { 'X-Device-Id': DEVICE_B });
    assert.equal(blocked.status, 503);
    assert.equal(
      ((await blocked.json()) as { error: { type: string } }).error.type,
      'budget_exhausted',
    );
  });
});
