#!/usr/bin/env node
// Patch CRS Wei-Shaw — fix Gemini OAuth (issue #995 + projectId discovery).
const fs = require('fs');

const SERVICE = '/app/src/services/account/geminiAccountService.js';
const ROUTE = '/app/src/routes/openaiGeminiRoutes.js';

const ENSURE_VALID_TOKEN = `
// ===== PATCH OmniForge: ensureValidToken (fixes upstream issue #995) =====
async function ensureValidToken(accountId) {
  try {
    let account = await getAccount(accountId)
    if (!account) {
      return { success: false, error: 'Account not found' }
    }
    if (isTokenExpired(account)) {
      logger.info(\`🔄 Token expired for Gemini account \${accountId}, refreshing...\`)
      await refreshAccountToken(accountId)
      account = await getAccount(accountId)
      if (!account) {
        return { success: false, error: 'Account vanished after refresh' }
      }
      if (isTokenExpired(account)) {
        return { success: false, error: 'Token still expired after refresh' }
      }
    }
    return { success: true, accessToken: account.accessToken }
  } catch (err) {
    logger.error(\`ensureValidToken error for \${accountId}:\`, err && err.message)
    return { success: false, error: err && err.message ? err.message : String(err) }
  }
}
// ===== END PATCH =====

`;

function patchService() {
  let src = fs.readFileSync(SERVICE, 'utf8');
  if (src.includes('ensureValidToken')) {
    console.log('  service: already patched');
    return false;
  }
  const needle = 'module.exports = {';
  if (!src.includes(needle)) throw new Error('module.exports not found');
  src = src.replace(needle, ENSURE_VALID_TOKEN + needle);
  src = src.replace('  isTokenExpired,\n', '  isTokenExpired,\n  ensureValidToken,\n');
  fs.writeFileSync(SERVICE, src);
  console.log('  service: patched');
  return true;
}

const ROUTE_OLD = `      const oauthProvider = account.oauthProvider || 'gemini-cli'
      let { projectId } = account

      if (oauthProvider === 'antigravity') {
        projectId = ensureAntigravityProjectId(account)
        if (!account.projectId && account.tempProjectId !== projectId) {
          await geminiAccountService.updateTempProjectId(account.id, projectId)
          account.tempProjectId = projectId
        }
      }`;

const ROUTE_NEW = `      const oauthProvider = account.oauthProvider || 'gemini-cli'
      let { projectId } = account

      if (oauthProvider === 'antigravity') {
        projectId = ensureAntigravityProjectId(account)
        if (!account.projectId && account.tempProjectId !== projectId) {
          await geminiAccountService.updateTempProjectId(account.id, projectId)
          account.tempProjectId = projectId
        }
      } else if (oauthProvider === 'gemini-cli' && !projectId) {
        // ===== PATCH OmniForge: auto-discover projectId via setupUser =====
        if (account.tempProjectId) {
          projectId = account.tempProjectId
          logger.info('🔄 Using tempProjectId for gemini-cli account', { projectId })
        } else {
          try {
            logger.info('🔧 No projectId for gemini-cli account, running setupUser to discover...')
            const setupResult = await geminiAccountService.setupUser(client, null, null, proxyConfig)
            if (setupResult && setupResult.projectId) {
              projectId = setupResult.projectId
              await geminiAccountService.updateTempProjectId(account.id, projectId)
              account.tempProjectId = projectId
              logger.info('✅ Discovered projectId via setupUser', { projectId })
            } else {
              logger.warn('⚠️ setupUser returned no projectId')
            }
          } catch (setupErr) {
            logger.error('❌ setupUser failed:', setupErr && setupErr.message)
          }
        }
        // ===== END PATCH =====
      }`;

function patchRoute() {
  let src = fs.readFileSync(ROUTE, 'utf8');
  const alreadyPatched = (src.match(/PATCH OmniForge: auto-discover/g) || []).length;
  // Idempotency: if any patch marker already exists, do nothing.
  // ROUTE_OLD is a substring prefix of ROUTE_NEW so naïve includes() check would false-positive.
  if (alreadyPatched > 0) {
    console.log(`  route: already patched (${alreadyPatched} markers) — skipping`);
    return false;
  }
  const occurrences = src.split(ROUTE_OLD).length - 1;
  if (occurrences === 0) throw new Error('route anchor not found');
  src = src.split(ROUTE_OLD).join(ROUTE_NEW);
  fs.writeFileSync(ROUTE, src);
  console.log(`  route: patched (${occurrences} blocks)`);
  return true;
}

