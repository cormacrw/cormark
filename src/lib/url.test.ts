import { describe, expect, it } from 'vitest';
import { isAnnotatable, pageKey, sanitizeUrl, sitePattern } from './url';

describe('sanitizeUrl', () => {
  it('redacts secrets and credentials but keeps ordinary params', () => {
    const url = sanitizeUrl('https://me:pw@a.com/x?plan=pro&access_token=abc&author=sam&code=1');
    expect(url).toBe('https://a.com/x?plan=pro&access_token=REDACTED&author=sam&code=REDACTED');
  });

  it('redacts tokens in the hash', () => {
    expect(sanitizeUrl('https://a.com/cb#access_token=abc&state=x')).toBe(
      'https://a.com/cb#access_token=REDACTED&state=x',
    );
  });
});

describe('pageKey', () => {
  it('ignores the query string, plain anchors and trailing slashes', () => {
    const key = 'http://localhost:3000/pricing';
    expect(pageKey('http://localhost:3000/pricing?plan=pro')).toBe(key);
    expect(pageKey('http://localhost:3000/pricing/#faq')).toBe(key);
  });

  it('treats hash routes and dynamic paths as separate pages', () => {
    expect(pageKey('https://a.com/#/settings?tab=1')).toBe('https://a.com/#/settings');
    expect(pageKey('https://a.com/#!/settings')).toBe('https://a.com/#!/settings');
    expect(pageKey('https://a.com/users/1')).not.toBe(pageKey('https://a.com/users/2'));
  });
});

describe('site access', () => {
  it('only allows http and https', () => {
    expect(isAnnotatable('http://localhost:3000')).toBe(true);
    expect(isAnnotatable('chrome://extensions')).toBe(false);
    expect(isAnnotatable('file:///tmp/a.html')).toBe(false);
    expect(isAnnotatable(undefined)).toBe(false);
  });

  it('builds a pattern without the port', () => {
    expect(sitePattern('http://localhost:3000/pricing')).toBe('http://localhost/*');
  });
});
