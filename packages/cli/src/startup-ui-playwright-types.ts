export interface PlaywrightBrowser {
  newPage(options: {
    viewport: { width: number; height: number };
  }): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightPage {
  on(event: "console", handler: (message: PlaywrightConsoleMessage) => void): void;
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number }
  ): Promise<PlaywrightResponse | null>;
  locator(selector: string): PlaywrightLocator;
  content(): Promise<string>;
  screenshot(options: { fullPage: boolean }): Promise<Buffer>;
  reload(options: { waitUntil: "domcontentloaded" }): Promise<void>;
}

export interface PlaywrightLocator {
  first(): PlaywrightLocator;
  count(): Promise<number>;
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<void>;
  click(): Promise<void>;
  innerText(): Promise<string>;
  boundingBox(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>;
}

export interface PlaywrightResponse {
  status(): number;
  ok(): boolean;
}

export interface PlaywrightConsoleMessage {
  type(): string;
  text(): string;
}