// --- Patch 4: hardcoded Gemini model list (CRS fallback only had gemini-2.0-flash-exp) ---
// Upstream "list models" via cloudcode-pa doesn't enumerate the OAuth gemini-cli catalog,
// so CRS returns 1 model. n8n/LangChain reject any other modelName.
// Replace the function body with a static list of currently-available models.

const RELAY_FILE = '/app/src/services/relay/geminiRelayService.js';

const RELAY_OLD = `async function getAvailableModels(accessToken, proxy, projectId, location = 'us-central1') {
  let apiUrl
  if (projectId) {
    // 使用项目特定的 URL 格式
    apiUrl = \`\${GEMINI_API_BASE}/projects/\${projectId}/locations/\${location}/models\``;

const RELAY_NEW = `async function getAvailableModels(accessToken, proxy, projectId, location = 'us-central1') {
  // ===== PATCH OmniForge: hardcoded list (gemini-cli OAuth backend doesn't expose /models) =====
  const now = Date.now() / 1000
  return [
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash-thinking-exp'
  ].map((id) => ({ id, object: 'model', created: now, owned_by: 'google' }))
  // ===== END PATCH (original code below kept dead for revert safety) =====
  // eslint-disable-next-line no-unreachable
  let apiUrl
  if (projectId) {
    // 使用项目特定的 URL 格式
    apiUrl = \`\${GEMINI_API_BASE}/projects/\${projectId}/locations/\${location}/models\``;

function patchRelay() {
  let src = fs.readFileSync(RELAY_FILE, 'utf8');
  if (src.includes('PATCH OmniForge: hardcoded list')) {
    console.log('  relay: already patched');
    return false;
  }
  if (!src.includes(RELAY_OLD)) throw new Error('relay anchor not found');
  src = src.replace(RELAY_OLD, RELAY_NEW);
  fs.writeFileSync(RELAY_FILE, src);
  console.log('  relay: patched (hardcoded model list)');
  return true;
}

// --- Patch 5: also hardcode the v1/models default fallback in geminiHandlers.js
// (the `if (!account)` branch and the API-account fallback both default to a tiny list).
const HANDLERS_FILE = '/app/src/handlers/geminiHandlers.js';
const HANDLER_FALLBACK_OLD = `      return res.json({
        object: 'list',
        data: [
          {
            id: 'gemini-2.5-flash',
            object: 'model',
            created: Date.now() / 1000,
            owned_by: 'google'
          }
        ]
      })
    }`;
const HANDLER_FALLBACK_NEW = `      // ===== PATCH OmniForge: full default model list when no account selected =====
      const now = Date.now() / 1000
      return res.json({
        object: 'list',
        data: [
          'gemini-3.1-pro-preview','gemini-3-pro-preview','gemini-3-flash-preview',
          'gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite',
          'gemini-2.0-flash','gemini-2.0-flash-exp','gemini-2.0-flash-thinking-exp'
        ].map(id => ({ id, object: 'model', created: now, owned_by: 'google' }))
      })
      // ===== END PATCH =====
    }`;

function patchHandlersFallback() {
  let src = fs.readFileSync(HANDLERS_FILE, 'utf8');
  if (src.includes('PATCH OmniForge: full default model list')) {
    console.log('  handlers: already patched');
    return false;
  }
  if (!src.includes(HANDLER_FALLBACK_OLD)) {
    console.log('  handlers: fallback anchor NOT found (maybe already changed) — skipping');
    return false;
  }
  src = src.replace(HANDLER_FALLBACK_OLD, HANDLER_FALLBACK_NEW);
  fs.writeFileSync(HANDLERS_FILE, src);
  console.log('  handlers: patched (no-account fallback list)');
  return true;
}

// --- Patch 6: Claude model list (openaiClaudeRoutes.js had only opus-4 & sonnet-4) ---
const OPENAI_CLAUDE_FILE = '/app/src/routes/openaiClaudeRoutes.js';
const CLAUDE_OLD = `    // Claude 模型列表 - 只返回 opus-4 和 sonnet-4
    let models = [
      {
        id: 'claude-opus-4-20250514',
        object: 'model',
        created: 1736726400, // 2025-01-13
        owned_by: 'anthropic'
      },
      {
        id: 'claude-sonnet-4-20250514',
        object: 'model',
        created: 1736726400, // 2025-01-13
        owned_by: 'anthropic'
      }
    ]`;
