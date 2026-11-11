// Carousels, Reels, Stories, several photos and first comments
jest.mock('axios');
jest.mock('dns', () => ({ ...jest.requireActual('dns'), promises: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] } }));
const axios = require('axios');
const social = require('../services/social');
const { GRAPH } = require('../services/platforms/apiVersions');
const { cleanOptions } = require('../services/postOptions');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
const photo = () => ({ url: null, file: async () => ({ buffer: PNG, mime: 'image/png', ext: 'png', kind: 'image' }) });
const video = () => ({ url: null, file: async () => ({ buffer: MP4, mime: 'video/mp4', ext: 'mp4', kind: 'video' }) });
const link = (u) => ({ url: u, linkIsVideo: false, file: async () => { throw new Error('not downloaded'); } });

afterEach(() => jest.resetAllMocks());

describe('post options', () => {
  test('are checked and tidied', () => {
    expect(cleanOptions({ media: ['media:1', 'https://x.test/a.jpg', 'javascript:alert(1)'], ig_format: 'reel', first_comment: '  #tags  ' }))
      .toEqual({ media: ['media:1', 'https://x.test/a.jpg'], ig_format: 'reel', first_comment: '#tags' });
    expect(cleanOptions({ ig_format: 'feed' })).toBeNull();
    expect(() => cleanOptions({ ig_format: 'tv' })).toThrow(/feed, reel or story/);
    expect(() => cleanOptions({ media: Array(11).fill('media:1') })).toThrow(/at most 10/);
  });
});

describe('Instagram', () => {
  test('carousel: one container per item, then the carousel, then publish and the first comment', async () => {
    axios.post.mockImplementation(async (url, body) => {
      if (url === `${GRAPH}/IG/media` && body.media_type === 'CAROUSEL') return { data: { id: 'PARENT' } };
      if (url === `${GRAPH}/IG/media`) return { data: { id: `C_${body.image_url}` } };
      if (url === `${GRAPH}/IG/media_publish`) return { data: { id: 'M1' } };
      if (url === `${GRAPH}/M1/comments`) return { data: { id: 'cm' } };
      throw new Error('unexpected ' + url);
    });
    const r = await social.postToInstagram('pt', 'IG', 'Caption', null, {
      options: { media: [link('https://x.test/1.jpg'), link('https://x.test/2.jpg')], first_comment: '#diwali #sale' },
    });
    const calls = axios.post.mock.calls;
    expect(calls[0][1]).toMatchObject({ image_url: 'https://x.test/1.jpg', is_carousel_item: true });
    expect(calls[2][1]).toMatchObject({ media_type: 'CAROUSEL', children: 'C_https://x.test/1.jpg,C_https://x.test/2.jpg', caption: 'Caption' });
    expect(calls.find(c => c[0].endsWith('/M1/comments'))[1].message).toBe('#diwali #sale');
    expect(r).toMatchObject({ success: true, id: 'M1' });
    expect(r.warning).toBeUndefined();
  });

  test('a Reel from the library is uploaded directly (no public link needed)', async () => {
    axios.post.mockImplementation(async (url, body) => {
      if (url === `${GRAPH}/IG/media`) return { data: { id: 'R1', uri: 'https://rupload.facebook.com/ig-api-upload/v26.0/R1' } };
      if (url.startsWith('https://rupload.facebook.com/')) return { data: { success: true } };
      if (url === `${GRAPH}/IG/media_publish`) return { data: { id: 'M2' } };
      throw new Error('unexpected ' + url);
    });
    await social.postToInstagram('pt', 'IG', 'My reel', video(), { options: { ig_format: 'reel' } });
    const [, create] = axios.post.mock.calls[0];
    expect(create).toMatchObject({ media_type: 'REELS', upload_type: 'resumable', share_to_feed: true, caption: 'My reel' });
    const upload = axios.post.mock.calls[1];
    expect(upload[1]).toBe(MP4);
    expect(upload[2].headers).toMatchObject({ Authorization: 'OAuth pt', offset: '0', file_size: String(MP4.length) });
  });

  test('a Reel needs a video', async () => {
    await expect(social.postToInstagram('pt', 'IG', 'x', link('https://x.test/a.jpg'), { options: { ig_format: 'reel' } })).rejects.toThrow(/Reels need a video/);
  });

  test('a Story has no caption and no comment', async () => {
    axios.post.mockImplementation(async (url) => (url.endsWith('/media_publish') ? { data: { id: 'S1' } } : { data: { id: 'C1' } }));
    await social.postToInstagram('pt', 'IG', 'ignored', link('https://x.test/a.jpg'), { options: { ig_format: 'story', first_comment: 'hi' } });
    expect(axios.post.mock.calls[0][1]).toMatchObject({ media_type: 'STORIES', image_url: 'https://x.test/a.jpg' });
    expect(axios.post.mock.calls[0][1].caption).toBeUndefined();
    expect(axios.post.mock.calls.some(c => c[0].endsWith('/comments'))).toBe(false);
  });

  test('a first comment that fails does not fail the post', async () => {
    axios.post.mockImplementation(async (url) => {
      if (url.endsWith('/comments')) throw Object.assign(new Error('perm'), { response: { status: 403 } });
      return url.endsWith('/media_publish') ? { data: { id: 'M3' } } : { data: { id: 'C3' } };
    });
    const r = await social.postToInstagram('pt', 'IG', 'x', link('https://x.test/a.jpg'), { options: { first_comment: 'hi' } });
    expect(r.success).toBe(true);
    expect(r.warning).toMatch(/first comment wasn’t added\. Instagram refused the comment \(no permission\)/);
  });
});

