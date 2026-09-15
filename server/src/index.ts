import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { QuotaStore } from './quota.js';

/**
 * 入口。
 *
 * 只做三件事:读配置、建配额库、把 HTTP 层挂上去。所有逻辑都在 app.ts 里,
 * 因为它需要能被测试直接 import —— 这个文件一执行就会监听端口。
 */

const cfg = loadConfig();
const quota = new QuotaStore(cfg.dbPath, cfg.dailyDeviceLimit, cfg.dailyGlobalBudget);

serve({ fetch: createApp(cfg, quota).fetch, port: cfg.port, hostname: cfg.host }, (info) => {
  const global = quota.globalUsage();
  console.log(`[promptary-api] 监听 http://${cfg.host}:${info.port}`);
  console.log(`[promptary-api] 上游 ${cfg.upstreamModel} @ ${cfg.upstreamBaseUrl}`);
  console.log(
    `[promptary-api] 额度:每设备 ${cfg.dailyDeviceLimit} 次/天,全局预算 ${cfg.dailyGlobalBudget} 次/天`,
  );
  console.log(`[promptary-api] 今日已用 ${global.used}/${global.limit}`);
});
