// Lists every route of an Express 4 app with the middleware that runs before it (S0, route inventory).
// Each entry: { method, path, guards: { auth, workspace, admin, superAdmin, permission } }.
//   auth        requireAuth (or an admin guard, which also needs a signed-in user) runs first
//   workspace   withWorkspace (tenancy) runs first
//   admin       requireAdmin / requireSuperAdmin
//   permission  the action of a requirePermission(action) middleware (tagged with fn.accessPermission)
// Middleware mounted on a path (app.use('/api', requireAuth, ...)) only counts for routes under that path.

function mountPath(layer) {
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  let src = layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/i, '')   // trailing "/?(?=/|$)"
    .replace(/\(\?=\\\/\|\$\)$/i, '')
    .replace(/\\\//g, '/');
  let i = 0;
  src = src.replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, () => `:${(layer.keys[i++] || {}).name || 'param'}`);
  return src.replace(/\\(.)/g, '$1');
}

const covers = (scope, path) => !scope || path === scope || path.startsWith(scope.endsWith('/') ? scope : `${scope}/`);

// items: [{ name, fn }]. The name comes from the Express layer: express-async-errors wraps every handler in a
// function called "newFn", but the layer keeps the original name (and the wrapper copies fn.accessPermission).
function guardsOf(items) {
  const g = { auth: false, workspace: false, admin: false, superAdmin: false, permission: null };
  for (const { name, fn: f } of items) {
    if (name === 'requireAuth') g.auth = true;
    if (name === 'withWorkspace') g.workspace = true;
    if (name === 'requireAdmin') { g.admin = true; g.auth = true; }
    if (name === 'requireSuperAdmin') { g.superAdmin = true; g.auth = true; }
    if (f && f.accessPermission) g.permission = f.accessPermission;
  }
  return g;
}

function walk(stack, prefix = '', inherited = [], out = []) {
  const before = [...inherited]; // [{ scope, fn }]
  for (const layer of stack) {
    if (layer.route) {
      const full = (prefix + layer.route.path).replace(/\/+/g, '/') || '/';
      const fns = [...before.filter((b) => covers(b.scope, full)), ...layer.route.stack.map((l) => ({ name: l.name, fn: l.handle }))];
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        out.push({ method: method.toUpperCase(), path: full, guards: guardsOf(fns) });
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const sub = (prefix + mountPath(layer)).replace(/\/+/g, '/');
      walk(layer.handle.stack, sub, before.filter((b) => covers(b.scope, sub || '/') || covers(sub, b.scope)), out);
    } else if (layer.handle) {
      before.push({ scope: (prefix + mountPath(layer)).replace(/\/+/g, '/'), name: layer.name, fn: layer.handle });
    }
  }
  return out;
}

const inventory = (app) => walk(app._router.stack);

module.exports = { inventory, walk, mountPath };
