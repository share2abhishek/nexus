# Licence public keys

The app verifies licence files with the public key(s) in this folder. Each key is a
file named `<kid>.pem`, for example `k1.pem`.

- Create the production key **once** with `npm run keys` in the licence server repository
  (a separate repo, `license-server`). It writes `public-keys/k1.pem` there and prints the
  private key for the licence server. Copy `k1.pem` into this folder and commit it.
- **Rotating keys:** add the new key (for example `k2.pem`) here and ship an app
  update **before** you switch the server to `LICENSE_KEY_ID=k2`. Keep `k1.pem` so
  existing licences stay valid.
- Never put a private key in this folder.

Without a key here, the app runs in limited mode: publishing stays disabled and
Settings → Licence says licensing is not configured.
