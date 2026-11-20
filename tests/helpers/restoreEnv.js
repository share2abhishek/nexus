// Runs before every test file (package.json "jest.setupFilesAfterEnv").
// All files share one process (--runInBand), so a file that changes process.env (for example the server edition
// switches) must not leak into the files after it. The environment as the first file saw it is kept, and every file
// starts from it. (Resetting at the start, not in afterAll, so a file's own cleanup can still read its settings.)
if (!globalThis.__NEXUS_ENV_BASELINE__) globalThis.__NEXUS_ENV_BASELINE__ = { ...process.env };
const baseline = globalThis.__NEXUS_ENV_BASELINE__;
for (const k of Object.keys(process.env)) if (!(k in baseline)) delete process.env[k];
Object.assign(process.env, baseline);
