/**
 * AIProviders.gs — Shared AI provider module
 *
 * Waterfall: Gemini (multi-key) → FreeLLMAPI → throws
 *
 * Deployed to both LabelReminder and FollowUpReminder projects.
 * Relies on each project's CONFIG for {FREE_LLM_API_URL, FREE_LLM_MODEL, GEMINI_MODEL}.
 * API keys are read from Script Properties (not CONFIG).
 *
 * Required Script Properties:
 *   GEMINI_API_KEY    — comma-separated Gemini API keys
 *   FREE_LLM_API_KEY  — FreeLLMAPI key
 */

// ════════════════════════════════════════════════════════════════════════════
// KEY RESOLUTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parse comma-separated GEMINI_API_KEY from Script Properties.
 * "key1,key2,key3" → ["key1", "key2", "key3"]
 */
function getGeminiApiKeys() {
  const raw = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!raw) return [];
  return raw.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

/**
 * Read FREE_LLM_API_KEY from Script Properties.
 * Returns the key string, or throws if not set.
 */
function getFreeLLMApiKey() {
  const raw = PropertiesService.getScriptProperties().getProperty('FREE_LLM_API_KEY');
  if (!raw) throw new Error('FREE_LLM_API_KEY not configured in Script Properties');
  return raw.trim();
}

// ════════════════════════════════════════════════════════════════════════════
// GEMINI (multi-key fallback)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Call Gemini with multi-key fallback.
 * @param {string} prompt
 * @param {{ maxTokens?: number }} [opts]
 * @returns {string} Generated text
 */
function callGemini(prompt, opts) {
  opts = opts || {};
  const keys = getGeminiApiKeys();
  if (keys.length === 0) throw new Error('No GEMINI_API_KEY configured');

  const model = CONFIG.GEMINI_MODEL;
  const maxTokens = opts.maxTokens || 800;

  for (const apiKey of keys) {
    try {
      const response = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'post',
          headers: { 'Content-Type': 'application/json' },
          payload: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
          }),
          muteHttpExceptions: true,
        }
      );

      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code !== 200) {
        throw new Error(`Gemini HTTP ${code}: ${body}`);
      }

      const result = JSON.parse(body).candidates[0].content.parts[0].text.trim();
      return result;
    } catch (err) {
      log(`[WARN] Gemini key failed (${err.message}), trying next...`);
    }
  }
  throw new Error(`All ${keys.length} Gemini keys failed`);
}

// ════════════════════════════════════════════════════════════════════════════
// FREE LLM API (OpenAI-compatible, self-hosted)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Call FreeLLMAPI (OpenAI-compatible).
 * @param {string} prompt
 * @param {{ maxTokens?: number }} [opts]
 * @returns {string} Generated text
 */
function callFreeLLM(prompt, opts) {
  opts = opts || {};
  const url = CONFIG.FREE_LLM_API_URL;
  const apiKey = getFreeLLMApiKey();
  const model = CONFIG.FREE_LLM_MODEL;
  const maxTokens = opts.maxTokens || 800;

  if (!url) throw new Error('FreeLLMAPI URL not configured');

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    payload: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code !== 200) {
    throw new Error('FreeLLMAPI HTTP ' + code + ': ' + body);
  }

  const parsed = JSON.parse(body);
  const text = parsed.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('FreeLLMAPI: empty response');
  return text;
}

// ════════════════════════════════════════════════════════════════════════════
// WATERFALL — Gemini first, then FreeLLMAPI
// ════════════════════════════════════════════════════════════════════════════

/**
 * Waterfall: try Gemini first, then FreeLLMAPI.
 * @param {string} prompt
 * @param {{ maxTokens?: number }} [opts]
 * @returns {string} Generated text
 */
function callAI(prompt, opts) {
  opts = opts || {};

  // 1. Try Gemini (multi-key)
  try {
    const text = callGemini(prompt, opts);
    log('[AI] Gemini success');
    return text;
  } catch (err) {
    log('[WARN] Gemini failed: ' + err.message + ', falling back to FreeLLMAPI');
  }

  // 2. Try FreeLLMAPI
  try {
    const text = callFreeLLM(prompt, opts);
    log('[AI] FreeLLMAPI success');
    return text;
  } catch (err) {
    log('[WARN] FreeLLMAPI failed: ' + err.message);
  }

  // 3. All failed
  throw new Error('All AI providers failed');
}
