#!/usr/bin/env python3
"""
Patch CRS Wei-Shaw 1.1.303 — fix Gemini OAuth (issue #995 + projectId discovery).

Two changes:
1. Add ensureValidToken(accountId) to geminiAccountService.js
2. In openaiGeminiRoutes.js, fall back projectId to tempProjectId, or run setupUser
   to discover if both are empty (writes back to tempProjectId for cache).
"""
import re
import shutil
import sys
from pathlib import Path

SERVICE = Path('/app/src/services/account/geminiAccountService.js')
ROUTE = Path('/app/src/routes/openaiGeminiRoutes.js')

# --- Patch 1: ensureValidToken ---
ENSURE_VALID_TOKEN = '''
// ===== PATCH OmniForge: ensureValidToken (fixes upstream issue #995) =====
async function ensureValidToken(accountId) {
  try {
    let account = await getAccount(accountId)
    if (!account) {
      return { success: false, error: 'Account not found' }
    }
    if (isTokenExpired(account)) {
      logger.info(`🔄 Token expired for Gemini account ${accountId}, refreshing...`)
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
    logger.error(`ensureValidToken error for ${accountId}:`, err && err.message)
    return { success: false, error: err && err.message ? err.message : String(err) }
  }
}
// ===== END PATCH =====

'''

def patch_service():
    src = SERVICE.read_text()
    if 'ensureValidToken' in src:
        print('  service: already patched, skipping')
        return False
    # Insert function before module.exports = {
    needle = 'module.exports = {'
    if needle not in src:
        raise SystemExit('  service: module.exports not found')
    new = src.replace(needle, ENSURE_VALID_TOKEN + needle, 1)
    # Add ensureValidToken to exports list (after isTokenExpired,)
    new = new.replace('  isTokenExpired,\n', '  isTokenExpired,\n  ensureValidToken,\n', 1)
    if new == src:
        raise SystemExit('  service: nothing replaced')
    SERVICE.write_text(new)
    print('  service: patched ✅')
    return True

# --- Patch 2: projectId fallback in openaiGeminiRoutes.js ---
ROUTE_OLD = """      const oauthProvider = account.oauthProvider || 'gemini-cli'
      let { projectId } = account

      if (oauthProvider === 'antigravity') {
        projectId = ensureAntigravityProjectId(account)
        if (!account.projectId && account.tempProjectId !== projectId) {
          await geminiAccountService.updateTempProjectId(account.id, projectId)
          account.tempProjectId = projectId
        }
      }"""

ROUTE_NEW = """      const oauthProvider = account.oauthProvider || 'gemini-cli'
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
      }"""

def patch_route():
    src = ROUTE.read_text()
    if 'PATCH OmniForge' in src:
        print('  route: already patched, skipping')
        return False
    if ROUTE_OLD not in src:
        raise SystemExit('  route: anchor not found')
    new = src.replace(ROUTE_OLD, ROUTE_NEW, 1)
    ROUTE.write_text(new)
    print('  route: patched ✅')
    return True

if __name__ == '__main__':
    print('Patching geminiAccountService.js...')
    patch_service()
    print('Patching openaiGeminiRoutes.js...')
    patch_route()
    print('Done.')
