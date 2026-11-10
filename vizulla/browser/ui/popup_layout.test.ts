import { describe, expect, it } from 'vitest';
import { popupBounds, popupTitle } from './popup_layout';

const opener = { x: 100, y: 50, width: 1200, height: 800 };
const area = { x: 0, y: 25, width: 1440, height: 875 };

describe('popup windows', () => {
  it('take the size the page asks for, centred over the window that opened them', () => {
    expect(popupBounds('width=500,height=600', opener, area)).toEqual({ width: 500, height: 600, x: 450, y: 130 });
    expect(popupBounds('popup', opener, area)).toMatchObject({ width: 500, height: 620 });
  });

  it('honour a position but stay on screen, never tiny or larger than the screen', () => {
    expect(popupBounds('width=400,height=400,left=2000,top=-50', opener, area)).toEqual({ width: 400, height: 400, x: 1040, y: 25 });
    expect(popupBounds('width=50,height=50', opener, area)).toMatchObject({ width: 320, height: 320 });
    expect(popupBounds('width=9000,height=9000', opener, area)).toMatchObject({ width: 1440, height: 875, x: 0, y: 25 });
    expect(popupBounds('innerWidth=600, innerHeight=500, screenX=10, screenY=40', opener, area)).toEqual({ width: 600, height: 500, x: 10, y: 40 });
  });

  it('always name the site in the title bar, and say when it is not secure', () => {
    expect(popupTitle('https://accounts.google.com/v3/signin', 'Sign in – Google Accounts', 'Not secure')).toBe('accounts.google.com — Sign in – Google Accounts');
    expect(popupTitle('http://login.example.com/', 'Log in', 'Not secure')).toBe('Not secure · login.example.com — Log in');
    expect(popupTitle('https://appleid.apple.com/auth', 'appleid.apple.com', 'Not secure')).toBe('appleid.apple.com');
    expect(popupTitle('about:blank', '', 'Not secure')).toBe(' ');
  });
});