const CLAUDE_NEW = `    // ===== PATCH OmniForge: full Claude 4.x catalog =====
    const _now = Math.floor(Date.now() / 1000)
    let models = [
      { id: 'claude-opus-4-7-20260427',    object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-opus-4-7',             object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-opus-4-6-20260307',    object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-opus-4-6',             object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-opus-4-5-20260114',    object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-opus-4-5',             object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-opus-4-20250514',      object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-sonnet-4-6-20260307',  object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-sonnet-4-6',           object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-sonnet-4-5-20260114',  object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-sonnet-4-5',           object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-sonnet-4-20250514',    object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-haiku-4-5-20251001',   object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-haiku-4-5',            object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-3-7-sonnet-20250219',  object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-3-5-sonnet-20241022',  object: 'model', created: _now, owned_by: 'anthropic' },
      { id: 'claude-3-5-haiku-20241022',   object: 'model', created: _now, owned_by: 'anthropic' }
    ]
    // ===== END PATCH =====`;

function patchClaudeModels() {
  let src = fs.readFileSync(OPENAI_CLAUDE_FILE, 'utf8');
  if (src.includes('PATCH OmniForge: full Claude 4.x catalog')) {
    console.log('  claude-openai: already patched');
    return false;
  }
  if (!src.includes(CLAUDE_OLD)) throw new Error('claude-openai anchor not found');
  src = src.replace(CLAUDE_OLD, CLAUDE_NEW);
  fs.writeFileSync(OPENAI_CLAUDE_FILE, src);
  console.log('  claude-openai: patched');
  return true;
}

// --- Patch 7: extend modelService default list (adds Claude 4.6/4.7 + missing Gemini models) ---
const MODEL_SERVICE_FILE = '/app/src/services/modelService.js';
const MS_OLD_CLAUDE = `      claude: {
        provider: 'anthropic',
        description: 'Claude models from Anthropic',
        models: [
          'claude-opus-4-5-20251101',
          'claude-haiku-4-5-20251001',
          'claude-sonnet-4-5-20250929',
          'claude-opus-4-1-20250805',
          'claude-sonnet-4-20250514',
          'claude-opus-4-20250514',
          'claude-3-7-sonnet-20250219',
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
          'claude-3-opus-20240229',
          'claude-3-haiku-20240307'
        ]
      },`;
const MS_NEW_CLAUDE = `      claude: {
        provider: 'anthropic',
        description: 'Claude models from Anthropic',
        // ===== PATCH OmniForge: extended with Claude 4.6 + 4.7 + aliases =====
        models: [
          'claude-opus-4-7-20260427',
          'claude-opus-4-7',
          'claude-opus-4-6-20260307',
          'claude-opus-4-6',
          'claude-opus-4-5-20251101',
          'claude-opus-4-5',
          'claude-opus-4-1-20250805',
          'claude-opus-4-20250514',
          'claude-sonnet-4-6-20260307',
          'claude-sonnet-4-6',
          'claude-sonnet-4-5-20250929',
          'claude-sonnet-4-5',
          'claude-sonnet-4-20250514',
          'claude-haiku-4-5-20251001',
          'claude-haiku-4-5',
          'claude-3-7-sonnet-20250219',
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
          'claude-3-opus-20240229',
          'claude-3-haiku-20240307'
        ]
        // ===== END PATCH =====
      },`;

const MS_OLD_GEMINI = `      gemini: {
        provider: 'google',
        description: 'Google Gemini models',
        models: [
          'gemini-2.5-pro',
          'gemini-3-pro-preview',
          'gemini-3.1-pro-preview',
          'gemini-2.5-flash'
        ]
      }`;
const MS_NEW_GEMINI = `      gemini: {
        provider: 'google',
        description: 'Google Gemini models',
        // ===== PATCH OmniForge: expanded gemini catalog =====
        models: [
          'gemini-3.1-pro-preview',
          'gemini-3-pro-preview',
          'gemini-3-flash-preview',
          'gemini-2.5-pro',
          'gemini-2.5-flash',
          'gemini-2.5-flash-lite',
          'gemini-2.0-flash',
          'gemini-2.0-flash-exp',
          'gemini-2.0-flash-thinking-exp'
        ]
        // ===== END PATCH =====
      }`;

