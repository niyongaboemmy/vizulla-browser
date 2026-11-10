// Web pages (every frame of web sessions): one synchronous call for the page's
// settings, then (1) navigator.language(s) report the browser's chosen language,
// matching Accept-Language, (2) fingerprinting protection (P4-BRW-10, SHD-03)
// adds tiny deterministic per-site noise to canvas, audio and WebGL readouts, and
// (3) Shields scriptlets (video and pre-roll ads) run before the page's own scripts.
// Real clicks and key presses are reported so pages can open tabs only right after
// one, like Chrome's popup blocker (shields/platform_features.ts).
// One call instead of one per feature: each blocks the frame while it starts.
import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { DOMMonitor } from '@ghostery/adblocker-content';

interface PageConfig {
  langs: string[];
  farble: { level: 'off' | 'standard' | 'strict'; seed: number };
  scripts?: string[];
  preload?: boolean;
  cosmetic?: boolean;
}

if (/^https?:$/.test(location.protocol)) {
  let cfg: PageConfig = { langs: [], farble: { level: 'off', seed: 0 } };
  try {
    cfg = ipcRenderer.sendSync('vz:page-config') as PageConfig;
  } catch {
    /* no config: leave the page alone */
  }
  // Privileged injection: runs in the page's world before its scripts, and a site's CSP can't stop it.
  if (Array.isArray(cfg.scripts) && cfg.scripts.length) void webFrame.executeJavaScript(cfg.scripts.join('\n;\n')).catch(() => undefined);
  // Instant navigation: Chromium's own preloading (Speculation Rules) fetches a link on this
  // site when the pointer rests on it (~200 ms) or presses it. Links that change state
  // (sign out, delete, unsubscribe, add to cart…) and downloads are never fetched early.
  if (cfg.preload) {
    const rules = JSON.stringify({
      prefetch: [{
        source: 'document',
        where: { and: [{ href_matches: '/*' }, { not: { selector_matches: '[href*="logout" i], [href*="log-out" i], [href*="signout" i], [href*="sign-out" i], [href*="logoff" i], [href*="delete" i], [href*="remove" i], [href*="unsubscribe" i], [href*="cart" i], [href*="checkout" i], [href*="action=" i], [rel~="nofollow"], [download]' } }] },
        eagerness: 'moderate',
      }],
    });
    void webFrame.executeJavaScript(`(() => {
      const add = () => { const s = document.createElement('script'); s.type = 'speculationrules'; s.textContent = ${JSON.stringify(rules)}; (document.head || document.documentElement).append(s); };
      document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', add, { once: true }) : add();
    })()`).catch(() => undefined);
  }
  // Element hiding: report the classes, ids and links in use (as the page changes) and
  // apply the matching hiding rules as user styles, which beat the page's own.
  if (cfg.cosmetic) {
    const monitor = new DOMMonitor((u) => {
      if (u.type !== 'features' || (!u.classes.length && !u.ids.length && !u.hrefs.length)) return;
      void ipcRenderer.invoke('vz:cosmetic', { classes: u.classes, ids: u.ids, hrefs: u.hrefs }).then((css: string) => css && webFrame.insertCSS(css, { cssOrigin: 'user' })).catch(() => undefined);
    });
    const start = () => {
      monitor.queryAll(window);
      monitor.start(window);
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
  }
  let lastSent = 0;
  const activation = (e: Event) => {
    if (!e.isTrusted || e.timeStamp - lastSent < 200) return;
    lastSent = e.timeStamp;
    ipcRenderer.send('vz:activation');
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(type, activation, { capture: true, passive: true });
  if (Array.isArray(cfg.langs) && cfg.langs.length) {
    contextBridge.executeInMainWorld({
      func: (list: string[]) => {
        const frozen = Object.freeze([...list]);
        const proto = Navigator.prototype;
        Object.defineProperty(proto, 'language', { get: () => frozen[0], configurable: true, enumerable: true });
        Object.defineProperty(proto, 'languages', { get: () => frozen, configurable: true, enumerable: true });
      },
      args: [cfg.langs],
    });
  }
  if (cfg.farble.level !== 'off') {
    contextBridge.executeInMainWorld({
      func: (seed: number, strict: boolean) => {
        let s = seed >>> 0 || 1;
        const rnd = () => ((s ^= s << 13), (s ^= s >>> 17), (s ^= s << 5), (s >>> 0) / 4294967296);
        const noisePixels = (data: Uint8ClampedArray) => {
          // Flip the lowest bit of ~1 in 64 channels: invisible, but changes the hash.
          for (let i = 0; i < data.length; i += 4 * 16) {
            const r = rnd();
            if (r < 0.25) data[i] = data[i]! ^ 1;
            else if (r < 0.5) data[i + 1] = data[i + 1]! ^ 1;
          }
        };
        const proto2d = CanvasRenderingContext2D.prototype;
        const getImageData = proto2d.getImageData;
        proto2d.getImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof getImageData>) {
          const img = getImageData.apply(this, args);
          noisePixels(img.data);
          return img;
        };
        const farbleCanvas = (canvas: HTMLCanvasElement) => {
          if (!canvas.width || !canvas.height || canvas.width * canvas.height > 4_000_000) return canvas;
          const copy = document.createElement('canvas');
          copy.width = canvas.width;
          copy.height = canvas.height;
          const ctx = copy.getContext('2d');
          if (!ctx) return canvas;
          ctx.drawImage(canvas, 0, 0);
          const img = getImageData.call(ctx, 0, 0, copy.width, copy.height);
          noisePixels(img.data);
          ctx.putImageData(img, 0, 0);
          return copy;
        };
        const toDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, ...a: Parameters<typeof toDataURL>) {
          return toDataURL.apply(farbleCanvas(this), a);
        };
        const toBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, ...a: Parameters<typeof toBlob>) {
          return toBlob.apply(farbleCanvas(this), a);
        };
        const getChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function (this: AudioBuffer, ch: number) {
          const d = getChannelData.call(this, ch);
          for (let i = 0; i < d.length; i += 100) d[i] = d[i]! + (rnd() - 0.5) * 1e-7;
          return d;
        };
        for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
          const getParameter = P.getParameter;
          P.getParameter = function (this: WebGLRenderingContext, p: number) {
            if (p === 0x9245) return 'Vizulla'; // UNMASKED_VENDOR_WEBGL
            if (p === 0x9246) return 'Vizulla Graphics'; // UNMASKED_RENDERER_WEBGL
            return getParameter.call(this, p);
          };
        }
        if (strict) {
          Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, configurable: true });
          Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8, configurable: true });
        }
      },
      args: [cfg.farble.seed, cfg.farble.level === 'strict'],
    });
  }
}
