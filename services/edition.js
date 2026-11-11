// Desktop app or server? Some features need to run all the time (the SEO
// autopilot re-checks websites on a schedule), so they are on only for the
// server edition: NEXUS_MODE=server, or the cloud database (DB_CLIENT=pg).
const isServer = () => process.env.NEXUS_MODE === 'server' || process.env.DB_CLIENT === 'pg';

// Features only the server edition has, for the screens to show or hide
const features = () => ({ server: isServer(), seo_autopilot: isServer() });

const SERVER_ONLY_MESSAGE = 'This is part of the Social-Nexus server edition, which runs all the time. It isn’t available in the desktop app.';

// Local AI (Ollama) runs on the same computer. On the desktop app it is on unless
// switched off; on the server it is off unless Radixile runs one (OLLAMA_ENABLED=true).
const ollamaDefault = () => (isServer() ? process.env.OLLAMA_ENABLED === 'true' : process.env.OLLAMA_ENABLED !== 'false');

module.exports = { isServer, features, ollamaDefault, SERVER_ONLY_MESSAGE };
