// OAuth 1.0a signing matches X's documented example ("Creating a signature")
const { authHeader } = require('../services/platforms/oauth1');

test('signature matches the published example', () => {
  const url = 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=' +
    encodeURIComponent('Hello Ladies + Gentlemen, a signed OAuth request!');
  const h = authHeader('POST', url, {
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
    consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  }, { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958 });
  expect(h).toContain(`oauth_signature="${encodeURIComponent('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')}"`);
});
