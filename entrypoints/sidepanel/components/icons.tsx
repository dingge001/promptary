/**
 * 内联 SVG 图标。
 *
 * 不引第三方图标库:侧边栏只需要几个图标,引一个库要多几百 KB,
 * 而且样式还得覆盖。统一规格 —— 16 视窗、1.5px 描边、圆头圆角,
 * 这样放在一起不会有粗细和风格的割裂。
 */

interface IconProps {
  className?: string;
}

const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** 回收站 */
export function IconTrash({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.75 4.25h10.5" />
      <path d="M6.25 4.25V3a1 1 0 011-1h1.5a1 1 0 011 1v1.25" />
      <path d="M4 4.25l.6 8.1a1.5 1.5 0 001.5 1.4h3.8a1.5 1.5 0 001.5-1.4l.6-8.1" />
      <path d="M6.6 7v4M9.4 7v4" />
    </svg>
  );
}

/** 设置。简化齿轮:中心圆 + 八根放射状的齿,比描出轮廓的齿轮干净得多 */
export function IconSettings({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.9v1.5M8 12.6v1.5M1.9 8h1.5M12.6 8h1.5M3.7 3.7l1.05 1.05M11.25 11.25l1.05 1.05M12.3 3.7l-1.05 1.05M4.75 11.25L3.7 12.3" />
    </svg>
  );
}

/** 搜索 */
export function IconSearch({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2l3 3" />
    </svg>
  );
}

/** 关闭 */
export function IconClose({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** 复制 */
export function IconCopy({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.75" />
      <path d="M10.25 5.75V4.5a1.75 1.75 0 00-1.75-1.75h-4A1.75 1.75 0 002.75 4.5v4a1.75 1.75 0 001.75 1.75h1.25" />
    </svg>
  );
}

/** 反推 —— 用星芒表示「生成」的意象 */
export function IconSparkle({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 1.9l1.5 4.1 4.1 1.5-4.1 1.5L8 13.1 6.5 9 2.4 7.5 6.5 6z" />
      <path d="M12.4 10.6l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45L10.4 12.6l1.45-.55z" />
    </svg>
  );
}

/** 星标 */
export function IconStar({ filled = false, className = 'h-3.5 w-3.5' }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base} className={className} fill={filled ? 'currentColor' : 'none'}>
      <path d="M8 2.2l1.85 3.75 4.15.6-3 2.93.71 4.12L8 11.65l-3.71 1.95.71-4.12-3-2.93 4.15-.6z" />
    </svg>
  );
}

/**
 * 图库 / 从页面选图。
 * 用网格而不是单张图片:这个功能是「把本页所有图列出来让你挑」,
 * 单张图片的意象会让人以为点开是看一张图。
 */
export function IconGrid({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.4" y="2.4" width="4.7" height="4.7" rx="1.2" />
      <rect x="8.9" y="2.4" width="4.7" height="4.7" rx="1.2" />
      <rect x="2.4" y="8.9" width="4.7" height="4.7" rx="1.2" />
      <rect x="8.9" y="8.9" width="4.7" height="4.7" rx="1.2" />
    </svg>
  );
}

/** 批量选择。方框里的勾 —— 光一个勾会被读成「确认」,套进框里才是「挑选项」 */
export function IconCheckSquare({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2.6" />
      <path d="M5.5 8.3l1.7 1.7 3.4-4" />
    </svg>
  );
}

