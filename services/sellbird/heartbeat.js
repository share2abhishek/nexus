// services/sellbird/heartbeat.js
// Autonomous 15-minute task execution loop for Sellbird sales agent.

const { processDueOutbox } = require('./dispatcher');
const sellbirdRepoFactory = require('../../repos/sellbirdRepo');

let isRunning = false;
let lastRunAt = 0;

async function runHeartbeat(knex, options = {}) {
  if (isRunning) return { skipped: true, reason: 'Already running' };
  isRunning = true;
  lastRunAt = Math.floor(Date.now() / 1000);

  const repo = sellbirdRepoFactory(knex);
  console.log('[Sellbird Heartbeat] Starting autonomous loop cycle...');

  try {
    // 1. Process and dispatch approved due outreach emails
    const dispatchResult = await processDueOutbox(knex, repo, { maxBatch: 15, ...options });
    console.log(`[Sellbird Heartbeat] Dispatch completed: ${dispatchResult.sent} emails sent.`);

    return {
      success: true,
      timestamp: lastRunAt,
      dispatch: dispatchResult,
      sent_count: dispatchResult.sent || 0,
      processed_count: dispatchResult.total_due || 0,
      error_count: 0,
    };
  } catch (err) {
    console.error('[Sellbird Heartbeat] Error in loop:', err.message);
    return { success: false, error: err.message };
  } finally {
    isRunning = false;
  }
}

function getLastRun() {
  return lastRunAt;
}

module.exports = {
  runHeartbeat,
  getLastRun,
};
