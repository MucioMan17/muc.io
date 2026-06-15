const express = require('express');
const { execFile, spawn } = require('child_process');

const router = express.Router();

const IS_WIN = process.platform === 'win32';
const PYTHON_CMDS = ['python', 'python3', 'python3.12', 'python3.11', 'python3.10'];
const PIP_CMDS    = ['pip', 'pip3'];
const PACKAGES    = { holehe: 'holehe', sherlock: 'sherlock-project' };

function tryExec(cmd, args, timeout = 7000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, shell: IS_WIN }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), code: err?.code });
    });
  });
}

// Cache so repeated status calls are instant.
let cachedPython = null;
let cachedPip    = null;
let toolCache    = {};

async function findPython() {
  if (cachedPython) return cachedPython;
  for (const cmd of PYTHON_CMDS) {
    const r = await tryExec(cmd, ['--version']);
    const out = r.stdout + r.stderr;
    if (out.includes('Python')) { cachedPython = { cmd, version: out.trim() }; return cachedPython; }
  }
  return null;
}

async function findPip(python) {
  if (cachedPip) return cachedPip;
  for (const cmd of PIP_CMDS) {
    const r = await tryExec(cmd, ['--version']);
    if (r.stdout.includes('pip')) { cachedPip = { type: 'cmd', run: [cmd] }; return cachedPip; }
  }
  if (python) {
    const r = await tryExec(python.cmd, ['-m', 'pip', '--version']);
    if ((r.stdout + r.stderr).includes('pip')) {
      cachedPip = { type: 'module', run: [python.cmd, '-m', 'pip'] }; return cachedPip;
    }
  }
  return null;
}

async function checkTool(name) {
  if (toolCache[name] !== undefined) return toolCache[name];
  const r = await tryExec(name, ['--help'], 8000);
  const found = r.code !== 'ENOENT' && (r.stdout.length > 0 || r.stderr.length > 0 || r.ok);
  toolCache[name] = found;
  return found;
}

function clearToolCache() { toolCache = {}; cachedPython = null; cachedPip = null; }

// GET /api/tools/status
router.get('/status', async (req, res) => {
  const [python, holehe, sherlock] = await Promise.all([
    findPython(),
    checkTool('holehe'),
    checkTool('sherlock'),
  ]);
  res.json({
    python:  python  ? { found: true, version: python.version } : { found: false },
    holehe:  { installed: holehe },
    sherlock: { installed: sherlock },
  });
});

// GET /api/tools/install/:tool — SSE stream of pip install progress
router.get('/install/:tool', async (req, res) => {
  const toolName = req.params.tool;
  const pkg = PACKAGES[toolName];
  if (!pkg) { res.status(400).json({ error: 'Unknown tool' }); return; }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };
  const finish = (ok, msg) => { send({ type: 'done', success: ok, msg }); res.end(); };

  send({ type: 'log', text: '🔍 Looking for Python...' });
  const python = await findPython();
  if (!python) { finish(false, 'Python not found. Install Python from python.org then try again.'); return; }
  send({ type: 'log', text: `✓ ${python.version}` });

  send({ type: 'log', text: '🔍 Looking for pip...' });
  const pip = await findPip(python);
  if (!pip) { finish(false, 'pip not found. Re-install Python and tick "pip" during setup.'); return; }
  send({ type: 'log', text: `✓ pip found (${pip.run.join(' ')})` });

  send({ type: 'log', text: `📦 Installing ${pkg} — this takes 20–60 seconds...` });

  const args = [...pip.run.slice(1), 'install', pkg, '--upgrade'];
  let child;
  try {
    child = spawn(pip.run[0], args, { windowsHide: true, shell: IS_WIN });
  } catch (e) { finish(false, `Could not start install: ${e.message}`); return; }

  child.stdout.on('data', (d) => send({ type: 'log', text: String(d).trimEnd() }));
  child.stderr.on('data', (d) => send({ type: 'log', text: String(d).trimEnd() }));
  child.on('error', (e) => finish(false, `Install error: ${e.message}`));
  child.on('close', (code) => {
    clearToolCache();
    if (code === 0) finish(true,  `✅ ${toolName} installed! Your next investigation will use it automatically.`);
    else            finish(false, `❌ Exit code ${code}. Try: pip install ${pkg}`);
  });

  req.on('close', () => { try { if (child && !child.killed) child.kill(); } catch {} });
});

module.exports = router;
