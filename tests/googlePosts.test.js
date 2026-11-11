// Google Business post types: update, offer and event, with a button.
// Google's API is a stand-in.
jest.mock('axios', () => {
  const post = jest.fn(async () => ({ data: { name: 'localPosts/1' } }));
  const get = jest.fn();
  return { post, get, create: () => ({ post, get }), default: { post, get } };
});
const axios = require('axios');
const { cleanOptions } = require('../services/postOptions');
const { postToGoogleBusiness, localPostBody } = require('../services/platforms/googleBusiness');

describe('Google post options are checked before saving', () => {
  test('an offer needs a title and dates; a coupon, link and terms are kept', () => {
    expect(cleanOptions({ gbp: { type: 'offer', title: ' Diwali 20% off ', start_date: '2026-11-12', end_date: '2026-11-15', coupon: 'DIWALI20', redeem_url: 'https://shop.example/diwali', terms: 'One per person', button: 'BOOK' } }))
      .toEqual({ gbp: { type: 'offer', title: 'Diwali 20% off', start_date: '2026-11-12', end_date: '2026-11-15', coupon: 'DIWALI20', redeem_url: 'https://shop.example/diwali', terms: 'One per person' } });
    expect(() => cleanOptions({ gbp: { type: 'offer', start_date: '2026-11-12', end_date: '2026-11-15' } })).toThrow(/title/);
    expect(() => cleanOptions({ gbp: { type: 'offer', title: 'x', start_date: '2026-11-15', end_date: '2026-11-12' } })).toThrow(/ends before it starts/);
    expect(() => cleanOptions({ gbp: { type: 'offer', title: 'x', start_date: '2026-11-12', end_date: '2026-11-15', redeem_url: 'javascript:alert(1)' } })).toThrow(/https/);
  });

  test('an event can be all day or have both times', () => {
    expect(cleanOptions({ gbp: { type: 'event', title: 'Open day', start_date: '2026-11-20', end_date: '2026-11-20' } }).gbp).not.toHaveProperty('start_time');
    expect(cleanOptions({ gbp: { type: 'event', title: 'Open day', start_date: '2026-11-20', end_date: '2026-11-20', start_time: '10:00', end_time: '17:30' } }).gbp)
      .toMatchObject({ start_time: '10:00', end_time: '17:30' });
    expect(() => cleanOptions({ gbp: { type: 'event', title: 'x', start_date: '2026-11-20', end_date: '2026-11-20', start_time: '10:00' } })).toThrow(/both a start and an end time/);
    expect(() => cleanOptions({ gbp: { type: 'event', title: 'x', start_date: '2026-11-20', end_date: '2026-11-20', start_time: '17:00', end_time: '10:00' } })).toThrow(/ends before it starts/);
  });

  test('a button needs a web link, except “Call now”; a plain update without a button stores nothing', () => {
    expect(cleanOptions({ gbp: { type: 'update', button: 'ORDER', button_url: 'https://shop.example' } }).gbp).toEqual({ type: 'update', button: 'ORDER', button_url: 'https://shop.example' });
    expect(cleanOptions({ gbp: { type: 'update', button: 'CALL', button_url: 'ignored' } }).gbp).toEqual({ type: 'update', button: 'CALL' });
    expect(() => cleanOptions({ gbp: { type: 'update', button: 'ORDER' } })).toThrow(/https/);
    expect(() => cleanOptions({ gbp: { type: 'update', button: 'DANCE', button_url: 'https://x.example' } })).toThrow(/Pick a button/);
    expect(cleanOptions({ gbp: { type: 'update', button: 'NONE' } })).toBeNull();
  });
});

describe('what is sent to Google', () => {
  beforeEach(() => axios.post.mockClear());

  test('an offer becomes an OFFER post with its dates, coupon and link', async () => {
    await postToGoogleBusiness('tok', 'accounts/2', 'Sweets for Diwali', null, {
      location: 'locations/10',
      options: { gbp: { type: 'offer', title: 'Diwali 20% off', start_date: '2026-11-12', end_date: '2026-11-15', coupon: 'DIWALI20', redeem_url: 'https://shop.example/d', terms: 'One per person' } },
    });
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://mybusiness.googleapis.com/v4/accounts/2/locations/10/localPosts');
    expect(body).toMatchObject({
      topicType: 'OFFER', summary: 'Sweets for Diwali',
      event: { title: 'Diwali 20% off', schedule: { startDate: { year: 2026, month: 11, day: 12 }, endDate: { year: 2026, month: 11, day: 15 } } },
      offer: { couponCode: 'DIWALI20', redeemOnlineUrl: 'https://shop.example/d', termsConditions: 'One per person' },
    });
    expect(body.callToAction).toBeUndefined();
  });

  test('an event with times and a Sign up button', () => {
    const body = localPostBody('Come by', { type: 'event', title: 'Open day', start_date: '2026-11-20', end_date: '2026-11-20', start_time: '10:00', end_time: '17:30', button: 'SIGN_UP', button_url: 'https://x.example/s' });
    expect(body).toMatchObject({
      topicType: 'EVENT',
      event: { schedule: { startTime: { hours: 10, minutes: 0 }, endTime: { hours: 17, minutes: 30 } } },
      callToAction: { actionType: 'SIGN_UP', url: 'https://x.example/s' },
    });
  });

  test('an update stays a STANDARD post; “Call now” has no link', () => {
    expect(localPostBody('Hello', null)).toEqual({ languageCode: 'en', summary: 'Hello', topicType: 'STANDARD' });
    expect(localPostBody('Hello', { type: 'update', button: 'CALL' }).callToAction).toEqual({ actionType: 'CALL' });
  });
});
