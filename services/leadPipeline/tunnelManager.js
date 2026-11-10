// services/leadPipeline/tunnelManager.js
// Automated Public HTTPS Tunnel & Webhook Manager for Social-Nexus.
// Supports:
// 1. Production Server Mode (automatic when PUBLIC_URL / APP_URL or non-local host is configured)
// 2. Local Mode (automatically provisions a zero-config Cloudflare HTTPS tunnel for Meta Webhooks)

const { spawn, exec } = require('child_process');

class TunnelManager {
  constructor() {
    this.process = null;
    this.status = 'idle'; // 'idle' | 'starting' | 'connected' | 'error' | 'server_ready'
    this.mode = 'unknown'; // 'local' | 'server'
    this.publicUrl = null;
    this.provider = 'none'; // 'server' | 'cloudflare' | 'manual'
    this.port = 3000;
    this.error = null;
    this.restartAttempts = 0;
    this.maxRestarts = 5;
    this.restartTimer = null;
    this.isStopping = false;
    this.listeners = new Set();
  }

  /**
   * Determine whether the app is running in Server Mode or Local Mode.
   */
  resolveEnvironment() {
    const publicUrlEnv = process.env.PUBLIC_URL || process.env.APP_URL || process.env.WEBHOOK_BASE_URL;
    if (publicUrlEnv && !publicUrlEnv.includes('localhost') && !publicUrlEnv.includes('127.0.0.1')) {
      return {
        isServer: true,
        publicUrl: publicUrlEnv.replace(/\/+$/, ''),
      };
    }

    // A public tunnel puts this PC's Social-Nexus on the internet, so it only
    // starts when the user turned it on (WhatsApp setup → Start tunnel, or
    // AUTO_TUNNEL=true). It used to start on every launch, via `npx cloudflared`
    // (downloaded at run time), without asking.
    if (process.env.AUTO_TUNNEL !== 'true' || process.env.DISABLE_TUNNEL === 'true') {
      return {
        isServer: false,
        disabled: true,
      };
    }

    return {
      isServer: false,
      disabled: false,
    };
  }

  /**
   * Start tunnel or bind server mode
   */
  // force: the user pressed "Start tunnel" (an explicit choice, so the default-off rule doesn't apply)
  async start(port = 3000, { force = false } = {}) {
    this.port = Number(port) || 3000;
    this.isStopping = false;

    const env = this.resolveEnvironment();
    if (force && env.disabled && process.env.DISABLE_TUNNEL !== 'true') env.disabled = false;

    // SITUATION B: Running on Server with a public domain (e.g. app.yourbusiness.com)
    if (env.isServer) {
      this.mode = 'server';
      this.status = 'server_ready';
      this.provider = 'server';
      this.publicUrl = env.publicUrl;
      this.error = null;
      console.log(`[TunnelManager] 🌐 Running in Server Mode with public URL: ${this.publicUrl}`);
      console.log(`[TunnelManager] 📡 Meta Webhook Endpoint: ${this.getWebhookUrl()}`);
      this._notify();
      return this.getStatus();
    }

    // Explicitly disabled
    if (env.disabled) {
      this.mode = 'local';
      this.status = 'disabled';
      this.provider = 'none';
      this.publicUrl = `http://localhost:${this.port}`;
      console.log('[TunnelManager] Public tunnel is off (turn it on in WhatsApp setup when you need Meta webhooks).');
      this._notify();
      return this.getStatus();
    }

    // SITUATION A: Running on Localhost (Auto-Tunnel)
    this.mode = 'local';
    return this._spawnCloudflareTunnel();
  }

