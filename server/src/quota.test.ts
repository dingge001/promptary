import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { QuotaStore } from './quota.js';

/**
 * 配额逻辑的测试。
 *
 * 这段代码直接对应真金白银,而且是「出错了也不会有人立刻发现」的那种错误 ——
 * 计多了用户被冤枉,计少了账单会上涨。所以日界、退还、熔断三个地方都要钉住。
 *
 * 时间戳全部显式注入(consume 的第二个参数),不依赖运行时的当前时间。
 */

const DEVICE = '11111111-1111-4111-8111-111111111111';
let dir: string;

/** 每个用例一个干净的库,避免互相污染 */
function freshStore(deviceLimit = 3, globalBudget = 100): QuotaStore {
  return new QuotaStore(join(dir, `q-${Math.random().toString(36).slice(2)}.db`), deviceLimit, globalBudget);
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'promptary-quota-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('设备配额', () => {
  test('用满限额后拒绝,且返回正确的快照', () => {
    const store = freshStore(3);

    assert.equal(store.consume(DEVICE).ok, true);
    assert.equal(store.consume(DEVICE).ok, true);

    const third = store.consume(DEVICE);
    assert.equal(third.ok, true);
    assert.deepEqual(
      { used: third.snapshot.used, limit: third.snapshot.limit },
      { used: 3, limit: 3 },
    );

    const fourth = store.consume(DEVICE);
    assert.equal(fourth.ok, false);
    assert.equal(fourth.ok === false && fourth.reason, 'device');
  });

  test('不同设备互不影响', () => {
    const store = freshStore(1);
    assert.equal(store.consume('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').ok, true);
    assert.equal(store.consume('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb').ok, true);
  });

  test('退还后可以再用一次', () => {
    const store = freshStore(1);
    assert.equal(store.consume(DEVICE).ok, true);
    assert.equal(store.consume(DEVICE).ok, false);

    // 模拟上游失败后退还 —— 我们自己的故障不该算在用户头上
    store.refund(DEVICE);
    assert.equal(store.consume(DEVICE).ok, true);
  });

  test('退还不会把计数压成负数', () => {
    const store = freshStore(3);
    store.refund(DEVICE);
    store.refund(DEVICE);

    const peeked = store.peek(DEVICE);
    assert.equal(peeked.used, 0);
  });
});

describe('全局预算熔断', () => {
  test('预算耗尽后,没用过额度的新设备也一并拒绝', () => {
    const store = freshStore(3, 2);

    assert.equal(store.consume('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').ok, true);
    assert.equal(store.consume('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb').ok, true);

    // 关键行为:熔断是全局的,不认识「你还没用过」这回事
    const blocked = store.consume('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.ok === false && blocked.reason, 'global');
  });

  test('熔断优先于设备配额判断', () => {
    const store = freshStore(1, 1);
    store.consume(DEVICE); // 用掉唯一的全局额度

    // 同一个设备既超了个人额度也撞上熔断,应当报 global —— 因为它更严重
    const blocked = store.consume(DEVICE);
    assert.equal(blocked.ok === false && blocked.reason, 'global');
  });
});

describe('日界', () => {
  /** 东八区 2026-09-15 23:59 */
  const beforeMidnight = Date.UTC(2026, 8, 15, 15, 59);
  /** 东八区 2026-09-16 00:01 */
  const afterMidnight = Date.UTC(2026, 8, 15, 16, 1);

  test('跨过东八区零点后额度重置', () => {
    const store = freshStore(1);

    assert.equal(store.consume(DEVICE, beforeMidnight).ok, true);
    assert.equal(store.consume(DEVICE, beforeMidnight).ok, false);
    assert.equal(store.consume(DEVICE, afterMidnight).ok, true);
  });

  test('重置时刻落在东八区次日零点', () => {
    const store = freshStore(1);
    const snapshot = store.peek(DEVICE, beforeMidnight);

    assert.equal(new Date(snapshot.resetAt).toISOString(), '2026-09-15T16:00:00.000Z');
  });

  test('跨天后全局预算也重置', () => {
    const store = freshStore(1, 1);

    assert.equal(store.consume(DEVICE, beforeMidnight).ok, true);
    assert.equal(store.consume('dddddddd-dddd-4ddd-8ddd-dddddddddddd', beforeMidnight).ok, false);
    assert.equal(store.consume('dddddddd-dddd-4ddd-8ddd-dddddddddddd', afterMidnight).ok, true);
  });
});
