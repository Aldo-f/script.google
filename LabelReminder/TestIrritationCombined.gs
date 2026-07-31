/**
 * Test script to generate 24 examples of increasing irritation
 * Based on reminder count AND days since first message
 * Run: clasp run testIrritationCombined
 */
function testIrritationCombined() {
  const subject = "FW: (KM-2026-09338) - Gevaarlijke paal Bergbosstraat";
  const snippet = `Inkomend bericht van 04/04/2026 door Burger
Toegekend dossiernummer: KM-2026-09338

Bericht: Beste, Ik maak melding van een gevaarlijke situatie op het aangegeven pad. Vaststelling: Langs het onverharde pad staat een groene paal waarvan het verkeersbord is verdwenen. De metalen bevestigingsbeugels zitten echter nog op de paal en steken scherp naar buiten op borst-/heuphoogte. Veiligheidsargumentatie: Deze uitstekende metalen delen vormen een direct fysiek gevaar voor wandelaars, lopers en spelende kinderen, zeker omdat het pad smal is en de paal vlak naast de omheining staat. In het donker of bij onoplettendheid kan men hier ernstige snijwonden of kledingschade door oplopen. Daarnaast ontbreekt hierdoor de noodzakelijke signalisatie voor dit pad. Verzoek: Ik verzoek de technische dienst om deze scherpe restanten zo snel mogelijk te verwijderen en, indien nodig, een nieuw bord te plaatsen.`;
  
  const recipient = { name: 'AWV-klantendienst', email: 'klantendienst-awv@wegenenverkeer.be' };
  
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║  IRRITATION LADDER - COMBINED (Reminders + Time)            ║');
  log('║  Tone based on: # reminders sent AND days since first msg   ║');
  log('╚══════════════════════════════════════════════════════════════╝');
  log('');
  
  // Generate 24 examples with different combinations
  const scenarios = [
    // Level 1: Friendly (0 reminders, <30 days)
    { reminders: 0, daysSinceFirst: 2, desc: 'First reminder, just sent' },
    { reminders: 0, daysSinceFirst: 7, desc: 'First reminder, 1 week ago' },
    { reminders: 0, daysSinceFirst: 14, desc: 'First reminder, 2 weeks ago' },
    { reminders: 0, daysSinceFirst: 21, desc: 'First reminder, 3 weeks ago' },
    
    // Level 2: Firm (1-2 reminders, OR 30+ days)
    { reminders: 1, daysSinceFirst: 8, desc: '2nd reminder, 1 week after first' },
    { reminders: 1, daysSinceFirst: 30, desc: '2nd reminder, 1 month after first' },
    { reminders: 1, daysSinceFirst: 45, desc: '2nd reminder, 6 weeks after first' },
    { reminders: 2, daysSinceFirst: 14, desc: '3rd reminder, 2 weeks after first' },
    { reminders: 2, daysSinceFirst: 35, desc: '3rd reminder, 5 weeks after first' },
    { reminders: 0, daysSinceFirst: 35, desc: 'First reminder, but 5 weeks passed' },
    { reminders: 0, daysSinceFirst: 50, desc: 'First reminder, but 7 weeks passed' },
    { reminders: 1, daysSinceFirst: 60, desc: '2nd reminder, 8 weeks after first' },
    
    // Level 3: Urgent (3+ reminders, OR 60+ days)
    { reminders: 3, daysSinceFirst: 21, desc: '4th reminder, 3 weeks after first' },
    { reminders: 3, daysSinceFirst: 45, desc: '4th reminder, 6 weeks after first' },
    { reminders: 4, daysSinceFirst: 30, desc: '5th reminder, 1 month after first' },
    { reminders: 5, daysSinceFirst: 60, desc: '6th reminder, 2 months after first' },
    { reminders: 6, daysSinceFirst: 75, desc: '7th reminder, 10 weeks after first' },
    { reminders: 7, daysSinceFirst: 90, desc: '8th reminder, 3 months after first' },
    { reminders: 10, daysSinceFirst: 120, desc: '11th reminder, 4 months after first' },
    { reminders: 15, daysSinceFirst: 150, desc: '16th reminder, 5 months after first' },
    { reminders: 20, daysSinceFirst: 180, desc: '21st reminder, 6 months after first' },
    { reminders: 25, daysSinceFirst: 200, desc: '26th reminder, 7 months after first' },
    { reminders: 30, daysSinceFirst: 250, desc: '31st reminder, 8 months after first' },
    { reminders: 50, daysSinceFirst: 365, desc: '51st reminder, 1 year after first' },
  ];
  
  scenarios.forEach((scenario, index) => {
    const firstMessageDate = new Date();
    firstMessageDate.setDate(firstMessageDate.getDate() - scenario.daysSinceFirst);
    
    const tone = getToneFromContext(scenario.reminders, firstMessageDate);
    
    log(`\n${'═'.repeat(70)}`);
    log(`EXAMPLE ${index + 1}/24 - ${scenario.desc}`);
    log(`${'═'.repeat(70)}`);
    log(`[REMINDERS SENT]: ${scenario.reminders}`);
    log(`[DAYS SINCE FIRST]: ${scenario.daysSinceFirst}`);
    log(`[TONE]: ${tone}`);
    log('');
    log('[AI RESPONSE]:');
    log(generateExampleEmail(scenario.reminders, scenario.daysSinceFirst));
  });
  
  log('\n\n' + '═'.repeat(70));
  log('END OF TEST');
  log('═'.repeat(70));
}

