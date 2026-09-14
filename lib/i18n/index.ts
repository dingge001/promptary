import { en } from './locales/en';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { zhCN, type Dict } from './locales/zh-CN';
import { zhTW } from './locales/zh-TW';

/**
 * 轻量国际化。
 *
 * 刻意不引 i18next 之类的库:全项目统共一百多条文案,
 * 自己实现一个 t() 就够了,引库要多几十 KB 还得多学一套 API。
 *
 * 语言包以简体中文为基准,其余语言用 Dict 类型约束 ——
 * 漏翻或拼错 key 会在编译期直接报错,不会等到用户看见。
 */

export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko';

export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};

export const LOCALES = Object.keys(LOCALE_LABELS) as Locale[];

const DICTS: Record<Locale, Dict> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en,
  ja,
  ko,
};

/**
 * 按浏览器语言猜一个最接近的。
 * 中文要区分简繁:港台用户看到简体同样别扭。
 */
export function detectLocale(): Locale {
  const raw = (navigator.language || 'en').toLowerCase();

  if (raw.startsWith('zh')) {
    // zh-TW / zh-HK / zh-MO / zh-Hant 都算繁体
    return /tw|hk|mo|hant/.test(raw) ? 'zh-TW' : 'zh-CN';
  }
  if (raw.startsWith('ja')) return 'ja';
  if (raw.startsWith('ko')) return 'ko';
  return 'en';
}

/**
 * 当前语言存在模块级变量里,而不是 React Context。
 *
 * 因为页面内的结果面板是原生 DOM 写的(content script),用不了 Context,
 * 它也得能调到 t()。全局变量是两边都能用的最小公约数。
 * React 侧的更新由 App 的 state 驱动重渲染。
 */
// 初始值就跟随浏览器,避免设置异步加载完之前先闪一下中文
let current: Locale = typeof navigator === 'undefined' ? 'en' : detectLocale();

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** 取翻译。缺 key 时回退英文,再不行就把 key 原样返回,方便定位遗漏 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  // Dict 是「有限 key 的联合类型」,这里要按任意字符串查,所以放宽成索引签名。
  // 类型安全的收益在语言包那边已经拿到了(漏翻编译报错),这一层不需要再卡。
  const dict = (DICTS[locale] ?? en) as Record<string, string>;
  let text = dict[key] ?? (en as Record<string, string>)[key] ?? key;

  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** 组件里最常用的形式:跟随当前语言 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(current, key, vars);
}

export type { Dict };

/**
 * 分类名的显示文本。
 *
 * 内置分类存的是 i18n key 而不是固定文字,否则它们会在创建时就被中文固化,
 * 用户切到英文也变不了。老数据存的是中文名,这里做一次兼容映射 ——
 * 用户自己改过的名字不在映射表里,原样显示。
 */
const LEGACY_CATEGORY_NAMES: Record<string, string> = {
  人物: 'builtin.people',
  场景: 'builtin.scene',
  风格: 'builtin.style',
  构图: 'builtin.composition',
};

export function categoryLabel(name: string): string {
  if (name.startsWith('builtin.')) return t(name);
  const key = LEGACY_CATEGORY_NAMES[name];
  return key ? t(key) : name;
}