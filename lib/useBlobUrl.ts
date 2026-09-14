import { useEffect, useState } from 'react';

/**
 * 把 IndexedDB 里的 Blob 转成可渲染的 object URL。
 *
 * 一定要在卸载时 revoke:收藏库动辄几百张缩略图,
 * 不回收的话侧边栏开久了内存会一路涨上去。
 */
export function useBlobUrl(blob?: Blob): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url;
}
