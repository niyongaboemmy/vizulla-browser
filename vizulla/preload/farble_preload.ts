// Fingerprinting protection (P4-BRW-10, SHD-03): runs in every frame of web
// sessions. Adds tiny, deterministic per-site/per-session noise to canvas,
// audio, and WebGL readouts so they can't identify the device across sites,
// while pages still render correctly. "strict" also normalizes hardware hints.
import { contextBridge, ipcRenderer } from 'electron';

if (/^https?:$/.test(location.protocol)) {
  let cfg: { level: 'off' | 'standard' | 'strict'; seed: number } = { level: 'off', seed: 0 };
  try {
    cfg = ipcRenderer.sendSync('vz:farble-config') as typeof cfg;
  } catch {
    /* no config: leave the page alone */
  }
  if (cfg.level !== 'off') {
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
      args: [cfg.seed, cfg.level === 'strict'],
    });
  }
}
