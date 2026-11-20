// Voice assistant V2 core (docs/platform/VOICE-AGENTS.md 8): WhatsApp calls answered by the business's AI assistant.
// Every table carries org_id and workspace_id (platform section 11). Nothing reads these tables unless VOICE_ENABLED=true.
// Retention: a daily job deletes audio files and transcript turns after voice_assistant.retention_days (UrbanSociety: 30).
// ROLLBACK: `down` drops only these voice_* tables; no other table changes.
const TABLES = ['voice_webhook_event', 'voice_transcript_turn', 'voice_call', 'voice_call_permission', 'voice_assistant'];

async function create(knex, name, build) {
  if (await knex.schema.hasTable(name)) return;
  await knex.schema.createTable(name, build);
}

exports.up = async (knex) => {
  // One assistant per workspace for the PoC (a later phase allows several)
  await create(knex, 'voice_assistant', (t) => {
    t.increments('id');
    t.integer('org_id').notNullable();
    t.integer('workspace_id').notNullable().unique();
    t.string('name', 60).notNullable();
    t.string('greeting', 1000).notNullable();
    t.text('instructions'); // persona, style, goals, objections, never-say list (the system prompt body)
    t.text('voice_controls'); // json: { voice, speed, pitchHint, pauseMs, endOfTurnMs, bargeIn, noiseSuppression, maxCallSec, silenceSec }
    t.text('models'); // json: { stt: {provider, model}, llm: {provider, model, temperature}, tts: {provider, model, voice} }
    t.text('handover'); // json: { phone, hoursFrom: '08:00', hoursTo: '22:00', days: [0..6], message }
    t.boolean('kb_enabled').notNullable().defaultTo(true);
    t.boolean('recording_on').notNullable().defaultTo(true);
    t.integer('retention_days').notNullable().defaultTo(30);
    t.boolean('active').notNullable().defaultTo(false);
    t.integer('created_at').notNullable();
    t.integer('updated_at').notNullable();
    t.integer('updated_by');
    t.index(['org_id']);
  });

  await create(knex, 'voice_call_permission', (t) => {
    t.increments('id');
    t.integer('org_id').notNullable();
    t.integer('workspace_id').notNullable();
    t.string('contact', 40).notNullable(); // WhatsApp id (digits)
    t.integer('requested_at');
    t.integer('granted_at');
    t.integer('expires_at');
    t.integer('revoked_at');
    t.string('source', 30); // chat_offer | webchat | manual
    t.unique(['workspace_id', 'contact']);
  });

  await create(knex, 'voice_call', (t) => {
    t.increments('id');
    t.integer('org_id').notNullable();
    t.integer('workspace_id').notNullable();
    t.integer('assistant_id');
    t.integer('lead_id');
    t.string('direction', 20).notNullable(); // USER_INITIATED | BUSINESS_INITIATED
    t.string('contact', 40); // caller's WhatsApp number (digits)
    t.string('wa_call_id', 200).unique();
    t.string('wa_phone_number_id', 64);
    t.string('status', 20).notNullable(); // ringing | answering | active | ended | failed | rejected
    t.integer('started_at');
    t.integer('answered_at');
    t.integer('ended_at');
    t.integer('duration_sec');
    t.string('end_reason', 60);
    t.string('outcome', 30);
    t.string('next_step', 500);
    t.text('summary');
    t.text('models'); // json snapshot of the models used
    t.integer('tokens_in');
    t.integer('tokens_out');
    t.integer('stt_seconds');
    t.integer('tts_chars');
    t.string('recording_key', 300);
    t.integer('recording_bytes');
    t.integer('recording_deleted_at');
    t.integer('transcript_deleted_at');
    t.string('error', 300);
    t.integer('created_at').notNullable();
    t.integer('updated_at').notNullable();
    t.index(['org_id', 'workspace_id', 'started_at']);
  });

  await create(knex, 'voice_transcript_turn', (t) => {
    t.increments('id');
    t.integer('org_id').notNullable();
    t.integer('workspace_id').notNullable();
    t.integer('call_id').notNullable().references('id').inTable('voice_call').onDelete('CASCADE');
    t.integer('seq').notNullable();
    t.string('speaker', 12).notNullable(); // assistant | caller | staff
    t.integer('start_ms');
    t.integer('end_ms');
    t.string('lang', 12);
    t.text('text').notNullable();
    t.integer('stt_ms');
    t.integer('llm_ms');
    t.integer('tts_ms');
    t.unique(['call_id', 'seq']);
  });

  await create(knex, 'voice_webhook_event', (t) => {
    t.increments('id');
    t.string('event_key', 260).notNullable().unique(); // `${wa_call_id}:${event}`
    t.integer('received_at').notNullable();
  });
};

exports.down = async (knex) => {
  for (const name of TABLES) await knex.schema.dropTableIfExists(name);
};
