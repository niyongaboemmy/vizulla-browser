// Web language (runs in every frame of web pages): navigator.language and
// navigator.languages report the browser's chosen language, matching the
// Accept-Language header, so sites can pick Kinyarwanda, Kiswahili, French or English.
import { contextBridge, ipcRenderer } from 'electron';

if (/^https?:$/.test(location.protocol)) {
  let langs: string[] = [];
  try {
    langs = ipcRenderer.sendSync('vz:web-languages') as string[];
  } catch {
    /* no config: leave the page alone */
  }
  if (Array.isArray(langs) && langs.length) {
    contextBridge.executeInMainWorld({
      func: (list: string[]) => {
        const frozen = Object.freeze([...list]);
        const proto = Navigator.prototype;
        Object.defineProperty(proto, 'language', { get: () => frozen[0], configurable: true, enumerable: true });
        Object.defineProperty(proto, 'languages', { get: () => frozen, configurable: true, enumerable: true });
      },
      args: [langs],
    });
  }
}
