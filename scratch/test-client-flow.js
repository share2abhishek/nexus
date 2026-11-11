const axios = require('axios');
const knex = require('../services/knex');

const BASE_URL = 'http://127.0.0.1:3001';

async function run() {
  console.log('🚀 Starting end-to-end Client Management flow integration test...\n');
  
  // Use axios with a cookie jar or manual cookie forwarding
  let cookieHeader = '';

  const api = axios.create({
    baseURL: BASE_URL,
    validateStatus: () => true, // don't throw on error status codes
  });

  // Intercept responses to extract cookies
  api.interceptors.response.use(response => {
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      cookieHeader = setCookie.map(c => c.split(';')[0]).join('; ');
    }
    return response;
  });

  // Intercept requests to attach cookies
  api.interceptors.request.use(config => {
    if (cookieHeader) {
      config.headers['Cookie'] = cookieHeader;
    }
    return config;
  });

  // Step 1: Register a new user
  console.log('Step 1: Registering new agency user...');
  const uniqueEmail = `agency-${Date.now()}@test.com`;
  const registerRes = await api.post('/users/register', {
    email: uniqueEmail,
    password: 'password123',
    name: 'Agency Pro'
  });

  if (registerRes.status !== 200 || !registerRes.data.success) {
    console.error('❌ Registration failed:', registerRes.data);
    process.exit(1);
  }
  const userId = registerRes.data.user.id;
  console.log(`✅ Registered successfully as ${uniqueEmail} (user_id: ${userId})`);

  // Step 2: Fetch workspaces (triggers auto-creation of default workspace)
  console.log('\nStep 2: Fetching workspaces for the user (should trigger default workspace auto-creation)...');
  const workspacesRes = await api.get('/workspaces');
  
  if (workspacesRes.status !== 200) {
    console.error('❌ Failed to fetch workspaces:', workspacesRes.data);
    await cleanUp(userId);
    process.exit(1);
  }
  
  console.log('✅ Workspaces list received:');
  console.log(JSON.stringify(workspacesRes.data, null, 2));

  // Assertions
  const defaultWs = workspacesRes.data[0];
  if (!defaultWs || defaultWs.name !== "Agency Pro's Workspace" || defaultWs.member_count !== 1) {
    console.error('❌ Default workspace auto-creation assertion failed!');
    await cleanUp(userId);
    process.exit(1);
  }
  console.log('✅ Default workspace auto-creation successfully asserted.');

  // Step 3: Fetch organizations
  console.log('\nStep 3: Fetching organizations the user belongs to...');
  const orgsRes = await api.get('/workspaces/organizations');
  if (orgsRes.status !== 200 || orgsRes.data.length === 0) {
    console.error('❌ Failed to fetch organizations:', orgsRes.data);
    await cleanUp(userId);
    process.exit(1);
  }
  const orgId = orgsRes.data[0].id;
  console.log(`✅ Organization found: "${orgsRes.data[0].name}" (org_id: ${orgId})`);

  // Step 4: Create a new client workspace
  console.log('\nStep 4: Creating a new client workspace ("Pepsi Co")...');
  const createWsRes = await api.post('/workspaces', {
    orgId,
    name: 'Pepsi Co',
    slug: 'pepsi-co',
    timezone: 'UTC'
  });

  if (createWsRes.status !== 201) {
    console.error('❌ Failed to create client workspace:', createWsRes.data);
    await cleanUp(userId);
    process.exit(1);
  }
  const pepsiWsId = createWsRes.data.id;
  console.log(`✅ Created Pepsi Co workspace successfully (workspace_id: ${pepsiWsId})`);

  // Step 5: Switch session context to the new workspace
  console.log('\nStep 5: Switching active workspace session context to Pepsi Co...');
  const switchRes = await api.post('/session/active-workspace', {
    workspaceId: pepsiWsId
  });

  if (switchRes.status !== 200 || !switchRes.data.ok) {
    console.error('❌ Failed to switch workspace session:', switchRes.data);
    await cleanUp(userId);
    process.exit(1);
  }
  console.log('✅ Switched context in session.');

  // Step 6: Connect a mock social account to Pepsi Co
  console.log('\nStep 6: Simulating social media channel connection (inserting active account in DB)...');
  await knex('social_accounts').insert({
    workspace_id: pepsiWsId,
    platform: 'instagram',
    account_label: 'Pepsi Instagram',
    external_id: 'ig-pepsi-123',
    access_token: 'mock-token-xyz',
    status: 'active'
  });
  console.log('✅ Mock social media channel connected to Pepsi Co.');

  // Step 7: List workspaces again to verify metrics
  console.log('\nStep 7: Verifying enhanced client details listing...');
  const workspacesListRes = await api.get('/workspaces');
  if (workspacesListRes.status !== 200) {
    console.error('❌ Failed to fetch workspaces list:', workspacesListRes.data);
    await cleanUp(userId);
    process.exit(1);
  }

  const pepsiWs = workspacesListRes.data.find(w => w.workspace_id === pepsiWsId);
  if (!pepsiWs) {
    console.error('❌ Pepsi Co workspace missing in listing!');
    await cleanUp(userId);
    process.exit(1);
  }

  console.log('Enhanced Pepsi Co workspace entry:');
  console.log(JSON.stringify(pepsiWs, null, 2));

  // Assertions
  if (pepsiWs.member_count !== 1 || pepsiWs.social_accounts.length !== 1 || pepsiWs.social_accounts[0].platform !== 'instagram') {
    console.error('❌ Client metrics assertions failed!');
    await cleanUp(userId);
    process.exit(1);
  }
  console.log('✅ Client metrics successfully verified.');

  // Step 8: Delete client workspace
  console.log('\nStep 8: Deleting Pepsi Co client workspace...');
  const deleteRes = await api.delete(`/workspaces/${pepsiWsId}`);
  if (deleteRes.status !== 200 || !deleteRes.data.success) {
    console.error('❌ Failed to delete workspace:', deleteRes.data);
    await cleanUp(userId);
    process.exit(1);
  }
  console.log('✅ Pepsi Co deleted successfully.');

  // Verify deletion in database
  const check = await knex('workspaces').where({ id: pepsiWsId }).first();
  if (check) {
    console.error('❌ Workspace still exists in DB after deletion!');
    await cleanUp(userId);
    process.exit(1);
  }
  console.log('✅ Pepsi Co verified deleted in DB.');

  // Clean up
  await cleanUp(userId);
  console.log('\n🎉 ALL CLIENT FLOW INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
  process.exit(0);
}

async function cleanUp(userId) {
  console.log('\n🧼 Cleaning up test user data...');
  try {
    // Delete memberships and organizations created for test user
    const memberships = await knex('memberships').where({ user_id: userId });
    for (const m of memberships) {
      await knex('workspaces').where({ id: m.workspace_id }).del();
    }
    const orgMembers = await knex('org_members').where({ user_id: userId });
    for (const om of orgMembers) {
      await knex('organizations').where({ id: om.org_id }).del();
    }
    await knex('users').where({ id: userId }).del();
    console.log('✅ Clean up complete.');
  } catch (err) {
    console.error('⚠️ Error during clean up:', err.message);
  }
}

run();
