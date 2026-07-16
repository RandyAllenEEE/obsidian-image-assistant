import { vi } from 'vitest';
import { StateEffect, StateField } from '@codemirror/state';

export const setEditorLivePreviewEffect = StateEffect.define<boolean>();
export const editorLivePreviewField = StateField.define<boolean>({
  create: () => true,
  update: (value, transaction) => {
    const effect = transaction.effects.find(candidate => candidate.is(setEditorLivePreviewEffect));
    return effect ? effect.value : value;
  }
});

/**
 * Mock implementation of the Obsidian module
 * Provides test doubles for all Obsidian API imports
 */

// Core classes
export class Notice {
  message: string;
  timeout?: number;
  noticeEl: HTMLElement;
  
  constructor(message: string, timeout?: number) {
    this.message = message;
    this.timeout = timeout;
    this.noticeEl = document.createElement('div');
  }
  
  hide() {}
}

export class Plugin {
  app: App;
  manifest: any;
  private children: Array<{ load?: () => void; onunload?: () => void }> = [];
  
  constructor(app: App, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
  
  onload() {}
  onunload() {}
  addCommand(command: any) {}
  addRibbonIcon(icon: string, title: string, callback: () => void) {}
  addSettingTab(tab: any) {}
  register(cb?: () => void) {}
  registerEvent(event: any) {}
  registerEditorExtension(_extension: any) {}
  registerMarkdownPostProcessor(_processor: any) {}
  addChild<T extends { load?: () => void; onunload?: () => void }>(child: T): T {
    this.children.push(child);
    child.load?.();
    return child;
  }
  removeChild<T extends { onunload?: () => void }>(child: T): T {
    this.children = this.children.filter((existing) => existing !== child);
    child.onunload?.();
    return child;
  }
  registerDomEvent(el: HTMLElement | Document, event: string, callback: any, useCapture?: boolean) {
    // Attach to DOM for integration-lite tests
    (el as any).addEventListener?.(event, callback, useCapture as any);
  }
  registerInterval(interval: number, callback: () => void): number { return 0; }
  loadData(): Promise<any> { return Promise.resolve({}); }
  saveData(data: any): Promise<void> { return Promise.resolve(); }
}

export class Modal {
  app: App;
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  
  constructor(app: App) {
    this.app = app;
    this.modalEl = document.createElement('div');
    this.containerEl = document.createElement('div');
    this.titleEl = document.createElement('div');
    this.contentEl = document.createElement('div');
  }
  
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

export class FuzzySuggestModal<T> extends Modal {
  inputEl: HTMLInputElement;
  emptyStateText = '';
  placeholder = '';
  instructions: Array<{ command: string; purpose: string }> = [];

  constructor(app: App) {
    super(app);
    this.inputEl = document.createElement('input');
    this.contentEl.appendChild(this.inputEl);
  }

  setPlaceholder(text: string): this {
    this.placeholder = text;
    this.inputEl.placeholder = text;
    return this;
  }

  setInstructions(instructions: Array<{ command: string; purpose: string }>): this {
    this.instructions = instructions;
    return this;
  }

  setEmptyStateText(text: string): this {
    this.emptyStateText = text;
    return this;
  }

  getItems(): T[] { return []; }
  getItemText(_item: T): string { return ''; }
  onChooseItem(_item: T, _evt?: MouseEvent | KeyboardEvent): void {}
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;
  
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
  }
  
  display() {}
  hide() {}
}

// UI Components and helpers
export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  
  constructor(containerEl: HTMLElement) {
    this.buttonEl = document.createElement('button');
    containerEl.appendChild(this.buttonEl);
  }
  
  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }
  setIcon(_icon: string): this { return this; }
  setTooltip(_text: string): this { return this; }
  setClass(cls: string): this { this.buttonEl.classList.add(cls); return this; }
  setCta(): this { this.buttonEl.classList.add('cta'); return this; }
  setWarning(): this { this.buttonEl.classList.add('warning'); return this; }
  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return this;
  }
  onClick(callback: () => void): this {
    this.buttonEl.addEventListener('click', callback);
    return this;
  }
}

export class TextComponent {
  inputEl: HTMLInputElement;
  
  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    containerEl.appendChild(this.inputEl);
  }
  
  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }
  
  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
  
  getValue(): string {
    return this.inputEl.value;
  }
  
  onChange(callback: (value: string) => void): this {
    this.inputEl.addEventListener('change', (e) => {
      callback((e.target as HTMLInputElement).value);
    });
    return this;
  }
  
  setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return this;
  }
}

