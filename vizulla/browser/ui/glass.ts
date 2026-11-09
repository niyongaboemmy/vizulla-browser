// Where the window can be glass: macOS vibrancy, or Windows 11 Mica (build 22000+).
// Older Windows and Linux keep a solid frame.
import { release } from 'node:os';

export const isMac = process.platform === 'darwin';
export const hasMica = process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22000;
export const hasGlass = isMac || hasMica;