  /**
   * Spawn Cloudflare Quick Tunnel child process
   */
  _spawnCloudflareTunnel() {
    if (this.process) {
      this.stop();
    }

    this.status = 'starting';
    this.provider = 'cloudflare';
    this.error = null;
    this._notify();

    console.log(`[TunnelManager] ⚡ Spawning automatic Cloudflare HTTPS tunnel for port ${this.port}...`);

    try {
      const isWin = process.platform === 'win32';
      // Use npx to launch cloudflared quick tunnel
      const cmd = isWin ? 'npx.cmd' : 'npx';
      const args = ['cloudflared', 'tunnel', '--url', `http://localhost:${this.port}`];

      this.process = spawn(cmd, args, {
        shell: isWin,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const handleOutput = (data) => {
        const text = data.toString();
        // Match Cloudflare tunnel URL: https://something.trycloudflare.com
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
        if (match && (!this.publicUrl || this.publicUrl !== match[0])) {
          this.publicUrl = match[0];
          this.status = 'connected';
          this.restartAttempts = 0;
          this.error = null;
          console.log(`[TunnelManager] ✅ Cloudflare HTTPS Tunnel Active: ${this.publicUrl}`);
          console.log(`[TunnelManager] 📡 Meta Webhook URL: ${this.getWebhookUrl()}`);
          this._notify();
        }
      };

      this.process.stdout.on('data', handleOutput);
      this.process.stderr.on('data', handleOutput);

      this.process.on('error', (err) => {
        console.warn(`[TunnelManager] Process error:`, err.message);
        this.error = err.message;
        this.status = 'error';
        this._notify();
      });

      this.process.on('close', (code) => {
        this.process = null;
        if (!this.isStopping && this.mode === 'local') {
          console.warn(`[TunnelManager] Tunnel closed with code ${code}.`);
          if (this.restartAttempts < this.maxRestarts) {
            this.restartAttempts++;
            this.status = 'reconnecting';
            this._notify();
            console.log(`[TunnelManager] Reconnecting tunnel in 4s (attempt ${this.restartAttempts}/${this.maxRestarts})...`);
            this.restartTimer = setTimeout(() => {
              if (!this.isStopping) this._spawnCloudflareTunnel();
            }, 4000);
          } else {
            this.status = 'error';
            this.error = 'Max tunnel reconnect attempts reached';
            this._notify();
          }
        } else {
          this.status = 'stopped';
          this._notify();
        }
      });
    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      console.error(`[TunnelManager] Failed to launch tunnel:`, err.message);
      this._notify();
    }

    return this.getStatus();
  }

  /**
   * Stop active tunnel process cleanly
   */
  stop() {
    this.isStopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.process) {
      const pid = this.process.pid;
      try {
        if (process.platform === 'win32') {
          exec(`taskkill /pid ${pid} /T /F`, () => {});
        } else {
          this.process.kill('SIGTERM');
        }
      } catch {}
      this.process = null;
    }

    this.status = 'stopped';
    this._notify();
  }

  /**
   * Restart tunnel manually
   */
  async restart() {
    this.restartAttempts = 0;
    this.stop();
    await new Promise((r) => setTimeout(r, 600));
    return this.start(this.port, { force: true });
  }

  /**
   * Get active webhook URL based on resolved public URL or fallback
   */
  getWebhookUrl() {
    const base = this.publicUrl || `http://localhost:${this.port}`;
    return `${base.replace(/\/+$/, '')}/api/webhooks/meta`;
  }

  /**
   * Get comprehensive status for UI and API consumption
   */
  getStatus() {
    return {
      mode: this.mode, // 'local' | 'server'
      status: this.status, // 'server_ready' | 'connected' | 'starting' | 'reconnecting' | 'stopped' | 'error' | 'disabled'
      provider: this.provider, // 'server' | 'cloudflare' | 'none'
      port: this.port,
      publicUrl: this.publicUrl,
      webhookUrl: this.getWebhookUrl(),
      isTunnel: this.provider === 'cloudflare',
      isHttps: !!(this.publicUrl && this.publicUrl.startsWith('https://')),
      error: this.error,
    };
  }

  onUpdate(callback) {
    if (typeof callback === 'function') {
      this.listeners.add(callback);
    }
    return () => this.listeners.delete(callback);
  }

  _notify() {
    const currentStatus = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(currentStatus);
      } catch {}
    }
  }
}

// Singleton instance across application
const instance = new TunnelManager();

// Clean up child process on Node exit
process.on('exit', () => {
  try { instance.stop(); } catch {}
});

module.exports = instance;