export class DropdownComponent {
  selectEl: HTMLSelectElement;
  private changeCb: ((val: string) => void) | null = null;
  
  constructor(containerEl: HTMLElement) {
    this.selectEl = document.createElement('select');
    containerEl.appendChild(this.selectEl);
  }
  addOption(value: string, label: string): this {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    this.selectEl.appendChild(opt);
    return this;
  }
  addOptions(options: Record<string,string>): this {
    Object.entries(options).forEach(([value,label]) => this.addOption(value,label));
    return this;
  }
  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }
  onChange(cb: (value: string) => void): this {
    this.changeCb = cb;
    this.selectEl.addEventListener('change', (e) => {
      cb((e.target as HTMLSelectElement).value);
    });
    return this;
  }
}

export class SliderComponent {
  sliderEl: HTMLInputElement;
  private changeCb: ((val: number) => void) | null = null;
  
  constructor(containerEl: HTMLElement) {
    this.sliderEl = document.createElement('input');
    this.sliderEl.type = 'range';
    containerEl.appendChild(this.sliderEl);
  }
  setLimits(min: number, max: number, step: number): this {
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }
  setValue(value: number): this {
    this.sliderEl.value = String(value);
    return this;
  }
  setDynamicTooltip(): this { return this; }
  onChange(cb: (value: number) => void): this {
    this.changeCb = cb;
    this.sliderEl.addEventListener('input', (event) => cb(Number((event.target as HTMLInputElement).value)));
    return this;
  }
}

export class ToggleComponent {
  toggleEl: HTMLInputElement;
  private changeCb: ((val: boolean) => void) | null = null;
  constructor(containerEl: HTMLElement) {
    this.toggleEl = document.createElement('input');
    this.toggleEl.type = 'checkbox';
    containerEl.appendChild(this.toggleEl);
  }
  setValue(value: boolean): this { this.toggleEl.checked = value; return this; }
  setTooltip(text: string): this { this.toggleEl.title = text; return this; }
  onChange(cb: (value: boolean) => void): this {
    this.changeCb = cb;
    this.toggleEl.addEventListener('change', (event) => cb((event.target as HTMLInputElement).checked));
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: any[] = [];
  
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.nameEl = document.createElement('div');
    this.descEl = document.createElement('div');
    this.controlEl = document.createElement('div');
    this.settingEl.appendChild(this.nameEl);
    this.settingEl.appendChild(this.descEl);
    this.settingEl.appendChild(this.controlEl);
    if (containerEl) containerEl.appendChild(this.settingEl);
  }
  
  setClass(cls: string): this { this.settingEl.classList.add(cls); return this; }
  setName(name: string): this {
    this.nameEl.textContent = name;
    this.settingEl.setAttribute('data-setting-name', name);
    return this;
  }
  setHeading(): this { this.settingEl.classList.add('setting-item-heading'); return this; }
  setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }
  setTooltip(_text: string): this { return this; }
  addText(cb: (text: TextComponent) => void): this { const textComponent = new TextComponent(this.controlEl); cb(textComponent); this.components.push(textComponent); return this; }
  addTextArea(cb: (text: TextComponent) => void): this { const textComponent = new TextComponent(this.controlEl); cb(textComponent); this.components.push(textComponent); return this; }
  addToggle(cb: (toggle: ToggleComponent) => void): this { const toggleComponent = new ToggleComponent(this.controlEl); cb(toggleComponent); this.components.push(toggleComponent); return this; }
  addButton(cb: (button: ButtonComponent) => void): this { const buttonComponent = new ButtonComponent(this.controlEl); cb(buttonComponent); this.components.push(buttonComponent); return this; }
  addExtraButton(cb: (button: { setIcon: (icon: string) => any; setTooltip: (text: string) => any; onClick: (handler: () => void) => any; buttonEl: HTMLButtonElement }) => void): this {
    const el = document.createElement('button');
    this.controlEl.appendChild(el);
    const extra = {
      buttonEl: el,
      setIcon: (_icon: string) => { /* no-op for tests */ return extra; },
      setTooltip: (_text: string) => { el.title = _text; return extra; },
      onClick: (handler: () => void) => { el.addEventListener('click', handler); return extra; }
    } as any;
    cb(extra);
    this.components.push(extra);
    return this;
  }
  addDropdown(cb: (dropdown: DropdownComponent) => void): this { const dropdownComponent = new DropdownComponent(this.controlEl); cb(dropdownComponent); this.components.push(dropdownComponent); return this; }
  addSlider(cb: (slider: SliderComponent) => void): this { const sliderComponent = new SliderComponent(this.controlEl); cb(sliderComponent); this.components.push(sliderComponent); return this; }
  clear(): this { while (this.controlEl.firstChild) this.controlEl.removeChild(this.controlEl.firstChild); this.components = []; return this; }
  then(_cb: () => void): this { return this; }
}

