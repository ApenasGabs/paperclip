#!/usr/bin/env node
const { spawn, execFileSync } = require('child_process');
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
const MAX_LOCAL_GABISA = Number(process.env.KRAKEN_MAX_LOCAL_SLOTS || 4);
// Fase 0 (2026-11-11): worker remoto/WOL opt-in; Dell roda 24/7. Espera de slot limitada.
const REMOTE_ENABLED = process.env.KRAKEN_ENABLE_REMOTE === '1';
const SLOT_WAIT_MAX_MS = Number(process.env.KRAKEN_SLOT_WAIT_MAX_SEC || 600) * 1000;

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
  linkIfMissing('/paperclip/.git-credentials', path.join(homeDir, '.git-credentials'));
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

// Cota ao vivo é persistida em state.accounts[id].liveQuota com TTL, pois cada
// execução do wrapper é um processo curto (cache só em memória não sobrevive).
const LIVE_QUOTA_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIVE_QUOTA = () => ({ gemini: 100, claudeGpt: 100, argon: 100, resetTimes: {} });

function getModelFamily(modelId) {
  if (!modelId) return 'gemini';
  const m = String(modelId).toLowerCase();
  if (m.includes('claude') || m.includes('gpt') || m.includes('3p')) return 'claudeGpt';
  if (m.includes('argon')) return 'argon';
  return 'gemini';
}

