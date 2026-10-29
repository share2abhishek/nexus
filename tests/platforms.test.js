// Posting adapters against the platforms' current APIs (network calls mocked)
jest.mock('axios');
// Test addresses (img.test…) resolve to a public address
jest.mock('dns', () => ({ ...jest.requireActual('dns'), promises: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] } }));
const axios = require('axios');
const social = require('../services/social');
const { GRAPH, LINKEDIN_VERSION, META_RELEASED } = require('../services/platforms/apiVersions');
const { PUBLISHABLE, checkPlatforms } = require('../services/platforms/available');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
const file = (kind = 'image', mime = 'image/png') => ({ url: null, file: async () => ({ buffer: PNG, mime, ext: mime.split('/')[1], kind }) });

afterEach(() => jest.resetAllMocks());

describe('LinkedIn (Posts API)', () => {
  test('text post goes to /rest/posts with a version header; id comes from the response header', async () => {
    axios.post.mockResolvedValue({ status: 201, headers: { 'x-restli-id': 'urn:li:share:42' }, data: {} });
    const r = await social.postToLinkedIn('tok', 'Sale (today) #Diwali', null, 'abc');
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    expect(opts.headers['Linkedin-Version']).toBe(LINKEDIN_VERSION);
    expect(opts.headers['X-Restli-Protocol-Version']).toBe('2.0.0');
    expect(body.author).toBe('urn:li:person:abc');
    expect(body.commentary).toBe('Sale \\(today\\) #Diwali');
    expect(body.content).toBeUndefined();
    expect(r).toEqual({ success: true, id: 'urn:li:share:42', platform: 'linkedin' });
  });

  test('image post uploads the picture first and attaches its image id', async () => {
    // The website calls it octet-stream; the file itself is a PNG
    axios.get.mockResolvedValue({ headers: { 'content-type': 'application/octet-stream' }, data: PNG });
    axios.post
      .mockResolvedValueOnce({ data: { value: { uploadUrl: 'https://upload.test/x', image: 'urn:li:image:9' } } })
      .mockResolvedValueOnce({ headers: { 'x-restli-id': 'urn:li:share:7' }, data: {} });
    axios.put.mockResolvedValue({ status: 201 });

    await social.postToLinkedIn('tok', 'Hi', 'https://img.test/a.png', 'abc');
    expect(axios.post.mock.calls[0][0]).toContain('/rest/images?action=initializeUpload');
    expect(axios.post.mock.calls[0][1]).toEqual({ initializeUploadRequest: { owner: 'urn:li:person:abc' } });
    expect(axios.put.mock.calls[0][0]).toBe('https://upload.test/x');
    expect(axios.put.mock.calls[0][2].headers['Content-Type']).toBe('image/png');
    expect(axios.post.mock.calls[1][1].content).toEqual({ media: { id: 'urn:li:image:9' } });
  });

  test('a link that is not a picture gives a clear message and posts nothing', async () => {
    axios.get.mockResolvedValue({ headers: { 'content-type': 'image/jpeg' }, data: Buffer.from('<html>') });
    await expect(social.postToLinkedIn('tok', 'Hi', 'https://site.test/page', 'abc')).rejects.toThrow(/JPG, PNG, GIF/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('only web links are fetched', async () => {
    await expect(social.postToLinkedIn('tok', 'Hi', 'file:///C:/secret.png', 'abc')).rejects.toThrow(/http/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('an image that cannot be downloaded is not reported as a LinkedIn error', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404 } }));
    await expect(social.postToPlatform('linkedin', { access_token: 't', external_id: 'a' }, 'Hi', 'https://x.test/missing.jpg'))
      .rejects.toThrow(/could not be downloaded/);
  });

  test('escapes LinkedIn formatting characters but keeps whole hashtags', () => {
    expect(social.linkedInText('@a [b] {c} <d> *e* _f_ ~g~ | \\ # #ok #दिवाली #small_business'))
      .toBe('\\@a \\[b\\] \\{c\\} \\<d\\> \\*e\\* \\_f\\_ \\~g\\~ \\| \\\\ \\# #ok #दिवाली #small_business');
  });
});

describe('Facebook and Instagram use the current Graph API version', () => {
  test('Page post', async () => {
    axios.post.mockResolvedValue({ data: { id: 'p1' } });
    await social.postToFacebook('pt', '123', 'Hello');
    expect(axios.post.mock.calls[0][0]).toBe(`${GRAPH}/123/feed`);
    expect(GRAPH).not.toMatch(/v18/);
  });

  test('Instagram post', async () => {
    axios.post.mockResolvedValueOnce({ data: { id: 'c1' } }).mockResolvedValueOnce({ data: { id: 'm1' } });
    await social.postToInstagram('pt', 'ig1', 'Hello', 'https://img.test/a.jpg');
    expect(axios.post.mock.calls.map(c => c[0])).toEqual([`${GRAPH}/ig1/media`, `${GRAPH}/ig1/media_publish`]);
  });
});

describe('platforms that are not ready', () => {
  test('YouTube and TikTok are not offered for posting', () => {
    expect(PUBLISHABLE).not.toContain('youtube');
    expect(PUBLISHABLE).not.toContain('tiktok');
  });

  test.each(['youtube', 'tiktok'])('%s posts fail with a plain explanation and no network call', async (p) => {
    await expect(social.postToPlatform(p, { access_token: 't' }, 'Hi', null)).rejects.toThrow(/not (possible|available)/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('routes refuse YouTube/TikTok with a plain message', () => {
    expect(checkPlatforms(['linkedin', 'facebook'])).toBeNull();
    expect(checkPlatforms(['linkedin', 'youtube'])).toMatch(/YouTube is not available yet/);
    expect(checkPlatforms(undefined)).toBeNull();
  });
});

describe('other platform rules', () => {
  test('X uploads the picture, then posts with it (signed requests)', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { data: { id: 'M1' } } })
      .mockResolvedValueOnce({ data: { data: { id: 'T1' } } });
    const r = await social.postToTwitter('tok', 'sec', 'Hi', file());
    expect(axios.post.mock.calls[0][0]).toBe('https://api.x.com/2/media/upload');
    expect(axios.post.mock.calls[0][2].headers.Authorization).toMatch(/^OAuth /);
    expect(axios.post.mock.calls[1][1]).toEqual({ text: 'Hi', media: { media_ids: ['M1'] } });
    expect(r.id).toBe('T1');
  });

  test('X refuses videos with a plain message', async () => {
    await expect(social.postToTwitter('tok', 'sec', 'Hi', file('video', 'video/mp4'))).rejects.toThrow(/videos can.t be posted to X yet/);
  });

  test('Pinterest without a picture explains, and sends no empty link', async () => {
    await expect(social.postToPinterest('t', 'b1', 'Hi')).rejects.toThrow(/needs a picture/);
    axios.post.mockResolvedValue({ data: { id: 'pin1' } });
    await social.postToPinterest('t', 'b1', 'Hi', 'https://img.test/a.jpg');
    expect(axios.post.mock.calls[0][1]).not.toHaveProperty('link');
  });

  test('a retired API version (426) asks for an update', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('426'), { response: { status: 426, data: {} } }));
    await expect(social.postToPlatform('linkedin', { access_token: 't', external_id: 'a' }, 'Hi', null)).rejects.toThrow(/Update Social-Nexus/);
  });
});