function patchModelService() {
  let src = fs.readFileSync(MODEL_SERVICE_FILE, 'utf8');
  if (src.includes('PATCH OmniForge: extended with Claude 4.6')) {
    console.log('  modelService: already patched');
    return false;
  }
  let n = 0;
  if (src.includes(MS_OLD_CLAUDE)) { src = src.replace(MS_OLD_CLAUDE, MS_NEW_CLAUDE); n++; }
  else console.log('  modelService: Claude anchor NOT found');
  if (src.includes(MS_OLD_GEMINI)) { src = src.replace(MS_OLD_GEMINI, MS_NEW_GEMINI); n++; }
  else console.log('  modelService: Gemini anchor NOT found');
  if (n === 0) throw new Error('no modelService anchors matched');
  fs.writeFileSync(MODEL_SERVICE_FILE, src);
  console.log(`  modelService: patched (${n} blocks)`);
  return true;
}

// --- Patch 8: convert /gemini/v1beta/models response to Google-native format ---
// n8n's "Google Gemini(PaLM) Api" credential calls /v1beta/models via @google/generative-ai SDK
// which expects { models: [{ name: "models/X", supportedGenerationMethods: [...] }] },
// NOT the OpenAI format { object: 'list', data: [...] } that handleModels emits.

const HANDLERS_OLD_RES = `    res.json({
      object: 'list',
      data: models
    })
  } catch (error) {
    logger.error('Failed to get Gemini models:', error)`;

const HANDLERS_NEW_RES = `    // ===== PATCH OmniForge: emit Google-native shape on /v1beta/models & /v1/models (non-openai) =====
    const _orig = req.originalUrl || ''
    const _isNative = (_orig.startsWith('/gemini/v1beta/models') || _orig.startsWith('/gemini/v1/models')) && !_orig.includes('/openai/')
    if (_isNative) {
      return res.json({
        models: (models || []).map((m) => ({
          name: m.id && m.id.startsWith('models/') ? m.id : 'models/' + (m.id || m.name || 'unknown'),
          baseModelId: m.id || m.name || 'unknown',
          version: '001',
          displayName: m.id || m.name || 'Unknown',
          description: 'Gemini model: ' + (m.id || m.name || ''),
          inputTokenLimit: 1048576,
          outputTokenLimit: 8192,
          supportedGenerationMethods: ['generateContent', 'streamGenerateContent', 'countTokens'],
          temperature: 1.0,
          topP: 0.95,
          topK: 40
        }))
      })
    }
    // ===== END PATCH =====
    res.json({
      object: 'list',
      data: models
    })
  } catch (error) {
    logger.error('Failed to get Gemini models:', error)`;

function patchHandlersGoogleNative() {
  let src = fs.readFileSync(HANDLERS_FILE, 'utf8');
  if (src.includes('PATCH OmniForge: emit Google-native shape')) {
    console.log('  handlers-native: already patched');
    return false;
  }
  if (!src.includes(HANDLERS_OLD_RES)) throw new Error('handlers res.json anchor not found');
  src = src.replace(HANDLERS_OLD_RES, HANDLERS_NEW_RES);
  fs.writeFileSync(HANDLERS_FILE, src);
  console.log('  handlers-native: patched (Google-native /v1beta/models response)');
  return true;
}

// --- Patch 9: add GET /v1/models on the unified OpenAI router ---
// n8n's "OpenAI" credential test endpoint hits GET <baseUrl>/models. CRS unified.js
// only registers POST /v1/chat/completions and /v1/completions, so the credential test fails 404.
const UNIFIED_FILE = '/app/src/routes/unified.js';

const UNIFIED_INJECT_OLD = "router.post('/v1/chat/completions', authenticateApiKey, async (req, res) => {";
const UNIFIED_INJECT_NEW = `// ===== PATCH OmniForge: GET /v1/models (and /models) so credential discovery works =====
const _modelService = require('../services/modelService')
function _omniforgeModelsHandler(req, res) {
  try {
    const all = _modelService.getAllModels()
    const openaiOnly = all.filter((m) => m.owned_by === 'openai')
    let data = openaiOnly.length > 0 ? openaiOnly : all
    if (req.apiKey && req.apiKey.enableModelRestriction && req.apiKey.restrictedModels && req.apiKey.restrictedModels.length > 0) {
      data = data.filter((m) => !req.apiKey.restrictedModels.includes(m.id))
    }
    res.json({ object: 'list', data })
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to list models', type: 'server_error' } })
  }
}
router.get('/v1/models', authenticateApiKey, _omniforgeModelsHandler)
router.get('/models', authenticateApiKey, _omniforgeModelsHandler)
// ===== END PATCH =====

router.post('/v1/chat/completions', authenticateApiKey, async (req, res) => {`;

