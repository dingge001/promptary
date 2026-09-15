import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * 每日配额。
 *
 * 两张表分别管「单个设备」和「全局总预算」。后者是防破产的最后一道闸:
 * 设备 id 由客户端生成,重装扩展就能换一个,单靠它挡不住有心的人 ——
 * 全局预算一旦触顶就整体停服,把最坏情况的账单锁死在一个已知的数上。
 *
 * 为什么用 SQLite 而不是 Redis:单机、每天几千次的量级、按自然日重置。
 * 用 Node 24 内置的 node:sqlite 而非 better-sqlite3,是为了彻底甩掉原生模块 ——
 * 部署时不必在服务器上装 build-essential,也避开了 Node 版本更新后
 * 预编译二进制跟不上的坑。代价是 Node 必须 22.5 以上。
 */

/** 日界按东八区算 —— 用户看到「明天再来」时,指的应该是他自己的明天 */
const DAY_MS = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 自然日标识,形如 2026-09-15(东八区) */
function dayKey(now: number): string {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 下一次额度刷新的时刻(毫秒时间戳),即东八区次日零点 */
function nextResetAt(now: number): number {
  const shifted = now + TZ_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS - TZ_OFFSET_MS;
}

export interface QuotaSnapshot {
  used: number;
  limit: number;
  /** 额度重置时刻(毫秒时间戳) */
  resetAt: number;
}

export type ConsumeResult =
  | { ok: true; snapshot: QuotaSnapshot }
  /** device = 这个设备今天的额度用完了;global = 全站预算触顶,今天谁都别用了 */
  | { ok: false; reason: 'device' | 'global'; snapshot: QuotaSnapshot };

interface UsedRow {
  used: number;
}

/**
 * 事务包装。
 *
 * node:sqlite 没有 better-sqlite3 那样的 transaction() 辅助函数,只能自己写。
 * BEGIN IMMEDIATE 而不是 BEGIN:立刻拿写锁,避免两个请求同时读到旧值再各自加一,
 * 那正是配额超发的经典成因。
 */
function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export class QuotaStore {
  private readonly db: DatabaseSync;
  private readonly deviceLimit: number;
  private readonly globalBudget: number;

  constructor(dbPath: string, deviceLimit: number, globalBudget: number) {
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new DatabaseSync(dbPath);
    this.deviceLimit = deviceLimit;
    this.globalBudget = globalBudget;

    // WAL 让写不必等待读事务,并发下响应更稳
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_quota (
        day       TEXT    NOT NULL,
        device_id TEXT    NOT NULL,
        used      INTEGER NOT NULL,
        PRIMARY KEY (day, device_id)
      );
      CREATE TABLE IF NOT EXISTS global_quota (
        day  TEXT    PRIMARY KEY,
        used INTEGER NOT NULL
      );
    `);

    this.pruneOldDays();
  }

  /**
   * 扣一次额度。检查与扣减在同一个事务里完成,不存在「检查通过后被并发超发」的窗口。
   *
   * 注意顺序:先判全局再判个人。全局触顶时连还没用过额度的用户也一并拒绝 ——
   * 这正是熔断的意义,不能因为「他还没用」就放行,否则预算永远兜不住。
   */
  consume(deviceId: string, now = Date.now()): ConsumeResult {
    const day = dayKey(now);
    const resetAt = nextResetAt(now);

    return transaction(this.db, (): ConsumeResult => {
      const global = this.db
        .prepare('SELECT used FROM global_quota WHERE day = ?')
        .get(day) as UsedRow | undefined;
      const globalUsed = global?.used ?? 0;

      if (globalUsed >= this.globalBudget) {
        return {
          ok: false,
          reason: 'global',
          snapshot: { used: globalUsed, limit: this.globalBudget, resetAt },
        };
      }

      const device = this.db
        .prepare('SELECT used FROM device_quota WHERE day = ? AND device_id = ?')
        .get(day, deviceId) as UsedRow | undefined;
      const deviceUsed = device?.used ?? 0;

      if (deviceUsed >= this.deviceLimit) {
        return {
          ok: false,
          reason: 'device',
          snapshot: { used: deviceUsed, limit: this.deviceLimit, resetAt },
        };
      }

      this.db
        .prepare(
          `INSERT INTO device_quota (day, device_id, used) VALUES (?, ?, 1)
           ON CONFLICT(day, device_id) DO UPDATE SET used = used + 1`,
        )
        .run(day, deviceId);

      this.db
        .prepare(
          `INSERT INTO global_quota (day, used) VALUES (?, 1)
           ON CONFLICT(day) DO UPDATE SET used = used + 1`,
        )
        .run(day);

      return {
        ok: true,
        snapshot: { used: deviceUsed + 1, limit: this.deviceLimit, resetAt },
      };
    });
  }

  /**
   * 退还一次额度。上游调用失败时用 —— 我们自己出问题不该算在用户头上。
   *
   * 先扣后调、失败再退,而不是调完才扣:后者在并发下会有「检查通过后一起放行」
   * 的超发窗口,而配额超发是要真金白银买单的。
   */
  refund(deviceId: string, now = Date.now()): void {
    const day = dayKey(now);

    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE device_quota SET used = MAX(0, used - 1)
           WHERE day = ? AND device_id = ?`,
        )
        .run(day, deviceId);

      this.db
        .prepare('UPDATE global_quota SET used = MAX(0, used - 1) WHERE day = ?')
        .run(day);
    });
  }

  /** 查当前额度,不扣减。用于客户端展示「今天还剩几次」 */
  peek(deviceId: string, now = Date.now()): QuotaSnapshot {
    const day = dayKey(now);
    const row = this.db
      .prepare('SELECT used FROM device_quota WHERE day = ? AND device_id = ?')
      .get(day, deviceId) as UsedRow | undefined;

    return {
      used: row?.used ?? 0,
      limit: this.deviceLimit,
      resetAt: nextResetAt(now),
    };
  }

  /** 全局今日用量。健康检查用,也方便排查「是不是被刷了」 */
  globalUsage(now = Date.now()): { used: number; limit: number; resetAt: number } {
    const day = dayKey(now);
    const row = this.db
      .prepare('SELECT used FROM global_quota WHERE day = ?')
      .get(day) as UsedRow | undefined;

    return {
      used: row?.used ?? 0,
      limit: this.globalBudget,
      resetAt: nextResetAt(now),
    };
  }

  /**
   * 清掉 7 天前的记录。
   *
   * 配额只用得上今天这一行,留一周是为了出问题时能回头查;再老的没有价值,
   * 只会让表无限长大。启动时扫一次就够,不必定时任务。
   *
   * day 是 'YYYY-MM-DD',字典序即时间序,所以直接字符串比较就行。
   */
  private pruneOldDays(): void {
    const cutoff = dayKey(Date.now() - 7 * DAY_MS);
    this.db.prepare('DELETE FROM device_quota WHERE day < ?').run(cutoff);
    this.db.prepare('DELETE FROM global_quota WHERE day < ?').run(cutoff);
  }
}
