// The client's side of an approval link. The post (or set of posts) is encrypted;
// the key is in the address after "#" (never sent to the server), and the answer
// is encrypted with it too.
(function () {
  const $ = (id) => document.getElementById(id);
  const id = location.pathname.split('/').pop();
  const keyB64 = location.hash.slice(1);
  const NAMES = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', pinterest: 'Pinterest', twitter: 'X (Twitter)', google_business: 'Google Business' };
  let isSet = false;
  let count = 1;

  const b64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

  async function key() {
    return crypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function decrypt(data) {
    const raw = unb64(data);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await key(), raw.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function encrypt(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + c.length); out.set(iv); out.set(c, 12);
    return b64(out);
  }
  function fail(msg) { $('intro').textContent = msg; }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function postCard(post, i) {
    const box = el('div', 'post');
    if (isSet) box.appendChild(el('div', 'meta', `Post ${i + 1} of ${count}`));
    box.appendChild(el('div', 'post-text', post.body || ''));
    if (post.images?.length) {
      const pics = el('div', 'pics');
      for (const src of post.images) {
        if (!/^(data:(image|video)\/|https:\/\/)/.test(src)) continue;
        const isVideo = src.startsWith('data:video') || /\.(mp4|mov)(\?|$)/i.test(src);
        const m = document.createElement(isVideo ? 'video' : 'img');
        m.src = src; if (isVideo) m.controls = true; m.alt = '';
        pics.appendChild(m);
      }
      box.appendChild(pics);
    }
    if (post.first_comment) box.appendChild(el('div', 'meta', `First comment: ${post.first_comment}`));
    box.appendChild(el('div', 'meta', [
      (post.platforms || []).map(p => NAMES[p] || p).join(', '),
      post.when ? `planned for ${new Date(post.when * 1000).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : '',
    ].filter(Boolean).join(' · ')));

    if (isSet) {
      // A choice per post
      const choose = el('div', 'actions');
      for (const [value, label] of [['approve', '✓ Approve'], ['changes', '✎ Changes']]) {
        const lab = el('label', value === 'approve' ? 'ok' : 'change');
        lab.style.cssText = 'flex:1;min-width:120px;padding:10px;border-radius:10px;text-align:center;cursor:pointer;opacity:.55';
        const r = document.createElement('input');
        r.type = 'radio'; r.name = `d${i}`; r.value = value; r.style.marginRight = '6px';
        r.onchange = () => {
          choose.querySelectorAll('label').forEach(l => { l.style.opacity = l.contains(r) ? '1' : '.55'; });
          comment.classList.toggle('hidden', value !== 'changes');
          if (value === 'changes') comment.focus();
        };
        lab.appendChild(r); lab.appendChild(document.createTextNode(label));
        choose.appendChild(lab);
      }
      const comment = el('textarea', 'hidden');
      comment.id = `c${i}`; comment.rows = 2; comment.maxLength = 1000; comment.placeholder = 'What should change?';
      comment.style.marginTop = '8px';
      box.appendChild(choose);
      box.appendChild(comment);
    }
    return box;
  }

  async function load() {
    if (!keyB64) return fail('This link is incomplete. Ask for the full link again.');
    let r;
    try { r = await fetch(`/v1/approvals/${encodeURIComponent(id)}`); } catch { return fail('Can’t connect. Check the internet and reload.'); }
    if (!r.ok) return fail((await r.json().catch(() => ({}))).error || 'This link has expired.');
    const data = await r.json();
    let payload;
    try { payload = await decrypt(data.ciphertext); } catch { return fail('This link is incomplete or damaged. Ask for the link again.'); }

    const posts = Array.isArray(payload.posts) ? payload.posts : [payload];
    isSet = Array.isArray(payload.posts);
    count = posts.length;
    $('title').textContent = payload.business
      ? `${payload.business}: please review ${isSet ? `these ${count} posts` : 'this post'}`
      : `Please review ${isSet ? `these ${count} posts` : 'this post'}`;
    $('intro').textContent = `${payload.from ? `${payload.from} would like` : 'They would like'} your OK before ${isSet ? 'they go' : 'it goes'} out.`;
    const box = $('post');
    box.className = '';
    posts.forEach((p, i) => box.appendChild(postCard(p, i)));
    box.classList.remove('hidden');

    if (data.responded) {
      $('done').textContent = 'Thank you, this has already been answered.';
      $('done').classList.remove('hidden');
      return;
    }
    $('answer').classList.remove('hidden');
    if (isSet) {
      // One Send for the whole set
      $('approve').textContent = '✓ Approve all';
      $('ask').textContent = 'Send my choices';
    }
  }

  async function send(answer) {
    document.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const response = await encrypt({ ...answer, name: $('name').value.trim().slice(0, 80), at: Math.floor(Date.now() / 1000) });
      const r = await fetch(`/v1/approvals/${encodeURIComponent(id)}/response`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Not sent');
      $('answer').classList.add('hidden');
      const approved = answer.decision === 'approve' || (answer.decisions || []).every(d => d.decision === 'approve');
      $('done').textContent = approved ? '✓ Approved. Thank you!' : 'Thank you, your answer was sent.';
      $('done').classList.remove('hidden');
      window.scrollTo(0, document.body.scrollHeight);
    } catch (err) {
      alert(`Your answer could not be sent: ${err.message}. Please try again.`);
      document.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }

  function setChoices(all) {
    const decisions = [];
    for (let i = 0; i < count; i++) {
      const picked = all || document.querySelector(`input[name="d${i}"]:checked`)?.value;
      if (!picked) { alert(`Please choose Approve or Changes for post ${i + 1}.`); return null; }
      const comment = all ? '' : document.getElementById(`c${i}`).value.trim();
      if (picked === 'changes' && !comment) { alert(`Please say what should change in post ${i + 1}.`); document.getElementById(`c${i}`).focus(); return null; }
      decisions.push({ i, decision: picked, comment });
    }
    return decisions;
  }

  $('approve').onclick = () => {
    if (!isSet) return send({ decision: 'approve' });
    if (confirm(`Approve all ${count} posts?`)) send({ decisions: setChoices('approve') });
  };
  $('ask').onclick = () => {
    if (!isSet) { $('change-box').classList.remove('hidden'); $('comment').focus(); return; }
    const decisions = setChoices(null);
    if (decisions) send({ decisions });
  };
  $('send-change').onclick = () => {
    const comment = $('comment').value.trim();
    if (!comment) { $('comment').focus(); return; }
    send({ decision: 'changes', comment });
  };
  load();
})();
