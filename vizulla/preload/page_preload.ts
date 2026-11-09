// Web pages (every frame of web sessions): one synchronous call for the page's
// settings, then (1) navigator.language(s) report the browser's chosen language,
// matching Accept-Language, and (2) fingerprinting protection (P4-BRW-10, SHD-03)
// adds tiny deterministic per-site noise to canvas, audio and WebGL readouts.
// One call instead of one per feature: each blocks the frame while it starts.
import { contextBridge, ipcRenderer } from 'electron';

interface PageConfig {
  langs: string[];
  farble: { level: 'off' | 'standard' | 'strict'; seed: number };
}

if (/^https?:$/.test(location.protocol)) {
  let cfg: PageConfig = { langs: [], farble: { level: 'off', seed: 0 } };
  try {
    cfg = ipcRenderer.sendSync('vz:page-config') as PageConfig;
  } catch {
    /* no config: leave the page alone */
  }
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
