import { describe, it, expect } from 'vitest';
import {
  isPrivateIpv4,
  resolveLocalApi,
  resolveLocalStorefront,
} from '../vendor/localApi.mjs';
import { createRequestId } from '../vendor/requestId.mjs';
const page = (url) => new URL(url);
describe('Local network API routing', () => {
  it('keeps View store on the laptop Wi-Fi address and preserves deployed store links', () => {
    expect(
      resolveLocalStorefront(
        'http://localhost:5173',
        page('http://192.168.100.43:5174')
      )
    ).toBe('http://192.168.100.43:5173');
    expect(
      resolveLocalStorefront(
        'https://shop.example.com',
        page('http://192.168.100.43:5174')
      )
    ).toBe('https://shop.example.com');
    expect(
      resolveLocalStorefront(
        'http://localhost:5173',
        page('https://admin.example.com')
      )
    ).toBe('http://localhost:5173');
  });
  it('uses native cryptographic UUIDs when available', () => {
    expect(createRequestId({ randomUUID: () => 'native-uuid' })).toBe(
      'native-uuid'
    );
  });
  it('creates valid random v4 retry IDs on an HTTP phone without randomUUID', () => {
    const source = {
      getRandomValues: (values) => globalThis.crypto.getRandomValues(values),
    };
    const ids = Array.from({ length: 100 }, () => createRequestId(source));
    expect(new Set(ids).size).toBe(100);
    for (const id of ids)
      expect(id).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
      );
  });
  it('recognizes only valid private IPv4 addresses', () => {
    for (const ip of [
      '192.168.100.43',
      '10.0.0.2',
      '172.16.0.2',
      '172.31.255.1',
    ])
      expect(isPrivateIpv4(ip)).toBe(true);
    for (const ip of [
      '127.0.0.1',
      '172.32.0.1',
      '192.168.999.1',
      '8.8.8.8',
      '192.168.1.2.evil',
      '192.168.01.2',
    ])
      expect(isPrivateIpv4(ip)).toBe(false);
  });
  it('routes a phone’s localhost API through the trusted development server proxy', () => {
    for (const port of [5173, 5174, 4173])
      expect(
        resolveLocalApi(
          'http://localhost:5000/api',
          page(`http://192.168.100.43:${port}`)
        )
      ).toBe('/api');
  });
  it('preserves desktop fixture URLs and explicit public backend integrations', () => {
    expect(
      resolveLocalApi(
        'http://127.0.0.1:5001/api',
        page('http://localhost:5183')
      )
    ).toBe('http://127.0.0.1:5001/api');
    expect(
      resolveLocalApi(
        'https://api.example.com/api',
        page('http://192.168.100.43:5174')
      )
    ).toBe('https://api.example.com/api');
    expect(resolveLocalApi('/api', page('https://shop.example.com'))).toBe(
      '/api'
    );
  });
  it('does not rewrite arbitrary hosts, HTTPS deployments or unknown ports', () => {
    for (const url of [
      'http://evil.example:5174',
      'https://192.168.100.43:5174',
      'http://192.168.100.43:9999',
    ])
      expect(resolveLocalApi('http://localhost:5000/api', page(url))).toBe(
        'http://localhost:5000/api'
      );
  });
});
