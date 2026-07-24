import { describe, it, expect } from 'vitest';
import { isIosDevice } from '../src/lib/pwa.js';

describe('isIosDevice', () => {
  it('matches iPhone and iPad user agents', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
  });

  it('rejects Android and desktop user agents', () => {
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(false);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
  });
});
