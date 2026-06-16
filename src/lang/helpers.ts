import { moment as obsidianMoment } from 'obsidian';
import en from './locale/en';
import zhCN from './locale/zh-cn';

const localeMap: { [key: string]: Partial<typeof en> } = {
    'en': en,
    'zh-cn': zhCN,
};

function getLocale(): string {
    try {
        const windowMoment = (globalThis as any).window?.moment;
        if (typeof windowMoment?.locale === 'function') {
            return windowMoment.locale();
        }
    } catch {
        // Fall through to Obsidian's exported moment.
    }

    try {
        if (typeof obsidianMoment?.locale === 'function') {
            return obsidianMoment.locale();
        }
    } catch {
        // Fall through to English.
    }

    return 'en';
}

export function t(str: keyof typeof en, vars?: any[]): string {
    const locale = getLocale();
    const currentLocale = locale === 'zh-cn' ? 'zh-cn' : 'en';
    const dict = localeMap[currentLocale];
    let result: string = str;
    if (dict && (dict as any)[str]) {
        result = (dict as any)[str];
    } else {
        result = (en as any)[str] || str;
    }

    if (vars && vars.length > 0) {
        vars.forEach((v, i) => {
            result = result.replace(`{${i}}`, v);
        });
    }
    return result;
}
