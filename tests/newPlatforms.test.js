// Bluesky and Threads adapters
jest.mock('axios');
const axios = require('axios');
const social = require('../services/social');
const bluesky = require('../services/platforms/bluesky');
const refresher = require('../services/tokenRefresher');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
const photo = () => ({ url: null, file: async () => ({ buffer: PNG, mime: 'image/png', ext: 'png', kind: 'image' }) });
afterEach(() => jest.resetAllMocks());

describe('Bluesky', () => {
  test('links and hashtags become clickable, with byte positions (Hindi text included)', () => {
    const text = 'दिवाली offer https://chai.test/a #Diwali';
    const f = bluesky.facets(text);
    const bytes = Buffer.from(text);
    const link = f.find(x => x.features[0].uri);
    expect(bytes.slice(link.index.byteStart, link.index.byteEnd).toString()).toBe('https://chai.test/a');
    const tag = f.find(x => x.features[0].tag);
    expect(tag.features[0].tag).toBe('Diwali');
    expect(bytes.slice(tag.index.byteStart, tag.index.byteEnd).toString()).toBe('#Diwali');
  });

  test('signs in with the app password, uploads the photo, posts', async () => {
    axios.post.mockImplementation(async (url, body) => {
      if (url.endsWith('createSession')) return { data: { did: 'did:plc:x', handle: 'chai.bsky.social', accessJwt: 'JWT' } };
      if (url.endsWith('uploadBlob')) return { data: { blob: { $type: 'blob', ref: { $link: 'b1' } } } };
      if (url.endsWith('createRecord')) return { data: { uri: 'at://did:plc:x/app.bsky.feed.post/1' } };
      throw new Error('unexpected ' + url);
    });
    const r = await social.postToPlatform('bluesky', { access_token: 'app-pass', external_id: 'did:plc:x' }, 'Hello #chai', null, { media: [photo()] });
    expect(axios.post.mock.calls[0][1]).toEqual({ identifier: 'did:plc:x', password: 'app-pass' });
    const record = axios.post.mock.calls[2][1].record;
    expect(record.text).toBe('Hello #chai');
    expect(record.embed.images).toHaveLength(1);
    expect(axios.post.mock.calls[2][2].headers.Authorization).toBe('Bearer JWT');
    expect(r).toMatchObject({ success: true, platform: 'bluesky', id: 'at://did:plc:x/app.bsky.feed.post/1' });
  });

  test('long text is shortened to 300 characters with a note', async () => {
    axios.post.mockImplementation(async (url) => (url.endsWith('createSession') ? { data: { did: 'd', accessJwt: 'J' } } : { data: { uri: 'u' } }));
    const r = await social.postToPlatform('bluesky', { access_token: 'p', external_id: 'd' }, 'x'.repeat(400), null);
    expect([...axios.post.mock.calls[1][1].record.text]).toHaveLength(300);
    expect(r.warning).toMatch(/300 characters/);
  });
});

describe('Threads', () => {
  test('text post: container, then publish', async () => {
    axios.post.mockImplementation(async (url) => (url.endsWith('/threads_publish') ? { data: { id: 'T1' } } : { data: { id: 'C1' } }));
    const r = await social.postToPlatform('threads', { access_token: 'tok', external_id: 'U1' }, 'Hello Threads', null);
    expect(axios.post.mock.calls[0]).toEqual(['https://graph.threads.net/v1.0/U1/threads', { media_type: 'TEXT', text: 'Hello Threads', access_token: 'tok' }]);
    expect(axios.post.mock.calls[1][1]).toEqual({ creation_id: 'C1', access_token: 'tok' });
    expect(r).toMatchObject({ success: true, id: 'T1', platform: 'threads' });
  });

  test('the 60-day login renews itself without the app secret', async () => {
    axios.get.mockResolvedValue({ data: { access_token: 'NEW', expires_in: 5184000 } });
    const db = { schema: {}, };
    const acc = { id: 1, platform: 'threads', access_token: 'OLD', expires_at: Math.floor(Date.now() / 1000) + 30, workspace_id: 1 };
    const updates = [];
    const fakeDb = (table) => ({ whereIn: () => ({ update: async (f) => updates.push(f) }) });
    await refresher.ensureFresh(fakeDb, acc);
    expect(axios.get.mock.calls[0][1].params).toEqual({ grant_type: 'th_refresh_token', access_token: 'OLD' });
    expect(acc.access_token).toBe('NEW');
    expect(refresher.reconnectInDays({ ...acc, expires_at: Math.floor(Date.now() / 1000) + 5 * 86400 })).toBeNull(); // renews itself
  });
});