// Fails before a release that would ship an API version close to retirement
describe('API versions are not getting old', () => {
  const monthsSince = (d) => (Date.now() - new Date(d).getTime()) / (30.4 * 24 * 3600 * 1000);
  test('Meta Graph version is under 18 months old (Meta retires them after about 2 years)', () => {
    expect(monthsSince(META_RELEASED)).toBeLessThan(18);
  });
  test('LinkedIn version is under 10 months old (LinkedIn retires them after about 1 year)', () => {
    expect(monthsSince(`${LINKEDIN_VERSION.slice(0, 4)}-${LINKEDIN_VERSION.slice(4)}-01`)).toBeLessThan(10);
  });
});

describe('library files', () => {
  test('Facebook sends a library photo as a file', async () => {
    axios.post.mockResolvedValue({ data: { id: 'ph1', post_id: 'p_1' } });
    const r = await social.postToFacebook('pt', '123', 'Hi', file());
    expect(axios.post.mock.calls[0][0]).toBe(`${GRAPH}/123/photos`);
    expect(axios.post.mock.calls[0][1].constructor.name).toBe('FormData');
    expect(r.id).toBe('p_1');
  });

  test('Facebook sends a library video to /videos', async () => {
    axios.post.mockResolvedValue({ data: { id: 'v1' } });
    await social.postToFacebook('pt', '123', 'Hi', file('video', 'video/mp4'));
    expect(axios.post.mock.calls[0][0]).toBe(`${GRAPH}/123/videos`);
  });

  test('Instagram borrows the Facebook Page for a library photo, then removes it', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { id: 'PAGE' } })
      .mockResolvedValueOnce({ data: { images: [{ source: 'https://cdn.test/p.jpg' }] } });
    axios.post
      .mockResolvedValueOnce({ data: { id: 'hidden1' } })
      .mockResolvedValueOnce({ data: { id: 'c1' } })
      .mockResolvedValueOnce({ data: { id: 'm1' } });
    axios.delete.mockResolvedValue({});
    await social.postToInstagram('pt', 'ig1', 'Hi', file());
    expect(axios.post.mock.calls[0][0]).toBe(`${GRAPH}/PAGE/photos`);
    expect(axios.post.mock.calls[1][1].image_url).toBe('https://cdn.test/p.jpg');
    expect(axios.delete.mock.calls[0][0]).toBe(`${GRAPH}/hidden1`);
  });

  test('the hidden photo is removed even when Instagram refuses the post', async () => {
    axios.get.mockResolvedValueOnce({ data: { images: [{ source: 'https://cdn.test/p.jpg' }] } });
    axios.post.mockResolvedValueOnce({ data: { id: 'hidden2' } }).mockRejectedValueOnce(new Error('IG down'));
    axios.delete.mockResolvedValue({});
    await expect(social.postToInstagram('pt', 'ig1', 'Hi', file(), { pageId: 'PAGE' })).rejects.toThrow('IG down');
    expect(axios.delete.mock.calls[0][0]).toBe(`${GRAPH}/hidden2`);
  });

  test('Pinterest sends a library photo inside the request', async () => {
    axios.post.mockResolvedValue({ data: { id: 'pin' } });
    await social.postToPinterest('t', 'b1', 'Hi', file());
    expect(axios.post.mock.calls[0][1].media_source).toEqual({ source_type: 'image_base64', content_type: 'image/png', data: PNG.toString('base64') });
  });

  test('LinkedIn uploads a library photo without downloading anything', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { value: { uploadUrl: 'https://upload.test/y', image: 'urn:li:image:1' } } })
      .mockResolvedValueOnce({ headers: { 'x-restli-id': 'urn:li:share:9' }, data: {} });
    axios.put.mockResolvedValue({});
    await social.postToLinkedIn('tok', 'Hi', file(), 'abc');
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.put.mock.calls[0][1]).toBe(PNG);
  });
});

describe('picture links', () => {
  test('links to this PC or the local network are refused before any download', async () => {
    const { assertPublicUrl } = require('../services/mediaStore');
    await expect(assertPublicUrl('http://127.0.0.1:3000/api/secret')).rejects.toThrow(/public websites/);
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/public websites/);
    await expect(assertPublicUrl('https://img.test/a.png')).resolves.toBeUndefined();
  });

  test('a redirect to a private address is refused', async () => {
    axios.get.mockResolvedValueOnce({ status: 302, headers: { location: 'http://192.168.1.1/router.png' }, data: Buffer.alloc(0) });
    await expect(require('../services/mediaStore').download('https://img.test/a.png')).rejects.toThrow(/public websites/);
  });
});
