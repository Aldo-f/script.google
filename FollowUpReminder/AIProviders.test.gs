// AI Providers Test Suite
// Run these in Apps Script editor to verify the waterfall logic

const TEST_CONFIG = {
  FREE_LLM_API_URL: 'https://freellm.aldof.duckdns.org/v1/chat/completions',
  FREE_LLM_API_KEY: 'freellmapi-6887a86f4be99b516b912283dde20d7eb4ead65e3d0ae312',
  FREE_LLM_MODEL: 'auto',
  GEMINI_MODEL: 'gemini-2.0-flash',
};

/**
 * Test getGeminiApiKeys() parsing
 */
function testGetGeminiApiKeys() {
  // Mock PropertiesService
  const originalGet = PropertiesService.getScriptProperties;
  PropertiesService.getScriptProperties = function() {
    return {
      getProperty: function(key) {
        if (key === 'GEMINI_API_KEY') return 'key1, key2 ,key3,';
        return null;
      },
    };
  };

  // Reload the function (in real test, you'd import it)
  const keys = getGeminiApiKeys();
  console.assert(keys.length === 3, 'Should parse 3 keys');
  console.assert(keys[0] === 'key1', 'Key 1');
  console.assert(keys[1] === 'key2', 'Key 2');
  console.assert(keys[2] === 'key3', 'Key 3');

  PropertiesService.getScriptProperties = originalGet;
  log('✅ testGetGeminiApiKeys passed');
}

/**
 * Test FreeLLMAPI call (requires network)
 */
function testCallFreeLLM() {
  const prompt = 'Say "test ok" in exactly 3 words.';
  try {
    const result = callFreeLLM(prompt);
    log(`FreeLLMAPI result: ${result}`);
    console.assert(result.length > 0, 'Should return non-empty');
    log('✅ testCallFreeLLM passed');
  } catch (err) {
    log(`❌ testCallFreeLLM failed: ${err.message}`);
  }
}

/**
 * Test Gemini call (requires network + GEMINI_API_KEY in Script Properties)
 */
function testCallGemini() {
  const prompt = 'Say "test ok" in exactly 3 words.';
  try {
    const result = callGemini(prompt);
    log(`Gemini result: ${result}`);
    console.assert(result.length > 0, 'Should return non-empty');
    log('✅ testCallGemini passed');
  } catch (err) {
    log(`❌ testCallGemini failed: ${err.message}`);
  }
}

/**
 * Test waterfall: FreeLLMAPI → Gemini
 */
function testCallAIWaterfall() {
  const prompt = 'Say "waterfall ok" in exactly 3 words.';
  try {
    const result = callAI(prompt);
    log(`Waterfall result: ${result}`);
    console.assert(result.length > 0, 'Should return non-empty');
    log('✅ testCallAIWaterfall passed');
  } catch (err) {
    log(`❌ testCallAIWaterfall failed: ${err.message}`);
  }
}

/**
 * Test generateReminderText (LabelReminder)
 */
function testGenerateReminderText() {
  const subject = 'Test dossier ref ABC-1234';
  const snippet = 'Dit is een test melding over een gat in de weg.';
  const senderName = 'Jan Jansen';
  const lang = 'nl';

  try {
    const result = generateReminderText(subject, snippet, senderName, lang);
    log(`generateReminderText (NL): ${result.substring(0, 100)}...`);
    console.assert(result.includes('vriendelijke groeten'), 'Should have closing');
    console.assert(result.toLowerCase().includes('nederlands') || result.toLowerCase().includes('beste'), 'Should be Dutch');
    log('✅ testGenerateReminderText (NL) passed');
  } catch (err) {
    log(`❌ testGenerateReminderText (NL) failed: ${err.message}`);
  }

  // English test
  const subjectEn = 'Test case ref XYZ-5678';
  const snippetEn = 'This is a test report about a pothole.';
  const senderNameEn = 'John Doe';
  const langEn = 'en';

  try {
    const result = generateReminderText(subjectEn, snippetEn, senderNameEn, langEn);
    log(`generateReminderText (EN): ${result.substring(0, 100)}...`);
    console.assert(result.includes('Kind regards'), 'Should have English closing');
    log('✅ testGenerateReminderText (EN) passed');
  } catch (err) {
    log(`❌ testGenerateReminderText (EN) failed: ${err.message}`);
  }
}

/**
 * Test rewriteProse (FollowUpReminder) — strict prompt, no chain-of-thought
 */
function testRewriteProse() {
  const prose = `Geachte,

Hierbij een overzicht van de meldingen die ik via AWV aan uw dienst doorzond en waarop ik tot op heden nog geen reactie of statusupdate ontving:`;

  try {
    const result = rewriteProse(prose);
    log(`rewriteProse result: ${result.substring(0, 200)}...`);
    console.assert(result.length > 0, 'Should return non-empty');
    console.assert(!result.includes('```'), 'Should strip markdown fences');
    console.assert(result.length <= prose.length * 3, 'Should not exceed 3x input length');
    log('✅ testRewriteProse passed');
  } catch (err) {
    log(`❌ testRewriteProse failed: ${err.message}`);
  }
}

/**
 * Run all tests
 */
function runAllAITests() {
  log('=== AI Provider Tests ===');
  testGetGeminiApiKeys();
  testCallFreeLLM();
  testCallGemini();
  testCallAIWaterfall();
  testGenerateReminderText();
  testRewriteProse();
  log('=== Tests Complete ===');
}