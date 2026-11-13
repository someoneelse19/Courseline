// jsdom ships no typings (and @types/jsdom is not installed); the connector uses only this.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
