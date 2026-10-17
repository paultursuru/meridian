import { describe, it, expect } from 'vitest';
import { clientIp } from '../swissbuildings-lookup/src/clientIp.js';

// The swissbuildings-lookup Worker rate-limits per IP. Behind the site's
// nginx every request carries the Fly machine's IP, so the visitor's IP is
// relayed in a header that must only count with the shared secret.

function req(headers) {
  return new Request('https://swissbuildings-lookup.example/?bbox=0,0,0,0', { headers });
}

describe('clientIp', () => {
  it('uses the relayed IP when the secret matches', () => {
    const r = req({ 'CF-Connecting-IP': '10.0.0.1', 'X-Client-IP': '203.0.113.7', 'X-Edge-Secret': 's3cret' });
    expect(clientIp(r, 's3cret')).toBe('203.0.113.7');
  });

  it('ignores the relayed IP under a wrong secret', () => {
    const r = req({ 'CF-Connecting-IP': '10.0.0.1', 'X-Client-IP': '203.0.113.7', 'X-Edge-Secret': 'guess' });
    expect(clientIp(r, 's3cret')).toBe('10.0.0.1');
  });

  it('ignores the relayed IP without a secret header', () => {
    const r = req({ 'CF-Connecting-IP': '10.0.0.1', 'X-Client-IP': '203.0.113.7' });
    expect(clientIp(r, 's3cret')).toBe('10.0.0.1');
  });

  it('ignores the relayed IP when the Worker has no secret configured', () => {
    const r = req({ 'CF-Connecting-IP': '10.0.0.1', 'X-Client-IP': '203.0.113.7', 'X-Edge-Secret': '' });
    expect(clientIp(r, undefined)).toBe('10.0.0.1');
  });

  it('falls back to the connecting IP when nothing is relayed', () => {
    const r = req({ 'CF-Connecting-IP': '10.0.0.1', 'X-Edge-Secret': 's3cret' });
    expect(clientIp(r, 's3cret')).toBe('10.0.0.1');
  });

  it("returns 'unknown' with no IP at all", () => {
    expect(clientIp(req({}), 's3cret')).toBe('unknown');
  });
});