function getToneFromContext(reminderCount, firstMessageDate) {
  const now = new Date();
  const daysSinceFirst = (now - firstMessageDate) / 86400000;

  if (reminderCount >= 3 || daysSinceFirst > 60) {
    return '🔴 ZEER DRINGEND - Bezorgd over veiligheid';
  } else if (reminderCount >= 1 || daysSinceFirst > 30) {
    return '🟡 VASTBERADEN - Wijzend op risico';
  }
  return '🟢 VRIENDELIJK - Professioneel en beleefd';
}

function generateExampleEmail(reminderCount, daysSinceFirst) {
  // Generate tone-appropriate email based on context
  const isUrgent = reminderCount >= 3 || daysSinceFirst > 60;
  const isFirm = reminderCount >= 1 || daysSinceFirst > 30;
  
  if (isUrgent) {
    if (reminderCount >= 10 || daysSinceFirst > 120) {
      return `Geachte klantendienst,

Na ${reminderCount} herinneringen en ${daysSinceFirst} dagen wachten op respons betreffende dossier KM-2026-09338, kan ik mijn bezorgdheid niet langer opzij schuiven. De gevaarlijke situatie in de Bergbosstraat blijft onopgelost en vormt een ernstig risico voor wandelaars.

Ik verzoek u met grote dringendheid om onmiddellijke interventie en spoedige oplossing van dit veiligheidsrisico.

Met vriendelijke groet,
Aldo Fieuw`;
    }
    return `Beste medewerker,

Mijn ${ordinal(reminderCount + 1)}e bericht over dossier KM-2026-09338. Na ${daysSinceFirst} dagen zonder adequate reactie op de gevaarlijke situatie, maak ik mij ernstige zorgen over de veiligheid van voorbijgangers.

Ik verzoek u dringend om prioritaire actie en spoedige verwijdering van de gevaarlijke restanten.

Met vriendelijke groeten,
Aldo Fieuw`;
  }
  
  if (isFirm) {
    return `Geachte heer/mevrouw,

Het is nu ${daysSinceFirst} dagen geleden dat ik melding maakte van de gevaarlijke situatie in de Bergbosstraat (dossier KM-2026-09338). Na mijn ${ordinal(reminderCount + 1)}e herinnering wil ik graag weten of er al voortgang is.

Gezien het veiligheidsrisico verzoek ik u vriendelijk maar vastberaden om spoedige opvolging.

Met vriendelijke groet,
Aldo Fieuw`;
  }
  
  return `Beste klantendienst,

Graag had ik een korte opvolging gevraagd voor dossier KM-2026-09338. Het gaat om de gevaarlijke situatie langs het onverharde pad in de Bergbosstraat.

Zou u mij kunnen laten weten of er al enige voortgang is in de behandeling?

Alvast bedankt voor uw tijd.

Met vriendelijke groeten,
Aldo Fieuw`;
}

function ordinal(n) {
  const s = ["e", "e", "e", "de"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function log(msg) {
  Logger.log(msg);
}