// File system types
export interface TAbstractFile {
  vault: Vault;
  path: string;
  name: string;
  parent: TFolder | null;
}

export class TFile implements TAbstractFile {
  vault: Vault = {} as Vault;
  path: string = '';
  name: string = '';
  basename: string = '';
  extension: string = '';
  parent: TFolder | null = null;
  stat: { mtime: number; ctime: number; size: number } = {
    mtime: Date.now(),
    ctime: Date.now(),
    size: 0
  };
}

export class TFolder implements TAbstractFile {
  vault: Vault = {} as Vault;
  path: string = '';
  name: string = '';
  parent: TFolder | null = null;
  children: TAbstractFile[] = [];
  
  isRoot(): boolean { return false; }
}

// Core app interfaces
export interface App {
  vault: Vault;
  metadataCache: MetadataCache;
  workspace: Workspace;
  fileManager: FileManager;
  internalPlugins: any;
  plugins: any;
  
  loadLocalStorage(key: string): string | null;
  saveLocalStorage(key: string, value: string): void;
}

export interface Vault {
  adapter: DataAdapter;
  configDir: string;
  
  getAbstractFileByPath(path: string): TAbstractFile | null;
  getFiles(): TFile[];
  getMarkdownFiles(): TFile[];
  getAllLoadedFiles(): TAbstractFile[];
  
  read(file: TFile): Promise<string>;
  readBinary(file: TFile): Promise<ArrayBuffer>;
  cachedRead(file: TFile): Promise<string>;
  
  modify(file: TFile, data: string): Promise<void>;
  modifyBinary(file: TFile, data: ArrayBuffer): Promise<void>;
  
  create(path: string, data: string): Promise<TFile>;
  createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
  createFolder(path: string): Promise<TFolder>;
  
  rename(file: TAbstractFile, newPath: string): Promise<void>;
  delete(file: TAbstractFile, force?: boolean): Promise<void>;
  trash(file: TAbstractFile, system?: boolean): Promise<void>;
  
  copy(file: TFile, newPath: string): Promise<TFile>;
  
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  trigger(event: string, ...args: any[]): void;
  tryTrigger(event: string, ...args: any[]): void;
}

export interface DataAdapter {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<any>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  append(path: string, data: string): Promise<void>;
  
  mkdir(path: string): Promise<void>;
  rmdir(path: string, recursive?: boolean): Promise<void>;
  remove(path: string): Promise<void>;
  
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(oldPath: string, newPath: string): Promise<void>;
}

// Minimal FileSystemAdapter to enable instanceof checks and getBasePath in tests
export class FileSystemAdapter {
  constructor(private basePath: string = '/vault') {}
  getBasePath(): string { return this.basePath; }
}

export interface MetadataCache {
  resolvedLinks: Record<string, Record<string, number>>;
  unresolvedLinks: Record<string, Record<string, number>>;
  
  getFileCache(file: TFile): any;
  getCache(path: string): any;
  
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
  
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  trigger(event: string, ...args: any[]): void;
  tryTrigger(event: string, ...args: any[]): void;
}

export interface Workspace {
  getActiveFile(): TFile | null;
  getLeaf(newLeaf?: boolean | 'tab' | 'split' | 'window'): WorkspaceLeaf;
  getLeavesOfType(type: string): WorkspaceLeaf[];
  getActiveViewOfType<T>(type: new (...args: any[]) => T): T | null;
  
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  trigger(event: string, ...args: any[]): void;
  tryTrigger(event: string, ...args: any[]): void;
}

export interface WorkspaceLeaf {
  view: any;
  
  openFile(file: TFile): Promise<void>;
  setViewState(state: any): Promise<void>;
  getViewState(): any;
}

export interface FileManager {
  getNewFileParent(sourcePath?: string): TFolder;
  generateMarkdownLink(file: TFile, sourcePath: string): string;
  renameFile(file: TAbstractFile, newPath: string): Promise<void>;
}

// Platform utilities
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isMobileApp: false,
  isDesktopApp: true,
  isIosApp: false,
  isAndroidApp: false,
  isMacOS: false,
  isWin: true,
  isLinux: false,
  isSafari: false
};

