import { t } from '../i18n';
/**
 * 图片获取与预处理。
 *
 * MV3 的 Service Worker 环境有两个必须绕开的限制:
 *   1. 没有 FileReader —— 所以 base64 只能拿 arrayBuffer 手动编码
 *   2. 没有 DOM —— 所以缩放走 OffscreenCanvas + createImageBitmap
 */

/** base64 编码。分块处理,避免 String.fromCharCode 参数过多导致调用栈溢出 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type || 'image/jpeg'};base64,${await blobToBase64(blob)}`;
}

/** 按最长边等比缩放,返回目标尺寸。只缩不放 */
function fitInside(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

async function drawToCanvas(
  bitmap: ImageBitmap,
  w: number,
  h: number,
): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('error.canvasUnavailable'));
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

export interface ProcessedImage {
  /** 压缩后的 data URL,用于 base64 方式喂给模型 */
  dataUrl: string;
  /** 原图,存库 */
  original: Blob;
  /** 缩略图,列表渲染用 */
  thumbnail: Blob;
  /** 原始尺寸(不是压缩后的) */
  width: number;
  height: number;
}

/**
 * 把一张图处理成「可送模型 + 可入库」的形态。
 *
 * 送模型的图会压到最长边 1536:主流 VL 模型本来就会把图缩放到固定 token 数,
 * 传原图只会白白拉长上传时间,对识别质量没有帮助。
 * 入库的缩略图则压得更狠,列表里几百张卡片同时渲染时才不会卡。
 */
export async function processImage(
  blob: Blob,
  opts: { maxEdge?: number; quality?: number; thumbEdge?: number } = {},
): Promise<ProcessedImage> {
  const { maxEdge = 1536, quality = 0.85, thumbEdge = 480 } = opts;

  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;

  const main = fitInside(width, height, maxEdge);
  const mainCanvas = await drawToCanvas(bitmap, main.w, main.h);
  const mainBlob = await mainCanvas.convertToBlob({ type: 'image/jpeg', quality });

  const thumb = fitInside(width, height, thumbEdge);
  const thumbCanvas = await drawToCanvas(bitmap, thumb.w, thumb.h);
  const thumbBlob = await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });

  bitmap.close();

  return {
    dataUrl: await blobToDataUrl(mainBlob),
    original: blob,
    thumbnail: thumbBlob,
    width,
    height,
  };
}

/** 下载图片为 Blob。credentials: 'omit' 避免把用户的站点 Cookie 带给图片服务器 */
export async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) {
    throw new Error(t('error.imageDownloadFailed', { status: res.status }));
  }
  const blob = await res.blob();
  if (blob.size === 0) throw new Error(t('error.emptyImage'));
  if (!blob.type.startsWith('image/')) {
    throw new Error(t('error.notAnImage', { type: blob.type || 'unknown' }));
  }
  return blob;
}

export type TransferStrategy = 'url' | 'base64';

/**
 * 决定这张图怎么送给模型。
 *
 * 关键判断:blob: 是页面作用域的地址,外部模型服务根本取不到,必须转 base64;
 * http(s) 则优先直传 —— 服务端自己去下载,我们既省流量也避开防盗链。
 */
export function decideStrategy(
  imageUrl: string | undefined,
  pref: 'auto' | 'url' | 'base64',
): TransferStrategy {
  if (pref === 'base64') return 'base64';
  if (!imageUrl) return 'base64';
  if (imageUrl.startsWith('blob:') || imageUrl.startsWith('data:')) return 'base64';
  if (pref === 'url') return 'url';
  return /^https?:\/\//i.test(imageUrl) ? 'url' : 'base64';
}

/** 从 URL 里取站点域名,用于溯源和按来源筛选 */
export function siteOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
