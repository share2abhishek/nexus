// tests/tunnelManager.test.js
const request = require('supertest');

describe('TunnelManager Service & Route Verification', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('resolveEnvironment() detects Server Mode when PUBLIC_URL is provided', () => {
    process.env.PUBLIC_URL = 'https://urbansociety.in';
    delete process.env.AUTO_TUNNEL;

    // Fresh instance check
    delete require.cache[require.resolve('../services/leadPipeline/tunnelManager')];
    const tunnelManager = require('../services/leadPipeline/tunnelManager');

    const env = tunnelManager.resolveEnvironment();
    expect(env.isServer).toBe(true);
    expect(env.publicUrl).toBe('https://urbansociety.in');
  });

  test('resolveEnvironment() detects Server Mode when APP_URL is provided', () => {
    delete process.env.PUBLIC_URL;
    process.env.APP_URL = 'https://api.radixile.com';

    delete require.cache[require.resolve('../services/leadPipeline/tunnelManager')];
    const tunnelManager = require('../services/leadPipeline/tunnelManager');

    const env = tunnelManager.resolveEnvironment();
    expect(env.isServer).toBe(true);
    expect(env.publicUrl).toBe('https://api.radixile.com');
  });

  test('resolveEnvironment() respects AUTO_TUNNEL=false', () => {
    delete process.env.PUBLIC_URL;
    delete process.env.APP_URL;
    process.env.AUTO_TUNNEL = 'false';

    delete require.cache[require.resolve('../services/leadPipeline/tunnelManager')];
    const tunnelManager = require('../services/leadPipeline/tunnelManager');

    const env = tunnelManager.resolveEnvironment();
    expect(env.isServer).toBe(false);
    expect(env.disabled).toBe(true);
  });

  test('tunnelManager.start() in Server Mode sets status server_ready and correct webhook URL', async () => {
    process.env.PUBLIC_URL = 'https://urbansociety.in';

    delete require.cache[require.resolve('../services/leadPipeline/tunnelManager')];
    const tunnelManager = require('../services/leadPipeline/tunnelManager');

    const status = await tunnelManager.start(3000);
    expect(status.mode).toBe('server');
    expect(status.status).toBe('server_ready');
    expect(status.isTunnel).toBe(false);
    expect(status.isHttps).toBe(true);
    expect(status.publicUrl).toBe('https://urbansociety.in');
    expect(status.webhookUrl).toBe('https://urbansociety.in/api/webhooks/meta');
  });

  test('tunnelManager.getStatus() returns standard telemetry shape', () => {
    delete require.cache[require.resolve('../services/leadPipeline/tunnelManager')];
    const tunnelManager = require('../services/leadPipeline/tunnelManager');

    const s = tunnelManager.getStatus();
    expect(s).toHaveProperty('mode');
    expect(s).toHaveProperty('status');
    expect(s).toHaveProperty('provider');
    expect(s).toHaveProperty('port');
    expect(s).toHaveProperty('publicUrl');
    expect(s).toHaveProperty('webhookUrl');
    expect(s).toHaveProperty('isTunnel');
    expect(s).toHaveProperty('isHttps');
  });
});
