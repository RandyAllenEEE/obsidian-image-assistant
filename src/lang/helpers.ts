import { moment } from 'obsidian';
import en from './locale/en';
import zhCN from './locale/zh-cn';

const localeMap: { [key: string]: Partial<typeof en> } = {
    'en': en,
    'zh-cn': zhCN,
};

const locale = window.moment.locale();

export function t(str: keyof typeof en): string {
    const currentLocale = locale === 'zh-cn' ? 'zh-cn' : 'en';
    const dict = localeMap[currentLocale];
    if (!dict) {
        return (en as any)[str] || str;
    }
    return (dict as any)[str] || (en as any)[str] || str;
}
