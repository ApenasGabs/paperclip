#!/usr/bin/env node
const { spawn, execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const http = require('http');
const dgram = require('dgram');

const BASE_DIR = '/paperclip/accounts';
const TOKENS_DIR = path.join(BASE_DIR, 'tokens');
const PROFILES_DIR = path.join(BASE_DIR, 'profiles');
const STATE_FILE = path.join(BASE_DIR, 'pool-state.json');
const SHARED_GEMINI = '/paperclip/.gemini';

// Remote 32GB Windows Compute Node configuration
const REMOTE_HOST = process.env.KRAKEN_COMPUTE_HOST || '192.168.31.4';
const REMOTE_PORT = Number(process.env.KRAKEN_COMPUTE_PORT || 9224);
const WOL_MAC = '00:E0:22:20:01:F4';
const WOL_BROADCAST = '192.168.31.255';
const MAX_LOCAL_GABISA = 2;

function sendWakeOnLan(macStr) {
  try {
    const mac = macStr.split(':').map(h => parseInt(h, 16));
    const pkt = Buffer.alloc(102);
    pkt.fill(0xff, 0, 6);
    for (let i = 1; i <= 16; i++) {
      for (let j = 0; j < 6; j++) pkt[i * 6 + j] = mac[j];
    }
    const sock = dgram.createSocket('udp4');
    sock.once('error', () => sock.close());
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(pkt, 0, pkt.length, 9, WOL_BROADCAST, () => sock.close());
    });
  } catch {}
}

