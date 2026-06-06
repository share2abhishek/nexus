// Single source of truth for per-workspace permissions.
const MATRIX = {
  manager:  ['social.manage','members.manage','content.create','content.edit','content.submit',
             'content.approve','content.comment','content.publish','content.schedule',
             'content.view','analytics.view'],
  creator:  ['content.create','content.edit','content.submit','content.view','analytics.view'],
  reviewer: ['content.approve','content.comment','content.view','analytics.view'],
  client:   ['content.approve','content.comment','content.view','analytics.view'],
  analyst:  ['content.view','analytics.view'],
};

const ROLES = Object.keys(MATRIX);
const ACTIONS = [...new Set(Object.values(MATRIX).flat())];

function can(role, action) {
  const perms = MATRIX[role];
  return Array.isArray(perms) && perms.includes(action);
}

module.exports = { can, ROLES, ACTIONS, MATRIX };
