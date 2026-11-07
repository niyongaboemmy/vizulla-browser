// Branding (P1-PLT-05): product name, user-data dir name, channel, endpoints.
// No "Chromium" or "Electron" text in the UI except the About page attribution.
export type Channel = 'dev' | 'nightly' | 'beta' | 'stable';

const channel = (process.env.VZ_CHANNEL as Channel | undefined) ?? (process.env.VZ_DEV === '1' ? 'dev' : 'stable');

export const BRANDING = {
  productName: 'Vizulla',
  appId: 'org.vizulla.browser',
  userDataDirName: channel === 'stable' ? 'Vizulla' : `Vizulla ${channel[0]!.toUpperCase()}${channel.slice(1)}`,
  channel,
  /** Signed filter lists (P1-CLD-03). Overridable for staging. */
  shieldsListUrl: process.env.VZ_SHIELDS_LIST_URL || null,
  protocols: ['http', 'https'],
} as const;