// Menu and component primitives
export class Component {
  private disposables: Array<() => void> = [];
  private children: Array<{ load?: () => void; onunload?: () => void }> = [];
  load() { /* no-op for tests */ }
  register(cb?: () => void) {
    if (cb) this.disposables.push(cb);
  }
  registerEvent(_event: any) {}
  addChild<T extends { load?: () => void; onunload?: () => void }>(child: T): T {
    this.children.push(child);
    child.load?.();
    return child;
  }
  removeChild<T extends { onunload?: () => void }>(child: T): T {
    this.children = this.children.filter((existing) => existing !== child);
    child.onunload?.();
    return child;
  }
  registerDomEvent(el: HTMLElement | Document, event: string, handler: any, useCapture?: boolean) {
    (el as any).addEventListener?.(event, handler, useCapture as any);
    this.disposables.push(() => (el as any).removeEventListener?.(event, handler, useCapture as any));
  }
  onunload() {
    this.children.forEach(child => child.onunload?.());
    this.children = [];
    this.disposables.forEach(dispose => dispose());
    this.disposables = [];
  }
  unload() { this.onunload(); }
}

export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}

export class SecretComponent {
  private callback: ((value: string) => unknown) | null = null;
  readonly inputEl: HTMLInputElement;

  constructor(_app: App, containerEl: HTMLElement) {
    this.inputEl = document.createElement('input');
    this.inputEl.type = 'password';
    this.inputEl.addEventListener('change', () => this.callback?.(this.inputEl.value));
    containerEl.appendChild(this.inputEl);
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.callback = callback;
    return this;
  }
}

export class MenuItem {
  private title = '';
  private icon = '';
  private click: (() => void) | null = null;
  setTitle(title: string) { this.title = title; return this; }
  setIcon(iconName: string) { this.icon = iconName; return this; }
  onClick(cb: () => void) { this.click = cb; return this; }
  trigger() { this.click?.(); }
}

export class Menu {
  private items: MenuItem[] = [];
  addItem(cb: (item: MenuItem) => void) { const i = new MenuItem(); cb(i); this.items.push(i); return this; }
  addSeparator() { return this; }
  showAtMouseEvent(_evt: MouseEvent) {
    // In integration-lite tests, simulate user clicking actionable items
    // Trigger each item's click handler once to exercise flows
    for (const item of this.items) {
      try { item.trigger(); } catch { /* ignore synchronous errors in tests */ }
    }
  }
  hide() { /* no-op */ }
}

export class View { getViewType(): string { return 'markdown'; } }
export class MarkdownView extends View { editor: any = { getValue: () => '', setValue: (_: string) => {} }; }
export class Editor {}
export interface EditorPosition { line: number; ch: number; }

// Utility functions
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

export function getLinkpath(linktext: string): string {
  return linktext;
}

export function parseLinktext(linktext: string): { path: string; subpath?: string } {
  return { path: linktext };
}

export function setIcon(_el: HTMLElement, _icon: string): void {
  // Mock implementation
}

export function setTooltip(el: HTMLElement, text: string): void {
  el.title = text;
}

export const requestUrl = vi.fn();

export function getBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export function getIcon(_name: string): string | null {
  return null;
}

export const moment: any = Object.assign(
  () => ({
    format: () => '2025-01-02',
    add: () => moment(),
    subtract: () => moment(),
    startOf: () => moment(),
    endOf: () => moment(),
    daysInMonth: () => 31,
    week: () => 1,
    quarter: () => 1,
    calendar: () => '2025-01-02',
    fromNow: () => 'in a few seconds'
  }),
  { locale: () => 'en' }
);

// Keyboard Scope used by ImageAnnotation
export class Scope {
  register(_mods: any[] = [], _key: string = '', _handler: (e: KeyboardEvent) => boolean | void = () => {}) { /* no-op */ }
}

// Debouncer type and debounce implementation used by code under test
export type Debouncer<TArgs extends any[], TReturn> = ((...args: TArgs) => TReturn) & { cancel?: () => void };
export function debounce<T extends (...args: any[]) => any>(fn: T, wait = 0, leading = false): Debouncer<Parameters<T>, ReturnType<T>> {
  let timeout: any = null;
  const debounced: any = (...args: any[]) => {
    const callNow = leading && !timeout;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      if (!leading) fn(...args);
    }, wait);
    if (callNow) return fn(...args);
  };
  debounced.cancel = () => { if (timeout) { clearTimeout(timeout); timeout = null; } };
  return debounced as Debouncer<Parameters<T>, ReturnType<T>>;
}

