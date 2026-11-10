// The user agent sites see: Chrome's, as Brave, Edge, Vivaldi and Arc send it. Sign-in providers
// (Google, Apple, Microsoft) refuse or degrade sign-in for user agents that name Electron or an
// unknown product, treating them as embedded web views.

/** Chrome's user agent string: the Electron and app-name tokens removed. */
export function webUserAgent(ua: string): string {
  return ua.replace(/ (Electron|Vizulla|vizulla)\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();
}