function checkRemoteWorker(timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get({ host: REMOTE_HOST, port: REMOTE_PORT, path: '/health', timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function ensureDirs() {
  fs.mkdirSync(TOKENS_DIR, { recursive: true });
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

function recordKrakenUsage(chosen, currentModel, outcome) {
  for (const qDir of ['/kraken-data', '/paperclip/kraken-data']) {
    try {
      const quotaFile = path.join(qDir, 'quota_history.json');
      if (!fs.existsSync(quotaFile)) continue;
      const raw = fs.readFileSync(quotaFile, 'utf8');
      const records = JSON.parse(raw);
      const u = outcome.usage || {};
      const inp = u.input_tokens || Math.round((outcome.totalTokensUsed || 0) * 0.85);
      const out = u.output_tokens || Math.round((outcome.totalTokensUsed || 0) * 0.15);
      const entry = {
        id: 'pcp_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36),
        timestamp: new Date().toISOString(),
        agent: 'paperclip',
        model: currentModel,
        subproject: 'Paperclip AI',
        conversationId: outcome.detectedConvId || ('pcp_' + Date.now()),
        durationMs: outcome.durationMs || 0,
        input_tokens: inp,
        output_tokens: out,
        thinking_tokens: u.thinking_tokens || 0,
        total_tokens: outcome.totalTokensUsed || (inp + out)
      };
      records.push(entry);
      fs.writeFileSync(quotaFile, JSON.stringify(records, null, 2), 'utf8');
      break;
    } catch {}
  }
}

function syncTokensFromShared() {
  try {
    const cliDir = path.join(SHARED_GEMINI, 'antigravity-cli');
    if (fs.existsSync(cliDir)) {
      for (const f of fs.readdirSync(cliDir)) {
        if (!f.startsWith('antigravity-oauth-token')) continue;
        const full = path.join(cliDir, f);
        try {
          const raw = fs.readFileSync(full, 'utf8');
          const j = JSON.parse(raw);
          if (j.id_token) {
            const payload = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64').toString());
            if (payload.email) {
              const safeId = payload.email.replace(/[^a-zA-Z0-9._-]/g, '_');
              const dest = path.join(TOKENS_DIR, safeId + '.json');
              if (!fs.existsSync(dest) || f === 'antigravity-oauth-token') {
                fs.writeFileSync(dest, raw, { mode: 0o600 });
              }
            }
          }
        } catch {}
      }
    }
    for (const krakenAccDir of ['/kraken-data/accounts', '/paperclip/kraken-data/accounts']) {
      if (fs.existsSync(krakenAccDir)) {
        for (const f of fs.readdirSync(krakenAccDir)) {
          if (!f.endsWith('.json')) continue;
          const full = path.join(krakenAccDir, f);
          try {
            const raw = fs.readFileSync(full, 'utf8');
            const j = JSON.parse(raw);
            let tokenObj = j.oauthToken || j.antigravityToken;
            if (!tokenObj && j.raw) {
              try { tokenObj = JSON.parse(j.raw); } catch {}
            }
            if (!tokenObj) tokenObj = j;
            if (tokenObj.id_token && (tokenObj.token || tokenObj.access_token)) {
              const payload = JSON.parse(Buffer.from(tokenObj.id_token.split('.')[1], 'base64').toString());
              const email = payload.email || j.email || f.replace('.json', '');
              const safeId = email.replace(/[^a-zA-Z0-9._-]/g, '_');
              fs.writeFileSync(path.join(TOKENS_DIR, safeId + '.json'), JSON.stringify(tokenObj), { mode: 0o600 });
            }
          } catch {}
        }
      }
    }
  } catch {}
}

function ensureProfile(safeId, email, tokenRaw) {
  const homeDir = path.join(PROFILES_DIR, safeId);
  const geminiDir = path.join(homeDir, '.gemini');
  const cliDir = path.join(geminiDir, 'antigravity-cli');
  fs.mkdirSync(cliDir, { recursive: true });

  const linkIfMissing = (target, linkPath) => {
    try {
      if (!fs.existsSync(linkPath)) fs.symlinkSync(target, linkPath);
    } catch {}
  };

  linkIfMissing(path.join(SHARED_GEMINI, 'config'), path.join(geminiDir, 'config'));
  linkIfMissing('config', path.join(geminiDir, 'antigravity'));
  linkIfMissing(path.join(SHARED_GEMINI, 'oauth_creds.json'), path.join(geminiDir, 'oauth_creds.json'));
  linkIfMissing(path.join(SHARED_GEMINI, 'skills'), path.join(geminiDir, 'skills'));
  linkIfMissing(path.join(SHARED_GEMINI, 'settings.json'), path.join(geminiDir, 'settings.json'));
  linkIfMissing(path.join(SHARED_GEMINI, 'antigravity-cli', 'settings.json'), path.join(cliDir, 'settings.json'));
  linkIfMissing(path.join(SHARED_GEMINI, 'antigravity-cli', 'mcp'), path.join(cliDir, 'mcp'));
  linkIfMissing('/workspace/.code-review-graph', path.join(homeDir, '.code-review-graph'));
  linkIfMissing('/workspace/.local', path.join(homeDir, '.local'));
  linkIfMissing('/paperclip/.gitconfig', path.join(homeDir, '.gitconfig'));
  const binDir = path.join(cliDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  linkIfMissing('/workspace/.local/share/uv/tools/code-review-graph/bin/code-review-graph', path.join(binDir, 'code-review-graph'));
  linkIfMissing('/workspace/.local/share/uv/tools/code-review-graph/bin/crg-daemon', path.join(binDir, 'crg-daemon'));

  const instIdSrc = path.join(SHARED_GEMINI, 'antigravity-cli', 'installation_id');
  const instIdDst = path.join(cliDir, 'installation_id');
  if (fs.existsSync(instIdSrc) && !fs.existsSync(instIdDst)) {
    fs.copyFileSync(instIdSrc, instIdDst);
  }

  fs.writeFileSync(path.join(geminiDir, 'google_accounts.json'), JSON.stringify({ active: email, old: [] }, null, 2));
  fs.writeFileSync(path.join(cliDir, 'antigravity-oauth-token'), tokenRaw, { mode: 0o600 });
  return homeDir;
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return { accounts: {}, conversations: {}, localActivePids: [] };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function fetchLiveQuotas(homeDir) {
  try {
    const stdout = execSync('/usr/local/bin/agy --print "/usage" --output-format json', {
      env: { ...process.env, HOME: homeDir },
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString();
    const parsed = JSON.parse(stdout.trim());
    const groups = parsed?.command?.data?.groups || [];
    let argon = 0;
    let gemini = 0;
    let claude = 0;

    for (const g of groups) {
      const gName = (g.name || '').toLowerCase();
      let minPct = 100;
      for (const b of (g.buckets || [])) {
        const pct = Math.round((b.remaining_fraction ?? 1) * 100);
        if (pct < minPct) minPct = pct;
      }
      if (gName.includes('argon')) {
        argon = minPct;
      } else if (gName.includes('gemini')) {
        gemini = minPct;
      } else if (gName.includes('claude') || gName.includes('gpt')) {
        claude = minPct;
      }
    }
    return { argon, gemini, claude, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

function getAvailableAccounts(state) {
  ensureDirs();
  syncTokensFromShared();
  const files = fs.readdirSync(TOKENS_DIR).filter(f => f.endsWith('.json'));
  const list = [];
  const now = Date.now();
  const fiveHoursAgo = now - 5 * 3600 * 1000;

  for (const f of files) {
    const safeId = f.replace(/\.json$/, '');
    const raw = fs.readFileSync(path.join(TOKENS_DIR, f), 'utf8');
    let email = safeId;
    try {
      const j = JSON.parse(raw);
      if (j.id_token) {
        const p = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64').toString());
        if (p.email) email = p.email;
      }
    } catch {}
    const homeDir = ensureProfile(safeId, email, raw);
    if (!state.accounts[safeId]) {
      state.accounts[safeId] = { email, activePids: [], history: [], cooldownUntil: 0, totalRuns: 0 };
    }
    const acc = state.accounts[safeId];
    acc.email = email;
    acc.activePids = (acc.activePids || []).filter(isPidAlive);
    acc.history = (acc.history || []).filter(h => h.ts > fiveHoursAgo);
    const tokens5h = acc.history.reduce((s, h) => s + (h.tokens || 0), 0);

    // Refresh quotas if older than 5 minutes or missing
    if (!acc.quotas || !acc.quotas.fetchedAt || (now - acc.quotas.fetchedAt > 5 * 60 * 1000)) {
      const live = fetchLiveQuotas(homeDir);
      if (live) acc.quotas = live;
    }

    list.push({
      safeId,
      email,
      homeDir,
      tokenRaw: raw,
      activeCount: acc.activePids.length,
      tokens5h,
      cooldownUntil: acc.cooldownUntil || 0,
      totalRuns: acc.totalRuns || 0,
      quotas: acc.quotas || { argon: 0, gemini: 50, claude: 50 }
    });
  }
  return list;
}

function selectBestAccount(state, resumeConvId, excludeIds = new Set()) {
  const all = getAvailableAccounts(state).filter(a => !excludeIds.has(a.safeId));
  if (all.length === 0) return null;

  const now = Date.now();
  const healthy = all.filter(a => {
    if ((a.cooldownUntil || 0) > now) return false;
    const q = a.quotas || {};
    return (q.argon > 0 || q.gemini > 0 || q.claude > 0);
  });

  const candidates = healthy.length > 0 ? healthy : all;
  if (candidates.length === 0) return null;

  if (process.env.AGY_ACCOUNT) {
    const forced = candidates.find(a => a.email.includes(process.env.AGY_ACCOUNT) || a.safeId.includes(process.env.AGY_ACCOUNT));
    if (forced) return forced;
  }

  if (resumeConvId && state.conversations[resumeConvId]) {
    const ownerId = state.conversations[resumeConvId];
    const owner = candidates.find(a => a.safeId === ownerId);
    if (owner && owner.activeCount === 0) return owner;
  }

  candidates.sort((a, b) => {
    const cdA = Math.max(0, (a.cooldownUntil || 0) - now);
    const cdB = Math.max(0, (b.cooldownUntil || 0) - now);
    if (cdA !== cdB) return cdA - cdB;
    if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
    const qA = (a.quotas?.gemini || 0) + (a.quotas?.claude || 0) + (a.quotas?.argon || 0);
    const qB = (b.quotas?.gemini || 0) + (b.quotas?.claude || 0) + (b.quotas?.argon || 0);
    if (Math.abs(qA - qB) > 20) return qB - qA;
    if (Math.abs(a.tokens5h - b.tokens5h) > 50000) return a.tokens5h - b.tokens5h;
    return a.totalRuns - b.totalRuns;
  });

  return candidates[0];
}

function resolveModelSequence(quotas, requestedModel) {
  if (requestedModel && requestedModel !== 'auto') {
    return [requestedModel, 'gemini-3.8-flash-high', 'claude-sonnet-5-5-medium'];
  }

  const q = quotas || {};
  const sequence = [];

  // 1. Argon if healthy
  if (q.argon > 5) {
    sequence.push('gemini-4-argon-medium');
  }

  // 2. Claude Sonnet if available
  if (q.claude > 10) {
    sequence.push('claude-sonnet-5-5-medium');
  }

  // 3. Gemini 3.8 Flash (High reasoning)
  if (q.gemini > 5) {
    sequence.push('gemini-3.8-flash-high');
  }

  // 4. Gemini 3.8 Flash (Medium) as final safety net
  sequence.push('gemini-3.8-flash-medium');

  return sequence;
}

async function waitForLocalSlotIfNeeded() {
  while (true) {
    const state = loadState();
    state.localActivePids = (state.localActivePids || []).filter(isPidAlive);
    if (state.localActivePids.length < MAX_LOCAL_GABISA) {
      state.localActivePids.push(process.pid);
      saveState(state);
      return;
    }
    sendWakeOnLan(WOL_MAC);
    if (await checkRemoteWorker(1000)) return;
    await new Promise(r => setTimeout(r, 3000));
  }
}

const rawArgs = process.argv.slice(2);
const baseAgyArgs = ['--dangerously-skip-permissions'];
let promptVal = null;
let resumeSid = null;
let userRequestedModel = null;

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--approval-mode') {
    i++;
  } else if (a.startsWith('--approval-mode=')) {
    // skip
  } else if (a === '--sandbox' || a.startsWith('--sandbox=')) {
    // skip
  } else if (a === '-acp' || a === '--acp') {
    // skip acp flag from paperclip
  } else if (a === '--model') {
    const m = rawArgs[++i];
    if (m && m !== 'auto') userRequestedModel = m;
  } else if (a.startsWith('--model=')) {
    const m = a.slice('--model='.length);
    if (m && m !== 'auto') userRequestedModel = m;
  } else if (a === '--resume' || a === '-r') {
    resumeSid = rawArgs[++i];
  } else if (a === '--prompt' || a === '-p') {
    promptVal = rawArgs[++i] || '';
  } else if (a.startsWith('--prompt=')) {
    promptVal = a.slice('--prompt='.length);
  } else {
    baseAgyArgs.push(a);
  }
}

async function runWithFailover() {
  const triedAccounts = new Set();

  while (true) {
    const state = loadState();
    const chosen = selectBestAccount(state, resumeSid, triedAccounts);
    if (!chosen) {
      process.stderr.write('[agy-pool] All accounts in pool are currently exhausted or in cooldown! Pausing execution.\n');
      process.exit(3);
    }
    triedAccounts.add(chosen.safeId);

    if (state.accounts[chosen.safeId]) {
      state.accounts[chosen.safeId].activePids.push(process.pid);
      state.accounts[chosen.safeId].totalRuns = (state.accounts[chosen.safeId].totalRuns || 0) + 1;
      saveState(state);
    }

    const modelSequence = resolveModelSequence(chosen.quotas, userRequestedModel);
    let accountSucceeded = false;

    for (let mIdx = 0; mIdx < modelSequence.length; mIdx++) {
      const currentModel = modelSequence[mIdx];
      const runArgs = [...baseAgyArgs];
      runArgs.push('--model', currentModel);

      if (resumeSid && state.conversations[resumeSid] === chosen.safeId) {
        runArgs.push('--conversation', resumeSid);
      }
      if (promptVal !== null) {
        runArgs.push('--prompt=' + promptVal);
      }

      const isRemoteUp = await checkRemoteWorker(600);
      if (!isRemoteUp) {
        sendWakeOnLan(WOL_MAC);
        await waitForLocalSlotIfNeeded();
      }

      process.stderr.write('[agy-pool] Account: ' + chosen.email + ' | Model: ' + currentModel + ' (Argon: ' + (chosen.quotas?.argon ?? '?') + '%, Gemini: ' + (chosen.quotas?.gemini ?? '?') + '%, Claude: ' + (chosen.quotas?.claude ?? '?') + '% | Node: ' + (isRemoteUp ? 'PC-32GB' : 'gabisa') + ')\n');

      const startTime = Date.now();
      const outcome = await new Promise((resolve) => {
        let quotaErrorDetected = false;
        let rawStderr = '';
        let totalTokensUsed = 0;
        let usage = null;
        let detectedConvId = null;

        const handleLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) {
            process.stdout.write(line + '\n');
            return;
          }
          try {
            const obj = JSON.parse(trimmed);
            if (obj.event === 'init') {
              detectedConvId = obj.conversation_id;
              process.stdout.write(JSON.stringify({
                type: 'system',
                subtype: 'init',
                session_id: obj.conversation_id,
                model: currentModel + ' (' + chosen.email + ')'
              }) + '\n');
            } else if (obj.event === 'session_start' && obj.session_start) {
              const s = obj.session_start;
              detectedConvId = s.conversation_id;
              process.stdout.write(JSON.stringify({
                type: 'system',
                subtype: 'init',
                session_id: s.conversation_id,
                model: currentModel + ' (' + chosen.email + ')'
              }) + '\n');
            } else if (obj.event === 'step_update' && obj.step_update) {
              const u = obj.step_update;
              if (u.usage && u.usage.total_tokens) {
                totalTokensUsed = Math.max(totalTokensUsed, u.usage.total_tokens);
                usage = u.usage;
              }
              if (u.step_type === 'agent_response' && u.text_delta) {
                process.stdout.write(JSON.stringify({
                  type: 'assistant',
                  message: { role: 'assistant', content: [{ type: 'text', text: u.text_delta }] }
                }) + '\n');
              } else if (u.thinking_delta) {
                process.stdout.write(JSON.stringify({
                  type: 'thinking',
                  text: u.thinking_delta
                }) + '\n');
              } else {
                process.stdout.write(JSON.stringify({
                  type: 'system',
                  subtype: u.step_type ? (u.step_type + ':' + (u.state || '')) : 'step_update'
                }) + '\n');
              }
            } else if (obj.event === 'result' && obj.result) {
              const r = obj.result;
              if (r.conversation_id) detectedConvId = r.conversation_id;
              if (r.usage && r.usage.total_tokens) {
                totalTokensUsed = Math.max(totalTokensUsed, r.usage.total_tokens);
                usage = r.usage;
              }
              const errText = JSON.stringify(r);
              if (r.status !== 'SUCCESS' && /quota|429|ResourceExhausted|rate.?limit|exhausted/i.test(errText)) {
                quotaErrorDetected = true;
              }
              if (!quotaErrorDetected) {
                const isErr = r.status && r.status !== 'SUCCESS';
                process.stdout.write(JSON.stringify({
                  type: 'result',
                  status: isErr ? 'error' : 'success',
                  is_error: !!isErr,
                  session_id: r.conversation_id,
                  response: r.response || '',
                  result: r.response || '',
                  usage: r.usage || {}
                }) + '\n');
              }
            } else {
              process.stdout.write(line + '\n');
            }
          } catch {
            process.stdout.write(line + '\n');
          }
        };

        const child = spawn('/usr/local/bin/agy', runArgs, {
          env: {
            ...process.env,
            HOME: chosen.homeDir,
            CRG_HOME: '/workspace/.code-review-graph',
            PATH: '/workspace/.local/bin:/paperclip/.local/bin:' + (process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'),
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
            BROWSERLESS_URL: 'http://192.168.31.2:9222?token=kraken_cdp_secret',
            BROWSERLESS_WS_ENDPOINT: 'ws://192.168.31.2:9222?token=kraken_cdp_secret'
          },
          stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stderr.on('data', (d) => {
          const s = d.toString();
          rawStderr += s;
          if (/quota|429|ResourceExhausted|rate.?limit|exhausted|capacity|credit|token.?limit/i.test(s)) {
            quotaErrorDetected = true;
          }
          process.stderr.write(d);
        });

        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', handleLine);

        child.on('exit', (code, signal) => {
          resolve({
            code,
            signal,
            quotaErrorDetected,
            rawStderr,
            totalTokensUsed,
            usage,
            detectedConvId,
            durationMs: Date.now() - startTime
          });
        });
      });

      const postState = loadState();
      postState.localActivePids = (postState.localActivePids || []).filter(p => p !== process.pid && isPidAlive(p));
      const acc = postState.accounts[chosen.safeId];

      if (acc) {
        acc.activePids = (acc.activePids || []).filter(p => p !== process.pid && isPidAlive(p));
        if (outcome.totalTokensUsed > 0) {
          acc.history = acc.history || [];
          acc.history.push({ ts: Date.now(), tokens: outcome.totalTokensUsed });
        }

        if (outcome.quotaErrorDetected) {
          acc.quotas = acc.quotas || {};
          if (currentModel.includes('argon')) acc.quotas.argon = 0;
          else if (currentModel.includes('claude') || currentModel.includes('gpt')) acc.quotas.claude = 0;
          else acc.quotas.gemini = 0;

          process.stderr.write('[agy-pool] Model ' + currentModel + ' hit quota on ' + chosen.email + '! Attempting fallback...\n');
        }
      }

      if (outcome.detectedConvId && !outcome.quotaErrorDetected) {
        postState.conversations[outcome.detectedConvId] = chosen.safeId;
      }
      saveState(postState);

      if (!outcome.quotaErrorDetected && outcome.code === 0) {
        accountSucceeded = true;
        // Record token usage into Kraken's quota_history.json
        if (outcome.totalTokensUsed > 0) {
          recordKrakenUsage(chosen, currentModel, outcome);
        }
        if (outcome.signal) process.kill(process.pid, outcome.signal);
        else process.exit(0);
        return;
      }

      if (outcome.signal) {
        process.kill(process.pid, outcome.signal);
        return;
      }
    }

    const finalState = loadState();
    if (finalState.accounts[chosen.safeId]) {
      let cooldownMs = 30 * 60 * 1000;
      finalState.accounts[chosen.safeId].cooldownUntil = Date.now() + cooldownMs;
      saveState(finalState);
    }
    process.stderr.write(`[agy-pool] Account ${chosen.email} exhausted all models or hit errors. Failing over to next account in pool...\n`);
  }
}

runWithFailover();
