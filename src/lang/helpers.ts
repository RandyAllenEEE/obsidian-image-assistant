import { moment } from 'obsidian';
import en from './locale/en';
import zhCN from './locale/zh-cn';

const localeMap: { [key: string]: Partial<typeof en> } = {
    'en': en,
    'zh-cn': zhCN,
};

const locale = window.moment.locale();

export function t(str: keyof typeof en, vars?: any[]): string {
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
