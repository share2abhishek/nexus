// Step-by-step connection guides shown on each platform card (Settings → Social
// Platforms → "Setup guide"). Plain language; {callback} is replaced with the
// exact callback URL for this computer. Developer portals change their layout
// from time to time, so the steps name what to look for rather than pixel paths.
const GUIDES = {
  linkedin: {
    availability: 'ready',
    time: 'About 10 minutes',
    needs: ['A LinkedIn account', 'A LinkedIn Page for your business (LinkedIn asks for one when you create the app)'],
    steps: [
      { text: 'Open the LinkedIn developer portal and click "Create app".', link: 'https://www.linkedin.com/developers/apps/new' },
      { text: 'Fill in the app name (e.g. "My Social-Nexus"), choose your LinkedIn Page, upload a logo and accept the terms.' },
      { text: 'Open the "Products" tab and add "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn". Both are approved straight away.' },
      { text: 'Open the "Auth" tab. Under "Authorized redirect URLs for your app" add this exact address:', copy: '{callback}' },
      { text: 'Still on "Auth", copy the Client ID and the Primary Client Secret into the boxes below, then click Save.' },
      { text: 'Click Connect and sign in to LinkedIn when asked.' },
    ],
    notes: [
      'Posts appear on your personal LinkedIn profile.',
      'Posting as a company Page needs LinkedIn\'s Community Management API, which LinkedIn must approve first.',
    ],
  },
  facebook: {
    availability: 'ready',
    time: 'About 15 minutes',
    needs: [
      'A Facebook Page that you manage',
      'For Instagram: an Instagram Business or Creator account linked to that Page (Instagram app → Settings → Account type)',
    ],
    steps: [
      { text: 'Open Meta for Developers and click "Create app".', link: 'https://developers.facebook.com/apps' },
      { text: 'Choose the use case for managing a Page (for example "Manage everything on your Page"), and a Business app type if asked. Give it a name.' },
      { text: 'Add the "Facebook Login for Business" (or "Facebook Login") product. In its Settings, add this to "Valid OAuth Redirect URIs":', copy: '{callback}' },
      { text: 'Go to App settings → Basic and copy the App ID and App Secret into the boxes below, then click Save.' },
      { text: 'Click Connect, sign in, and allow access to your Page (and Instagram account). If you manage several Pages, choose one with "Select Facebook Page".' },
    ],
    notes: [
      'While your Meta app is in Development mode, it works for you and anyone you add as a tester or admin on the app. That\'s enough for your own Pages.',
      'Letting people outside your app use it needs Meta App Review for pages_manage_posts and instagram_content_publish.',
      'Instagram posts need an image at a public web address (https://…).',
    ],
  },
  instagram: {
    availability: 'ready',
    time: 'Included with Facebook',
    needs: ['An Instagram Business or Creator account linked to your Facebook Page'],
    steps: [
      { text: 'Instagram connects through your Facebook app. Follow the Facebook guide; your Instagram account is detected when you choose the Page.' },
    ],
    notes: ['Every Instagram post needs an image at a public web address (https://…).'],
  },
  pinterest: {
    availability: 'ready',
    time: 'About 10 minutes',
    needs: ['A Pinterest Business account'],
    steps: [
      { text: 'Open Pinterest Developers → My apps and connect a new app.', link: 'https://developers.pinterest.com/apps/' },
      { text: 'In the app settings, add this redirect URI:', copy: '{callback}' },
      { text: 'Copy the App ID and App secret key into the boxes below, then click Save.' },
      { text: 'Click Connect, then choose the board to pin to with "Select Board".' },
    ],
    notes: [
      'New Pinterest apps start with Trial access. Pins may only be visible to you until Pinterest grants Standard access.',
      'Every pin needs an image.',
    ],
  },
  twitter: {
    availability: 'limited',
    time: 'About 15 minutes',
    needs: ['An X developer account', 'An X API plan that allows posting (check current plans on the developer portal)'],
    steps: [
      { text: 'Open the X Developer Portal and create a Project and App.', link: 'https://developer.x.com/en/portal/dashboard' },
      { text: 'Open the app\'s "User authentication settings". Choose App permissions "Read and write" and type "Web App, Automated App or Bot".' },
      { text: 'Set "Callback URI / Redirect URL" to this exact address (X needs 127.0.0.1, not "localhost"):', copy: '{callback}' },
      { text: 'Enter any website address you own as the Website URL, then save.' },
      { text: 'Open "Keys and tokens" and copy the API Key and API Key Secret into the boxes below. The Access Token fields are optional. Click Save.' },
      { text: 'Click Connect and authorise the app.' },
    ],
    notes: [
      'X changes its API plans and limits often. If posting fails with a 403 error, your plan may not include posting.',
      'Images are not attached to X posts yet; the text is posted.',
    ],
  },
  youtube: {
    availability: 'unavailable',
    time: '—',
    needs: ['A Google account and a YouTube channel'],
    steps: [
      { text: 'YouTube\'s public API can upload videos, but it can\'t create Community posts (text or image). Social-Nexus doesn\'t upload videos yet, so YouTube can be connected but not posted to.' },
    ],
    notes: ['Publish to YouTube from YouTube Studio for now.'],
  },
  google_business: {
    availability: 'limited',
    time: 'About 20 minutes, plus Google\'s approval',
    needs: ['A verified Google Business Profile'],
    steps: [
      { text: 'Open Google Cloud Console and create a project.', link: 'https://console.cloud.google.com/projectcreate' },
      { text: 'Request access to the Google Business Profile APIs. Google reviews these requests; it can take a few days.', link: 'https://developers.google.com/my-business/content/prereqs' },
      { text: 'In APIs & Services → OAuth consent screen, choose "External" and add your own Google account as a Test user.' },
      { text: 'In APIs & Services → Credentials, create an "OAuth client ID" of type "Web application". Add this Authorised redirect URI:', copy: '{callback}' },
      { text: 'Copy the Client ID and Client secret into the boxes below, then click Save and Connect.' },
    ],
    notes: ['Until Google approves API access, posting returns a permission error.'],
  },
  tiktok: {
    availability: 'unavailable',
    time: '—',
    needs: ['A TikTok developer account and an approved app'],
    steps: [
      { text: 'TikTok only allows web apps with a public https redirect address, and posts from unaudited apps must be private. A desktop app on your own PC can\'t meet these rules yet.' },
    ],
    notes: ['Post to TikTok from the TikTok app for now.'],
  },
};

module.exports = { GUIDES };
