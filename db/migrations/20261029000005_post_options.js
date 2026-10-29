// Per-post options (JSON): several photos/videos (carousel), how it goes out on
// Instagram (feed, reel or story) and a first comment.
//   { media: ["media:12", "media:13"], ig_format: "feed"|"reel"|"story", first_comment: "…" }
// image_url keeps the first picture, so older code and views still work.
exports.up = async function (knex) {
  if (await knex.schema.hasColumn('content_items', 'options')) return;
  await knex.schema.alterTable('content_items', (t) => { t.text('options'); });
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('content_items', 'options')) {
    await knex.schema.alterTable('content_items', (t) => { t.dropColumn('options'); });
  }
};