function patchUnifiedModels() {
  let src = fs.readFileSync(UNIFIED_FILE, 'utf8');
  if (src.includes('PATCH OmniForge: GET /v1/models')) {
    console.log('  unified-models: already patched');
    return false;
  }
  if (!src.includes(UNIFIED_INJECT_OLD)) throw new Error('unified anchor not found');
  src = src.replace(UNIFIED_INJECT_OLD, UNIFIED_INJECT_NEW);
  fs.writeFileSync(UNIFIED_FILE, src);
  console.log('  unified-models: patched');
  return true;
}

// --- Patch 3: clientMetadata mimic official gemini-cli (fixes aggressive throttling) ---
// CRS sends ideType/PLATFORM_UNSPECIFIED + missing ideVersion/updateChannel.
// Google classifies as low-tier "unknown client" and applies hard rate limits.
// Mimic the official gemini-cli payload exactly.

const META_OLD_LOADCA = `  // 创建ClientMetadata
  const clientMetadata = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI'
  }`;

const META_NEW_LOADCA = `  // ===== PATCH OmniForge: clientMetadata mimics official gemini-cli =====
  const clientMetadata = {
    ideName: 'IDE_UNSPECIFIED',
    pluginType: 'GEMINI',
    ideVersion: '0.5.3',
    platform: 'LINUX_AMD64',
    updateChannel: 'stable'
  }
  // ===== END PATCH =====`;

const META_OLD_SETUP = `  // 默认的ClientMetadata
  if (!clientMetadata) {
    clientMetadata = {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
      duetProject: projectId
    }
    logger.info('🔧 使用默认 ClientMetadata')
  }`;

const META_NEW_SETUP = `  // ===== PATCH OmniForge: default clientMetadata mimics official gemini-cli =====
  if (!clientMetadata) {
    clientMetadata = {
      ideName: 'IDE_UNSPECIFIED',
      pluginType: 'GEMINI',
      ideVersion: '0.5.3',
      platform: 'LINUX_AMD64',
      updateChannel: 'stable',
      duetProject: projectId
    }
    logger.info('🔧 使用 PATCH OmniForge ClientMetadata (mimics official gemini-cli)')
  }
  // ===== END PATCH =====`;

function patchClientMetadata() {
  let src = fs.readFileSync(SERVICE, 'utf8');
  if (src.includes('PATCH OmniForge: clientMetadata mimics')) {
    console.log('  metadata: already patched');
    return false;
  }
  let changes = 0;
  if (src.includes(META_OLD_LOADCA)) {
    src = src.replace(META_OLD_LOADCA, META_NEW_LOADCA);
    changes++;
  } else {
    console.log('  metadata: loadCodeAssist anchor NOT found');
  }
  if (src.includes(META_OLD_SETUP)) {
    src = src.replace(META_OLD_SETUP, META_NEW_SETUP);
    changes++;
  } else {
    console.log('  metadata: setupUser anchor NOT found');
  }
  if (changes === 0) throw new Error('no metadata anchors matched');
  fs.writeFileSync(SERVICE, src);
  console.log(`  metadata: patched (${changes} blocks)`);
  return true;
}

console.log('Patching geminiAccountService.js...');
patchService();
console.log('Patching openaiGeminiRoutes.js...');
patchRoute();
console.log('Patching clientMetadata...');
patchClientMetadata();
console.log('Patching geminiRelayService model list...');
patchRelay();
console.log('Patching handlers fallback model list...');
patchHandlersFallback();
console.log('Patching OpenAI-Claude model list...');
patchClaudeModels();
console.log('Patching modelService catalog...');
patchModelService();
console.log('Patching handlers /v1beta/models native shape...');
patchHandlersGoogleNative();
console.log('Patching unified router /v1/models for OpenAI credential discovery...');
patchUnifiedModels();
console.log('Done.');