describe('several photos on other platforms', () => {
  test('Facebook: photos uploaded hidden, then one post with all of them, then the first comment', async () => {
    let n = 0;
    axios.post.mockImplementation(async (url) => {
      if (url === `${GRAPH}/P/photos`) return { data: { id: `ph${++n}` } };
      if (url === `${GRAPH}/P/feed`) return { data: { id: 'P_9' } };
      if (url === `${GRAPH}/P_9/comments`) return { data: {} };
      throw new Error('unexpected ' + url);
    });
    await social.postToFacebook('pt', 'P', 'Hi', null, { options: { media: [photo(), photo(), photo()], first_comment: 'Order now' } });
    const feed = axios.post.mock.calls.find(c => c[0] === `${GRAPH}/P/feed`)[1];
    expect(feed.attached_media).toEqual([{ media_fbid: 'ph1' }, { media_fbid: 'ph2' }, { media_fbid: 'ph3' }]);
    expect(axios.post.mock.calls.find(c => c[0].endsWith('/comments'))[1].message).toBe('Order now');
  });

  test('LinkedIn: several photos become a multi-image post', async () => {
    let n = 0;
    axios.post.mockImplementation(async (url) => {
      if (url.includes('initializeUpload')) return { data: { value: { uploadUrl: `https://up.test/${++n}`, image: `urn:li:image:${n}` } } };
      return { headers: { 'x-restli-id': 'urn:li:share:5' }, data: {} };
    });
    axios.put.mockResolvedValue({});
    await social.postToLinkedIn('t', 'Hi', null, 'abc', { options: { media: [photo(), photo()] } });
    const post = axios.post.mock.calls.find(c => c[0].endsWith('/rest/posts'))[1];
    expect(post.content).toEqual({ multiImage: { images: [{ id: 'urn:li:image:1', altText: '' }, { id: 'urn:li:image:2', altText: '' }] } });
  });

  test('X: up to 4 photos', async () => {
    let n = 0;
    axios.post.mockImplementation(async (url) => (url.endsWith('/media/upload') ? { data: { data: { id: `m${++n}` } } } : { data: { data: { id: 'T' } } }));
    const r = await social.postToTwitter('t', 's', 'Hi', null, { options: { media: [photo(), photo(), photo(), photo(), photo()] } });
    expect(axios.post.mock.calls.at(-1)[1].media.media_ids).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(r.warning).toMatch(/4 photos/);
  });

  test('Pinterest: a carousel Pin', async () => {
    axios.post.mockResolvedValue({ data: { id: 'pin' } });
    await social.postToPinterest('t', 'b', 'Hi', null, { options: { media: [photo(), photo()] } });
    expect(axios.post.mock.calls[0][1].media_source.source_type).toBe('multiple_image_base64');
    expect(axios.post.mock.calls[0][1].media_source.items).toHaveLength(2);
  });

  test('options reach the platform through postToPlatform', async () => {
    axios.post.mockResolvedValue({ data: { id: 'pin' } });
    await social.postToPlatform('pinterest', { access_token: 't', board_id: 'b' }, 'Hi', null, { media: ['https://x.test/1.jpg', 'https://x.test/2.jpg'] });
    expect(axios.post.mock.calls[0][1].media_source).toEqual({ source_type: 'multiple_image_urls', items: [{ url: 'https://x.test/1.jpg' }, { url: 'https://x.test/2.jpg' }] });
  });
});
