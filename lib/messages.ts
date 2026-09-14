import type { PromptFields } from './db/types';

/**
 * 待处理任务。
 *
 * 右键菜单和侧边栏之间不直接传参,而是通过 storage.session 中转 ——
 * 因为 chrome.sidePanel.open() 只能打开面板,没法带参数过去。
 * 用 session 而非 local,是为了让任务不落盘、浏览器重启即失效。
 */
export interface PendingTask {
  id: string;
  /** pick = 让侧边栏直接弹出本页图片选择界面 */
  kind: 'image' | 'text' | 'pick';
  /** 图片任务:页面上的图片地址 */
  imageUrl?: string;
  /** 文字任务:选中的文本 */
  text?: string;
  pageUrl?: string;
  pageTitle?: string;
  createdAt: number;
}

export const PENDING_TASK_KEY = 'promptary_pending_task';

/** 页面图片信息,由 content script 采集后交给侧边栏展示 */
export interface PageImage {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** 图片是否已真正加载。懒加载站点上未加载的图尺寸是按显示区估算的 */
  loaded?: boolean;
}

/** 发给 content script 的指令 */
export type TabCommand =
  | { type: 'collectImages' }
  | { type: 'insertPrompt'; text: string }
  /** 右键菜单触发的反推:交给页面内的结果面板执行 */
  | { type: 'analyzeInPage'; imageUrl: string };

// ---------------------- 页面内 UI ↔ 后台 ----------------------

export interface AnalyzeContext {
  imageUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
  /** 指定目标模型档案 id;不传则用设置里的默认模型 */
  modelId?: string;
}

/** 页面内反推成功后的回包数据 */
export interface AnalyzedPayload {
  fields: PromptFields;
  title: string;
  /** 本次用的目标模型档案 id,面板据此显示模型名 */
  modelId: string;
  sourceSite?: string;
}

export interface SavePayload extends AnalyzeContext {
  title: string;
  fields: PromptFields;
}

export interface BatchStartPayload {
  urls: string[];
  pageUrl?: string;
  pageTitle?: string;
}

/**
 * 批量反推任务的状态。
 *
 * 存在 storage.session 而不是内存里:MV3 的 Service Worker 会被空闲回收,
 * 内存里的任务状态说没就没;而且侧边栏也需要能读到它来显示进度。
 */
export interface BatchJob {
  id: string;
  status: 'running' | 'done' | 'cancelled' | 'error';
  total: number;
  done: number;
  saved: number;
  /** 失败的条目。最多保留 20 条,避免异常情况下把存储撑爆 */
  failed: { url: string; error: string }[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export const BATCH_JOB_KEY = 'promptary_batch_job';

/**
 * 发给后台的请求。
 *
 * 为什么模型调用绕后台走:必须在有 host_permissions 的上下文里发,
 * content script 的 fetch 受页面 CORS 约束,直接调会被拦。
 * 批量任务更是必须在后台 —— 它要跑几十秒,不能依赖侧边栏一直开着。
 */
export type BackgroundRequest =
  | ({ type: 'analyzeFromPage' } & AnalyzeContext)
  | ({ type: 'saveFromPage' } & SavePayload)
  | ({ type: 'startBatch' } & BatchStartPayload)
  | { type: 'cancelBatch' };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