function fetchLiveQuotaForProfile(acc, homeDir) {
  const now = Date.now();
  const cached = acc.liveQuota;
  if (cached && cached.data && (now - (cached.fetchedAt || 0)) < LIVE_QUOTA_TTL_MS) {
    return cached.data;
  }
  try {
    const stdout = execFileSync('/usr/local/bin/agy', ['--print', '/usage', '--output-format', 'json'], {
      env: { ...process.env, HOME: homeDir },
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString();
    const parsed = JSON.parse(stdout);
    const rawGroups = parsed?.command?.data?.groups || [];
    const summary = DEFAULT_LIVE_QUOTA();

    for (const g of rawGroups) {
      const gName = (g.name || '').toLowerCase();
      let key = 'gemini';
      if (gName.includes('claude') || gName.includes('gpt')) key = 'claudeGpt';
      else if (gName.includes('argon')) key = 'argon';

      for (const b of (g.buckets || [])) {
        const pct = Math.round((typeof b.remaining_fraction === 'number' ? b.remaining_fraction : 1) * 100);
        summary[key] = Math.min(summary[key], pct);
        if (b.reset_time && pct <= 10) {
          summary.resetTimes[key] = b.reset_time;
        }
      }
    }
    acc.liveQuota = { fetchedAt: now, data: summary };
    return summary;
  } catch {
    return (cached && cached.data) || DEFAULT_LIVE_QUOTA();
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
    const liveQuota = fetchLiveQuotaForProfile(acc, homeDir);

    list.push({
      safeId,
      email,
      homeDir,
      tokenRaw: raw,
      activeCount: acc.activePids.length,
      tokens5h,
      cooldownUntil: acc.cooldownUntil || 0,
      totalRuns: acc.totalRuns || 0,
      liveQuota
    });
  }
  return list;
}

function selectBestAccount(state, resumeConvId, excludeIds = new Set(), requestedModel = 'gemini') {
  const all = getAvailableAccounts(state).filter(a => !excludeIds.has(a.safeId));
  if (all.length === 0) return null;

  const now = Date.now();
  const nonCooling = all.filter(a => (a.cooldownUntil || 0) <= now);
  const eligibleAccounts = nonCooling.length > 0 ? nonCooling : all;

  // 1. Conta forçada explicitamente via variável de ambiente AGY_ACCOUNT
  if (process.env.AGY_ACCOUNT) {
    const forced = eligibleAccounts.find(a => a.email.includes(process.env.AGY_ACCOUNT) || a.safeId.includes(process.env.AGY_ACCOUNT));
    if (forced) {
      forced.effectiveModel = requestedModel;
      forced.effectiveFamily = getModelFamily(requestedModel);
      return forced;
    }
  }

  // 2. Continuidade de sessão / conversa existente
  const requestedFamily = getModelFamily(requestedModel);
  if (resumeConvId && state.conversations[resumeConvId]) {
    const ownerId = state.conversations[resumeConvId];
    const owner = eligibleAccounts.find(a => a.safeId === ownerId);
    if (owner && owner.activeCount === 0) {
      const q = owner.liveQuota ? (owner.liveQuota[requestedFamily] ?? 100) : 100;
      if (q > 5) {
        owner.effectiveModel = requestedModel;
        owner.effectiveFamily = requestedFamily;
        return owner;
      }
    }
  }

  // 3. FLUXO CANÔNICO DE PRIORIDADE: Opus > Argon > Flash
  // Constrói a cadeia de busca conforme o modelo solicitado ou a hierarquia ideal
  let searchChain = [];
  if (requestedFamily === 'claudeGpt' || requestedModel === 'auto' || requestedModel === 'gemini') {
    searchChain = [
      { family: 'claudeGpt', model: (requestedModel && requestedModel.includes('opus')) ? requestedModel : 'claude-opus-5-5-medium', label: 'Opus' },
      { family: 'argon', model: 'gemini-4-argon-medium', label: 'Argon' },
      { family: 'gemini', model: 'gemini-3.8-flash-high', label: 'Flash' }
    ];
  } else if (requestedFamily === 'argon') {
    searchChain = [
      { family: 'argon', model: requestedModel || 'gemini-4-argon-medium', label: 'Argon' },
      { family: 'claudeGpt', model: 'claude-opus-5-5-medium', label: 'Opus' },
      { family: 'gemini', model: 'gemini-3.8-flash-high', label: 'Flash' }
    ];
  } else {
    searchChain = [
      { family: 'gemini', model: requestedModel || 'gemini-3.8-flash-high', label: 'Flash' },
      { family: 'claudeGpt', model: 'claude-opus-5-5-medium', label: 'Opus' },
      { family: 'argon', model: 'gemini-4-argon-medium', label: 'Argon' }
    ];
  }

  // 4. Avalia cada tier na ordem Opus > Argon > Flash
  // Em cada tier, inspeciona TODAS as contas e escolhe rigorosamente a conta com MAIS cota disponível (> 5%)
  for (let tierIdx = 0; tierIdx < searchChain.length; tierIdx++) {
    const tier = searchChain[tierIdx];
    const candidates = eligibleAccounts
      .map(acc => ({
        acc,
        quota: acc.liveQuota ? (acc.liveQuota[tier.family] ?? 100) : 100
      }))
      .filter(item => item.quota > 5);

    if (candidates.length > 0) {
      // Ordenação rigorosa: conta com MAIOR cota restante primeiro!
      candidates.sort((a, b) => {
        if (b.quota !== a.quota) return b.quota - a.quota; // Prioriza quem tem mais cota real
        if (a.acc.activeCount !== b.acc.activeCount) return a.acc.activeCount - b.acc.activeCount; // Menos processos ativos
        if (Math.abs(a.acc.tokens5h - b.acc.tokens5h) > 50000) return a.acc.tokens5h - b.acc.tokens5h; // Menor consumo nas últimas 5h
        return a.acc.totalRuns - b.acc.totalRuns; // Distribuição justa
      });

      const winnerItem = candidates[0];
      const winner = winnerItem.acc;
      winner.effectiveModel = tier.model;
      winner.effectiveFamily = tier.family;

      if (tierIdx > 0) {
        const skipped = searchChain.slice(0, tierIdx).map(t => t.label).join(', ');
        process.stderr.write(`[agy-pool] Cascade router (Opus > Argon > Flash): ${skipped} sem cota suficiente (>5%), selecionado ${tier.model} (${tier.label}) na conta ${winner.email} com maior cota restante (${winnerItem.quota}%)\n`);
      } else {
        process.stderr.write(`[agy-pool] Dynamic router: selecionada conta ${winner.email} para ${tier.model} (${tier.label}) com maior cota restante (${winnerItem.quota}%)\n`);
      }
      return winner;
    }
  }

  // 5. Fallback de emergência caso todas as contas estejam com <= 5% em todos os modelos:
  // Seleciona a conta que possuir a maior cota absoluta residual em qualquer família
  const sortedOverall = [...eligibleAccounts].sort((a, b) => {
    const maxA = Math.max(a.liveQuota?.gemini ?? 0, a.liveQuota?.claudeGpt ?? 0, a.liveQuota?.argon ?? 0);
    const maxB = Math.max(b.liveQuota?.gemini ?? 0, b.liveQuota?.claudeGpt ?? 0, b.liveQuota?.argon ?? 0);
    return maxB - maxA;
  });

  const fallbackAcc = sortedOverall[0];
  fallbackAcc.effectiveModel = 'gemini-3.8-flash-high';
  fallbackAcc.effectiveFamily = 'gemini';
  process.stderr.write(`[agy-pool] Warning: Todas as contas estão com cota crítica (<=5%). Fallback resiliente para ${fallbackAcc.email} com gemini-3.8-flash-high.\n`);
  return fallbackAcc;
}

async function waitForLocalSlotIfNeeded() {
  const startedWait = Date.now();
  let lastLog = 0;
  while (true) {
    const state = loadState();
    state.localActivePids = (state.localActivePids || []).filter(isPidAlive);
    if (state.localActivePids.length < MAX_LOCAL_GABISA) {
      state.localActivePids.push(process.pid);
      saveState(state);
      return;
    }
    const waited = Date.now() - startedWait;
    if (waited - lastLog >= 60000 || lastLog === 0) {
      lastLog = waited || 1;
      process.stderr.write('[agy-pool] Waiting for local slot (' + state.localActivePids.length + '/' + MAX_LOCAL_GABISA + ' busy: ' + state.localActivePids.join(',') + ') for ' + Math.round(waited / 1000) + 's\n');
    }
    if (waited > SLOT_WAIT_MAX_MS) {
      process.stderr.write('[agy-pool] ERROR: no local slot freed after ' + Math.round(waited / 1000) + 's. Busy PIDs: ' + state.localActivePids.join(',') + '. Aborting run.\n');
      process.exit(4);
    }
    if (REMOTE_ENABLED) {
      sendWakeOnLan(WOL_MAC);
      if (await checkRemoteWorker(1000)) return;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

const rawArgs = process.argv.slice(2);
const baseAgyArgs = ['--dangerously-skip-permissions'];
let promptVal = null;
let resumeSid = null;
let requestedModel = 'gemini';

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
    if (m && m !== 'auto') {
      requestedModel = m;
    }
  } else if (a.startsWith('--model=')) {
    const m = a.slice('--model='.length);
    if (m && m !== 'auto') {
      requestedModel = m;
    }
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
    const chosen = selectBestAccount(state, resumeSid, triedAccounts, requestedModel);
    if (!chosen) {
      process.stderr.write('[agy-pool] All accounts in pool are currently exhausted! Pausing execution.\n');
      process.exit(3);
    }
    triedAccounts.add(chosen.safeId);

    if (state.accounts[chosen.safeId]) {
      state.accounts[chosen.safeId].activePids.push(process.pid);
      state.accounts[chosen.safeId].totalRuns = (state.accounts[chosen.safeId].totalRuns || 0) + 1;
      saveState(state);
    }

    const runArgs = [...baseAgyArgs];
    if (chosen.effectiveModel) {
      runArgs.push('--model', chosen.effectiveModel);
    }
    if (resumeSid && state.conversations[resumeSid] === chosen.safeId) {
      runArgs.push('--conversation', resumeSid);
    }
    if (promptVal !== null) {
      runArgs.push('--prompt=' + promptVal);
    }

    const isRemoteUp = REMOTE_ENABLED ? await checkRemoteWorker(600) : false;
    if (!isRemoteUp) {
      if (REMOTE_ENABLED) sendWakeOnLan(WOL_MAC);
      await waitForLocalSlotIfNeeded();
    }

    const family = chosen.effectiveFamily || getModelFamily(chosen.effectiveModel || requestedModel);
    const livePct = chosen.liveQuota ? (chosen.liveQuota[family] ?? 'N/A') : 'N/A';
    process.stderr.write('[agy-pool] Dynamic router selected account: ' + chosen.email + ' (Live ' + family + ' Quota: ' + livePct + '%, 5h tokens: ' + (chosen.tokens5h || 0) + ', active: ' + (chosen.activeCount || 0) + ', node: ' + (isRemoteUp ? 'PC-32GB' : 'gabisa') + ')\n');

    const outcome = await new Promise((resolve) => {
      let quotaErrorDetected = false;
      let rawStderr = '';
      let totalTokensUsed = 0;
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
              model: 'agy (' + chosen.email + ')'
            }) + '\n');
          } else if (obj.event === 'session_start' && obj.session_start) {
            const s = obj.session_start;
            detectedConvId = s.conversation_id;
            process.stdout.write(JSON.stringify({
              type: 'system',
              subtype: 'init',
              session_id: s.conversation_id,
              model: (s.model || 'agy') + ' (' + chosen.email + ')'
            }) + '\n');
          } else if (obj.event === 'step_update' && obj.step_update) {
            const u = obj.step_update;
            if (u.usage && u.usage.total_tokens) {
              totalTokensUsed = Math.max(totalTokensUsed, u.usage.total_tokens);
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
          BROWSERLESS_URL: 'http://192.168.31.5:9222?token=kraken_cdp_secret',
          BROWSERLESS_WS_ENDPOINT: 'ws://192.168.31.5:9222?token=kraken_cdp_secret'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stderr.on('data', (d) => {
        const s = d.toString();
        rawStderr += s;
        if (/quota|429|ResourceExhausted|rate.?limit|exhausted/i.test(s)) {
          quotaErrorDetected = true;
        }
        process.stderr.write(d);
      });

      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', handleLine);

      child.on('exit', (code, signal) => {
        resolve({ code, signal, quotaErrorDetected, rawStderr, totalTokensUsed, detectedConvId });
      });
    });

    const postState = loadState();
    postState.localActivePids = (postState.localActivePids || []).filter(p => p !== process.pid && isPidAlive(p));
    if (postState.accounts[chosen.safeId]) {
      const acc = postState.accounts[chosen.safeId];
      acc.activePids = (acc.activePids || []).filter(p => p !== process.pid && isPidAlive(p));
      if (outcome.totalTokensUsed > 0) {
        acc.history = acc.history || [];
        acc.history.push({ ts: Date.now(), tokens: outcome.totalTokensUsed });
      }
      if (outcome.quotaErrorDetected) {
        let cooldownMs = 30 * 60 * 1000;
        const match = outcome.rawStderr && outcome.rawStderr.match(/Resets in (\d+)h(?:(\d+)m)?/i);
        if (match) {
          const hours = parseInt(match[1], 10) || 0;
          const mins = parseInt(match[2] || '0', 10) || 0;
          cooldownMs = (hours * 3600 + mins * 60 + 120) * 1000;
        }
        acc.cooldownUntil = Date.now() + cooldownMs;
        process.stderr.write('[agy-pool] Account ' + chosen.email + ' hit quota limit! Placing in ' + Math.round(cooldownMs / 60000) + 'm cooldown and failing over...\n');
      }
    }
    if (outcome.detectedConvId && !outcome.quotaErrorDetected) {
      postState.conversations[outcome.detectedConvId] = chosen.safeId;
    }
    saveState(postState);

    const remainingAccounts = getAvailableAccounts(postState).filter(a => !triedAccounts.has(a.safeId));
    if (outcome.quotaErrorDetected && remainingAccounts.length > 0) {
      continue;
    }

    if (outcome.signal) process.kill(process.pid, outcome.signal);
    else process.exit(outcome.code ?? 0);
  }
}

runWithFailover();
