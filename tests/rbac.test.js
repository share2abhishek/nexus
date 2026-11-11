const { can, ROLES, ACTIONS } = require('../services/rbac');

describe('rbac can()', () => {
  test('manager can publish, creator cannot', () => {
    expect(can('manager', 'content.publish')).toBe(true);
    expect(can('creator', 'content.publish')).toBe(false);
  });
  test('creator can create+submit, not approve', () => {
    expect(can('creator', 'content.create')).toBe(true);
    expect(can('creator', 'content.submit')).toBe(true);
    expect(can('creator', 'content.approve')).toBe(false);
  });
  test('reviewer and client can approve, client cannot edit', () => {
    expect(can('reviewer', 'content.approve')).toBe(true);
    expect(can('client', 'content.approve')).toBe(true);
    expect(can('client', 'content.edit')).toBe(false);
  });
  test('analyst is read-only', () => {
    expect(can('analyst', 'content.view')).toBe(true);
    expect(can('analyst', 'content.create')).toBe(false);
  });
  test('manager can manage social + members', () => {
    expect(can('manager', 'social.manage')).toBe(true);
    expect(can('manager', 'members.manage')).toBe(true);
  });
  test('unknown role denies everything', () => {
    expect(can('ghost', 'content.view')).toBe(false);
  });
});