/** 勾选 */
export function IconCheck({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} strokeWidth={2} className={className}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

/** 下拉箭头 */
export function IconChevronDown({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6.5L8 10.5l4-4" />
    </svg>
  );
}

/** 加号 */
export function IconPlus({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

/** 注入到页面 */
export function IconInject({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 13.5V7" />
      <path d="M5.25 9.75L8 6.5l2.75 3.25" />
      <path d="M2.75 4.25V3.5a1 1 0 011-1h8.5a1 1 0 011 1v.75" />
      <path d="M2.75 12.5v.5a1 1 0 001 1h8.5a1 1 0 001-1v-.5" />
    </svg>
  );
}

/** 返回 */
export function IconArrowLeft({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
      <path d="M5.5 8h8" />
    </svg>
  );
}

/** 编辑 / 改名 */
export function IconPencil({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M11.2 2.9l1.9 1.9-8.1 8.1-2.5.6.6-2.5z" />
      <path d="M9.7 4.4l1.9 1.9" />
    </svg>
  );
}

/** 重新生成 / 重推 */
export function IconRefresh({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.9 8a5.1 5.1 0 018.8-3.5" />
      <path d="M11.7 1.9v2.6H9.1" />
      <path d="M13.1 8a5.1 5.1 0 01-8.8 3.5" />
      <path d="M4.3 14.1v-2.6h2.6" />
    </svg>
  );
}

/** 恢复 */
export function IconRestore({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13.1 8a5.1 5.1 0 01-8.8 3.5" />
      <path d="M4.3 14.1v-2.6h2.6" />
      <path d="M2.9 8a5.1 5.1 0 018.8-3.5" />
      <path d="M11.7 1.9v2.6H9.1" />
    </svg>
  );
}

/** 下载 / 导出 */
export function IconDownload({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 2.5v7.2" />
      <path d="M5.2 6.9L8 9.7l2.8-2.8" />
      <path d="M2.8 11v1.6a1 1 0 001 1h8.4a1 1 0 001-1V11" />
    </svg>
  );
}

/** 上传 / 导入 */
export function IconUpload({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 9.7V2.5" />
      <path d="M5.2 5.3L8 2.5l2.8 2.8" />
      <path d="M2.8 11v1.6a1 1 0 001 1h8.4a1 1 0 001-1V11" />
    </svg>
  );
}

/** 文件夹 */
export function IconFolder({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 4.6a1 1 0 011-1h2.5l1.2 1.5h5.3a1 1 0 011 1v5.3a1 1 0 01-1 1h-9a1 1 0 01-1-1z" />
    </svg>
  );
}

/** 管理 / 调节 */
export function IconSliders({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 5.2h11M2.5 10.8h11" />
      <circle cx="10.2" cy="5.2" r="1.5" />
      <circle cx="5.8" cy="10.8" r="1.5" />
    </svg>
  );
}

/** 显示密钥 */
export function IconEye({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M1.9 8s2.3-4.1 6.1-4.1S14.1 8 14.1 8s-2.3 4.1-6.1 4.1S1.9 8 1.9 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

/** 隐藏密钥 */
export function IconEyeOff({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6.4 4.2A6.5 6.5 0 018 4c3.8 0 6.1 4 6.1 4a11.4 11.4 0 01-1.9 2.4" />
      <path d="M4.3 5.4A11.3 11.3 0 001.9 8s2.3 4 6.1 4a6.4 6.4 0 002.1-.35" />
      <path d="M6.8 6.8a1.8 1.8 0 002.5 2.5" />
      <path d="M2.6 2.6l10.8 10.8" />
    </svg>
  );
}

/** 测试连接 / 闪电 */
export function IconBolt({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8.7 1.9L3.6 9h3.5l-.8 5.1L11.4 7H7.9z" />
    </svg>
  );
}

/** GitHub。实心图标,和其余描边图标规格不同 —— 品牌图标保持原样更易识别 */
export function IconGithub({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 .5a7.5 7.5 0 00-2.37 14.62c.37.07.51-.16.51-.36l-.01-1.26c-2.09.45-2.53-1-2.53-1-.34-.87-.83-1.1-.83-1.1-.68-.46.05-.45.05-.45.75.05 1.15.77 1.15.77.67 1.15 1.76.82 2.19.63.07-.49.26-.82.47-1.01-1.67-.19-3.42-.83-3.42-3.71 0-.82.29-1.49.77-2.02-.08-.19-.33-.95.07-1.98 0 0 .63-.2 2.06.77a7.2 7.2 0 013.75 0c1.43-.97 2.06-.77 2.06-.77.4 1.03.15 1.79.07 1.98.48.53.77 1.2.77 2.02 0 2.89-1.75 3.52-3.42 3.7.27.23.51.69.51 1.39l-.01 2.06c0 .2.13.43.51.36A7.5 7.5 0 008 .5z" />
    </svg>
  );
}