import { describe, expect, it } from 'vitest';
import { frameColor, inkFor, luminance, neutralFrame, parseColor } from './color';

describe('frame colours', () => {
  it('parses page colours in every form computed styles and theme-color use', () => {
    expect(parseColor('#1a73e8')).toEqual({ r: 26, g: 115, b: 232, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgb(0, 128, 255)')).toEqual({ r: 0, g: 128, b: 255, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')!.a).toBe(0.5);
    expect(parseColor('rgb(10 20 30 / 40%)')!.a).toBeCloseTo(0.4);
    expect(parseColor('papayawhip')).toBeNull();
  });

  it('keeps only colours opaque enough to mean something', () => {
    expect(frameColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(frameColor('rgba(255, 0, 0, 0.2)')).toBeNull();
    expect(frameColor('rgb(29, 161, 242)')).toBe('#1da1f2');
  });

  it('picks the ink that reads on the colour', () => {
    expect(inkFor('#ffffff')).toBe('dark');
    expect(inkFor('#000000')).toBe('light');
    expect(inkFor('#1a73e8')).toBe('light'); // a brand blue gets white text
    expect(inkFor('#ffd60a')).toBe('dark'); // yellow gets dark text
    expect(luminance('#000000')).toBe(0);
  });

  it('is white in light theme and black in dark without a site colour', () => {
    expect(neutralFrame('light')).toBe('#ffffff');
    expect(neutralFrame('dark')).toBe('#000000');
  });
});
