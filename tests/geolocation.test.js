import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPosition } from '../src/lib/geolocation.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubGeolocation = (getCurrentPosition) => {
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
};

describe('getPosition', () => {
  it('resolves with the position the browser returns', async () => {
    const position = { coords: { latitude: 46.52, longitude: 6.63 } };
    stubGeolocation((resolve) => resolve(position));
    await expect(getPosition(5000)).resolves.toBe(position);
  });

  it('rejects with the browser error', async () => {
    const error = { code: 1, message: 'denied' };
    stubGeolocation((_resolve, reject) => reject(error));
    await expect(getPosition(5000)).rejects.toBe(error);
  });

  it('passes the timeout on', async () => {
    const getCurrentPosition = vi.fn((resolve) => resolve({}));
    stubGeolocation(getCurrentPosition);
    await getPosition(8000);
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ timeout: 8000 });
  });
});
