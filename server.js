const express = require('express'), http = require('http'), fs = require('fs'), path = require('path');
const { Server } = require('socket.io');
const app = express(), srv = http.createServer(app);
const io = new Server(srv, { maxHttpBufferSize: 5e6 });
const PASS = process.env.TEACHER_PASSWORD || 'ucitel';
const QFILE = path.join(__dirname, 'questions.md');
app.use(express.static(path.join(__dirname, 'public')));
app.get('/ucitel', (q, r) => r.sendFile(path.join(__dirname, 'public', 'ucitel.html')));

const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = s => s.replace(/\\([\\`*_{}\[\]()#+\-.!|<>~])/g, '$1').replace(/\*\*/g, '').trim();

// Načte otázky z Markdownu (export dokumentu s kvízem).
function parse(md) {
  const out = []; let T = null, Q = null, m;
  for (const raw of md.split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    if ((m = l.match(/^#{1,6}\s+(\d+)\s+(.+)$/))) { T = { id: m[1], title: clean(m[2]), questions: [] }; out.push(T); Q = null; continue; }
    if (T && (m = l.match(/^\*\*\s*(\d+)\\?\.(\d+)\s+(.+?)\s*\*\*$/))) { Q = { id: m[1] + '.' + m[2], text: clean(m[3]), answers: [], correct: -1 }; T.questions.push(Q); continue; }
    if (Q && (m = l.match(/^[-*•]\s*([A-D])\)\s*(.+)$/))) {
      const ok = m[2].includes('✔');
      if (ok) Q.correct = Q.answers.length;
      Q.answers.push(clean(m[2].replace(/\uFE0F/g, '').replace(/✔/g, '')));
    }
  }
  out.forEach(t => t.questions = t.questions.filter(q => q.answers.length === 4 && q.correct >= 0));
  return out.filter(t => t.questions.length);
}
let topics = [];
try { topics = parse(fs.readFileSync(QFILE, 'utf8')); } catch (e) {}
console.log('Načteno témat:', topics.length);

let game = null;
const ranking = () => [...game.players.values()]
  .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'cs'))
  .map((p, i) => ({ name: p.name, score: p.score, delta: p.last ? p.last.pts : 0, rank: i + 1, on: p.on }));

function view(s) {
  const t = !!s.data.teacher, tok = s.data.token;
  const v = { role: t ? 'teacher' : (tok ? 'player' : 'guest'), phase: 'none', now: Date.now() };
  if (t) v.topics = topics.map(x => ({ id: x.id, title: x.title, count: x.questions.length }));
  if (!game) return v;
  const g = game, q = g.qs[g.round];
  Object.assign(v, { phase: g.phase, round: g.round + 1, rounds: g.qs.length, time: g.time, n: g.players.size });
  if (g.phase === 'lobby' && t) v.names = [...g.players.values()].map(p => p.name);
  if (q && g.phase !== 'lobby') {
    v.q = { text: q.text, answers: q.answers }; v.endsAt = g.endsAt;
    if (g.phase !== 'question') { v.correct = q.correct; if (t) v.counts = g.counts; }
    if (t) v.answered = g.answers.size;
  }
  if (g.phase === 'board') { v.board = ranking(); v.final = g.round === g.qs.length - 1; }
  if (tok && g.players.has(tok)) {
    const p = g.players.get(tok), a = g.answers.get(tok);
    const r = ranking().find(x => x.name === p.name);
    v.me = { name: p.name, score: p.score, rank: r.rank, idx: a ? a.idx : null, last: p.last };
  }
  return v;
}
const push = () => io.sockets.sockets.forEach(s => s.emit('state', view(s)));

function nextQ() {
  clearTimeout(game.timer);
  game.round++; game.answers = new Map(); game.counts = [0, 0, 0, 0];
  game.players.forEach(p => p.last = null);
  game.phase = 'question'; game.endsAt = Date.now() + game.time * 1000;
  game.startedAt = Date.now();
  game.timer = setTimeout(reveal, game.time * 1000 + 400);
  push();
}
function reveal() {
  if (!game || game.phase !== 'question') return;
  clearTimeout(game.timer);
  const q = game.qs[game.round];
  game.answers.forEach((a, tok) => {
    const p = game.players.get(tok); if (!p) return;
    game.counts[a.idx]++;
    const ok = a.idx === q.correct;
    p.last = { correct: ok, pts: ok ? a.pts : 0 };
    p.score += p.last.pts;
  });
  game.phase = 'reveal'; push();
}

io.on('connection', s => {
  s.emit('state', view(s));
  s.on('login', pw => {
    if (pw !== PASS) return s.emit('err', 'Špatné heslo.');
    s.data.teacher = true; s.emit('loginok'); s.emit('state', view(s));
  });
  s.on('join', ({ token, name } = {}) => {
    name = String(name || '').trim().slice(0, 20);
    if (!game) return s.emit('err', 'Hra zatím nezačala. Zkus to za chvíli.');
    if (!name || !token) return s.emit('err', 'Napiš své jméno.');
    for (const [t, p] of game.players) if (p.name.toLowerCase() === name.toLowerCase() && t !== token)
      return s.emit('err', 'Toto jméno už někdo používá, zvol jiné.');
    const p = game.players.get(token) || { name, score: 0, last: null };
    p.name = name; p.on = true; p.sid = s.id; game.players.set(token, p);
    s.data.token = token; s.emit('joined'); push();
  });
  s.on('answer', idx => {
    const tok = s.data.token;
    if (!game || game.phase !== 'question' || !game.players.has(tok) || game.answers.has(tok)) return;
    const t = (Date.now() - game.startedAt) / 1000;
    if (t > game.time + 0.4 || ![0, 1, 2, 3].includes(idx)) return;
    const pts = Math.round(1000 - 500 * Math.min(1, t / game.time));
    game.answers.set(tok, { idx, pts });
    const online = [...game.players.values()].filter(p => p.on).length;
    if (game.answers.size >= online) reveal(); else push();
  });
  s.on('disconnect', () => {
    if (game && s.data.token && game.players.has(s.data.token)) { game.players.get(s.data.token).on = false; push(); }
  });

  // --- učitel ---
  const T = fn => (...a) => { if (s.data.teacher) fn(...a); };
  s.on('upload', T(md => {
    const t = parse(String(md || ''));
    if (!t.length) return s.emit('err', 'V souboru jsem nenašel žádné otázky ve správném formátu.');
    topics = t; try { fs.writeFileSync(QFILE, md); } catch (e) {}
    push();
  }));
  s.on('create', T(({ ids, rounds, time } = {}) => {
    const pool = shuffle(topics.filter(t => (ids || []).includes(t.id)).flatMap(t => t.questions));
    const n = Math.min(Math.max(1, parseInt(rounds) || 1), pool.length);
    if (!pool.length) return s.emit('err', 'Vyber alespoň jedno téma.');
    clearTimeout(game && game.timer);
    game = { phase: 'lobby', qs: pool.slice(0, n), round: -1, time: Math.min(120, Math.max(5, parseInt(time) || 20)),
      players: new Map(), answers: new Map(), counts: [0, 0, 0, 0], timer: null };
    push();
  }));
  s.on('next', T(() => {
    if (!game) return;
    if (game.phase === 'lobby') nextQ();
    else if (game.phase === 'question') reveal();
    else if (game.phase === 'reveal') { game.phase = 'board'; push(); }
    else if (game.phase === 'board' && game.round < game.qs.length - 1) nextQ();
  }));
  s.on('reset', T(() => {
    if (game) clearTimeout(game.timer);
    game = null; io.sockets.sockets.forEach(x => x.data.token = null); push();
  }));
});
srv.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Běží na portu', process.env.PORT || 3000));
