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
  try {
    // 1. Process and dispatch approved due outreach emails
    const dispatchResult = await processDueOutbox(knex, repo, { maxBatch: 15, ...options });
    // Runs every minute: only speak when there was something to do, or something is wrong
    if (dispatchResult.total_due || dispatchResult.error) {
      console.log(`[Sellbird Heartbeat] ${dispatchResult.total_due || 0} due, ${dispatchResult.sent || 0} sent${dispatchResult.error ? ` — ${dispatchResult.error}` : ''}${dispatchResult.not_set_up ? ` (${dispatchResult.not_set_up} waiting: email sending is not set up)` : ''}.`);
    }

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
