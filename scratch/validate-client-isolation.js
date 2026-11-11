const axios = require('axios');
const knex = require('../services/knex');

const BASE_URL = 'http://127.0.0.1:3001';

async function run() {
  console.log('🚀 Starting Client Social Connection Isolation Validation...\n');
  
  let cookieHeader = '';

  const api = axios.create({
    baseURL: BASE_URL,
    validateStatus: () => true,
  });

  // Handle cookies manually
  api.interceptors.response.use(response => {
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      cookieHeader = setCookie.map(c => c.split(';')[0]).join('; ');
    }
    return response;
  });

  api.interceptors.request.use(config => {
    if (cookieHeader) {
      config.headers['Cookie'] = cookieHeader;
    }
    return config;
  });

  // Step 1: Register agency user
  console.log('Step 1: Registering validation user...');
  const uniqueEmail = `agency-validation-${Date.now()}@test.com`;
  const registerRes = await api.post('/users/register', {
    email: uniqueEmail,
    password: 'password123',
    name: 'Agency Validation'
  });

  if (registerRes.status !== 200 || !registerRes.data.success) {
    console.error('❌ Registration failed');
    process.exit(1);
  }
  const userId = registerRes.data.user.id;

  // Step 2: Fetch default organization ID
  const orgsRes = await api.get('/workspaces/organizations');
  const orgId = orgsRes.data[0].id;

  // Step 3: Create Client A and Client B
  console.log('Step 2: Creating Client A and Client B...');
  const wsARes = await api.post('/workspaces', { orgId, name: 'Client A', slug: 'client-a', timezone: 'UTC' });
  const wsBRes = await api.post('/workspaces', { orgId, name: 'Client B', slug: 'client-b', timezone: 'UTC' });

  const wsAId = wsARes.data.id;
  const wsBId = wsBRes.data.id;
  console.log(`✅ Created Client A (ID: ${wsAId}) and Client B (ID: ${wsBId})`);

  // Step 4: Connect LinkedIn to Client A
  console.log('\nStep 3: Connecting LinkedIn to Client A...');
  await knex('social_accounts').insert({
    workspace_id: wsAId,
    platform: 'linkedin',
    account_label: 'Client A LinkedIn Profile',
    external_id: 'li-client-a',
    access_token: 'tok-a',
    status: 'active'
  });

  // Step 5: Connect Facebook to Client B
  console.log('Step 4: Connecting Facebook to Client B...');
  await knex('social_accounts').insert({
    workspace_id: wsBId,
    platform: 'facebook',
    account_label: 'Client B Facebook Page',
    external_id: 'fb-client-b',
    access_token: 'tok-b',
    status: 'active'
  });

  // Step 6: Verify active connection status for Client A
  console.log('\nStep 5: Verifying active connection status when managing Client A...');
  // Switch session context to Client A
  await api.post('/session/active-workspace', { workspaceId: wsAId });
  
  // Call /auth/status (which queries active connection status)
  const authStatusARes = await api.get('/auth/status');
  console.log('Client A Auth Status connected platforms:');
  Object.entries(authStatusARes.data).forEach(([platform, status]) => {
    if (status.connected) {
      console.log(`  - ${platform}: CONNECTED (Label: ${status.profile?.name || status.board_id || 'Active'})`);
    }
  });

  // Assertions for Client A
  if (!authStatusARes.data.linkedin.connected || authStatusARes.data.facebook.connected) {
    console.error('❌ Social media connection isolation assertion failed for Client A!');
    await cleanUp(userId);
    process.exit(1);
  }
  console.log('✅ Client A correctly only sees its own LinkedIn connection.');

  // Step 7: Verify active connection status for Client B
  console.log('\nStep 6: Verifying active connection status when managing Client B...');
  // Switch session context to Client B
  await api.post('/session/active-workspace', { workspaceId: wsBId });
  
  // Call /auth/status
  const authStatusBRes = await api.get('/auth/status');
  console.log('Client B Auth Status connected platforms:');
  Object.entries(authStatusBRes.data).forEach(([platform, status]) => {
    if (status.connected) {
      console.log(`  - ${platform}: CONNECTED (Label: ${status.profile?.name || status.board_id || 'Active'})`);
    }
  });

  // Assertions for Client B
  if (authStatusBRes.data.linkedin.connected || !authStatusBRes.data.facebook.connected) {
    console.error('❌ Social media connection isolation assertion failed for Client B!');
    await cleanUp(userId);
    process.exit(1);
  }
  console.log('✅ Client B correctly only sees its own Facebook connection.');

  // Step 8: Verify workspaces detailed metrics listing shows isolated accounts
  console.log('\nStep 7: Verifying workspaces summary listing shows respective platform connections...');
  const workspacesRes = await api.get('/workspaces');
  
  const clientAEntry = workspacesRes.data.find(w => w.workspace_id === wsAId);
  const clientBEntry = workspacesRes.data.find(w => w.workspace_id === wsBId);

  console.log(`Client A (${clientAEntry.name}):`);
  console.log(`  Platforms connected:`, clientAEntry.social_accounts);
  console.log(`Client B (${clientBEntry.name}):`);
  console.log(`  Platforms connected:`, clientBEntry.social_accounts);

  if (
    clientAEntry.social_accounts.length !== 1 || clientAEntry.social_accounts[0].platform !== 'linkedin' ||
    clientBEntry.social_accounts.length !== 1 || clientBEntry.social_accounts[0].platform !== 'facebook'
  ) {
    console.error('❌ Client summary listing isolation validation failed!');
    await cleanUp(userId);
    process.exit(1);
  }
  console.log('✅ Workspaces summary listing isolation asserted.');

  // Clean up
  await cleanUp(userId);
  console.log('\n🎉 SOCIAL CONNECTIONS ISOLATION VALIDATION SUCCESSFUL! 🎉');
  process.exit(0);
}

async function cleanUp(userId) {
  console.log('\n🧼 Cleaning up validation data...');
  try {
    const memberships = await knex('memberships').where({ user_id: userId });
    for (const m of memberships) {
      // Cascade-delete will wipe associated social accounts
      await knex('workspaces').where({ id: m.workspace_id }).del();
    }
    const orgMembers = await knex('org_members').where({ user_id: userId });
    for (const om of orgMembers) {
      await knex('organizations').where({ id: om.org_id }).del();
    }
    await knex('users').where({ id: userId }).del();
    console.log('✅ Clean up complete.');
  } catch (err) {
    console.error('⚠️ Clean up error:', err.message);
  }
}

run();
