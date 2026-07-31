/**
 * Test script to generate 24 examples of increasing irritation
 * Based on reminder count (not days)
 * Run: clasp run testIrritationByCount
 */
function testIrritationByCount() {
  const subject = "FW: (KM-2026-09338) - Gevaarlijke paal Bergbosstraat";
  const snippet = `Inkomend bericht van 04/04/2026 door Burger
Toegekend dossiernummer: KM-2026-09338

Bericht: Beste, Ik maak melding van een gevaarlijke situatie op het aangegeven pad. Vaststelling: Langs het onverharde pad staat een groene paal waarvan het verkeersbord is verdwenen. De metalen bevestigingsbeugels zitten echter nog op de paal en steken scherp naar buiten op borst-/heuphoogte. Veiligheidsargumentatie: Deze uitstekende metalen delen vormen een direct fysiek gevaar voor wandelaars, lopers en spelende kinderen, zeker omdat het pad smal is en de paal vlak naast de omheining staat. In het donker of bij onoplettendheid kan men hier ernstige snijwonden of kledingschade door oplopen. Daarnaast ontbreekt hierdoor de noodzakelijke signalisatie voor dit pad. Verzoek: Ik verzoek de technische dienst om deze scherpe restanten zo snel mogelijk te verwijderen en, indien nodig, een nieuw bord te plaatsen.`;
  
  const recipient = { name: 'AWV-klantendienst', email: 'klantendienst-awv@wegenenverkeer.be' };
  
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║  IRRITATION LADDER BY REMINDER COUNT - 24 EXAMPLES          ║');
  log('║  (Based on how many times already reminded, not days)        ║');
  log('╚══════════════════════════════════════════════════════════════╝');
  log('');
  
  // Generate examples for different reminder counts
  const counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25, 30, 40, 50, 75, 100, 150];
  
  counts.forEach((count, index) => {
    log(`\n${'═'.repeat(70)}`);
    log(`EXAMPLE ${index + 1}/24 - Reminder #${count} for this thread`);
    log(`${'═'.repeat(70)}`);
    
    const tone = getToneFromReminderCount(count);
    log(`[TONE]: ${tone}`);
    log('');
    log('[SIMULATED AI RESPONSE]:');
    log(generateExampleEmail(count));
  });
  
  log('\n\n' + '═'.repeat(70));
  log('END OF TEST');
  log('═'.repeat(70));
}

function getToneFromReminderCount(reminderCount) {
  if (reminderCount >= 3) return '🔴 ZEER DRINGEND - Bezorgd over veiligheid';
  if (reminderCount >= 1) return '🟡 VASTBERADEN - Wijzend op risico';
  return '🟢 VRIENDELIJK - Professioneel en beleefd';
}

function generateExampleEmail(reminderCount) {
  const examples = {
    // Level 1: Friendly (0 reminders sent)
    0: `Beste medewerker van de klantendienst,

Ik stuur u deze e-mail in verband met mijn eerdere melding over een gevaarlijke situatie in de Bergbosstraat te Merelbeke (dossiernummer: KM-2026-09338).

Graag zou ik weten of u al de gelegenheid heeft gehad om deze kwestie te bekijken.

Alvast bedankt voor uw tijd en moeite.

Met vriendelijke groeten,
Aldo Fieuw`,

    1: `Geachte heer/mevrouw,

Ik keer terug bij u betreffende dossier KM-2026-09338. Het gaat om de gevaarlijke situatie langs het onverharde pad in de Bergbosstraat.

Graag verneem ik of er al enige voortgang is in de behandeling van deze zaak.

Met vriendelijke groet,
Aldo Fieuw`,

    2: `Beste medewerkers,

Na mijn eerder bericht over de gevaarlijke paal (KM-2026-09338), wil ik opnieuw navragen of er al actie is ondernomen.

De metalen beugels vormen nog steeds een risico voor wandelaars en kinderen.

Ik verneem graag een update.

Met vriendelijke groeten,
Aldo Fieuw`,

    // Level 2: Firm (1+ reminders sent)
    3: `Geachte klantendienst,

Het is nu mijn tweede herinnering betreffende dossier KM-2026-09338. De gevaarlijke metalen beugels aan de paal in de Bergbosstraat vormen nog steeds een direct veiligheidsrisico voor voorbijgangers.

Ik verzoek u vriendelijk maar dringend om spoedige opvolging en een update over de planning voor de verwijdering.

Met vriendelijke groet,
Aldo Fieuw`,

    4: `Beste heer/mevrouw,

Mijn derde bericht over de gevaarlijke situatie (KM-2026-09338) blijft onbeantwoord. De scherpe metalen restanten steken nog steeds scherp naar buiten op borsthoogte.

Gezien het veiligheidsrisico voor wandelaars en spelende kinderen, verzoek ik u dringend om prioritaire behandeling.

Met vriendelijke groeten,
Aldo Fieuw`,

    5: `Geachte medewerkers,

Na drie eerdere herinneringen over dossier KM-2026-09338, ben ik nog steeds niet op de hoogte van de voortgang. De gevaarlijke situatie in de Bergbosstraat blijft bestaan.

Ik verzoek u met klem om spoedige actie en een update over de geplande maatregelen.

Met vriendelijke groet,
Aldo Fieuw`,

    // Level 3: Urgent (3+ reminders sent)
    6: `Beste klantendienst,

Mijn vierde bericht betreffende de gevaarlijke paal (KM-2026-09338). Ik maak mij ernstige zorgen over de veiligheid van wandelaars, lopers en spelende kinderen die nog steeds blootstaan aan dit risico.

Ik verzoek u dringend om onmiddellijke interventie en spoedige verwijdering van de gevaarlijke restanten.

Met vriendelijke groeten,
Aldo Fieuw`,

    7: `Geachte heer/mevrouw,

Na vier herinneringen zonder reactie op dossier KM-2026-09338, kan ik mijn bezorgdheid niet langer opzij schuiven. De gevaarlijke situatie blijft onaanvaardbaar.

Ik verzoek u met grote dringendheid om prioritaire actie en spoedige oplossing.

Met vriendelijke groet,
Aldo Fieuw`,

    8: `Beste medewerkers,

Mijn vijfde bericht over de gevaarlijke situatie in de Bergbosstraat blijft onbeantwoord. Dossier KM-2026-09338 betreft een direct fysiek gevaar voor het publiek.

Ik verzoek u dringend om onmiddellijke actie en een spoedverslag over de geplande maatregelen.

Met vriendelijke groeten,
Aldo Fieuw`,

    9: `Geachte klantendienst,

Na vijf herinneringen betreffende de gevaarlijke paal (KM-2026-09338), ben ik genoodzaakt deze zaak opnieuw aan te kaarten. De situatie is onveranderd en vormt een ernstig risico.

Ik verzoek u met klem om spoedige interventie en prioritaire behandeling.

Met vriendelijke groet,
Aldo Fieuw`,

    10: `Beste heer/mevrouw,

Mijn zesde bericht over dossier KM-2026-09338. De gevaarlijke metalen beugels blijven bestaan en vormen een direct gevaar voor wandelaars en kinderen.

Ik verzoek u dringend om onmiddellijke actie en spoedige opvolging van deze zaak.

Met vriendelijke groeten,
Aldo Fieuw`,

    11: `Geachte medewerkers,

Na zes herinneringen zonder reactie over de gevaarlijke paal in de Bergbosstraat, blijf ik mijn bezorgdheid uiten. Dossier KM-2026-09338 blijft onopgelost.

Ik verzoek u met grote dringendheid om prioritaire behandeling en spoedige verwijdering van het veiligheidsrisico.

Met vriendelijke groet,
Aldo Fieuw`,

    12: `Beste klantendienst,

Mijn zevende bericht betreffende dossier KM-2026-09338. De gevaarlijke situatie is nog steeds niet opgelost en vormt een ernstig risico voor het publiek.

Ik verzoek u dringend om spoedige interventie en een update over de planning.

Met vriendelijke groeten,
Aldo Fieuw`,

    13: `Geachte heer/mevrouw,

Na zeven herinneringen over de gevaarlijke paal (KM-2026-09338), zie ik mij genoodzaakt deze zaak opnieuw aan te kaarten. De situatie blijft onaanvaardbaar.

Ik verzoek u met klem om onmiddellijke actie en prioritaire behandeling.

Met vriendelijke groet,
Aldo Fieuw`,

    14: `Beste medewerkers,

Mijn achtste bericht over dossier KM-2026-09338. De gevaarlijke metalen restanten vormen nog steeds een direct fysiek gevaar voor wandelaars.

Ik verzoek u dringend om spoedige oplossing van dit veiligheidsrisico.

Met vriendelijke groeten,
Aldo Fieuw`,

    15: `Geachte klantendienst,

Na acht herinneringen zonder reactie over de gevaarlijke situatie in de Bergbosstraat, blijf ik mijn bezorgdheid uiten. Dossier KM-2026-09338 is nog steeds onopgelost.

Ik verzoek u met grote dringendheid om prioritaire actie en spoedige interventie.

Met vriendelijke groet,
Aldo Fieuw`,

    20: `Beste heer/mevrouw,

Mijn dertiende bericht over de gevaarlijke paal (KM-2026-09338). De situatie blijft onveranderd en vormt een ernstig risico voor het publiek.

Ik verzoek u dringend om onmiddellijke actie en spoedige opvolging.

Met vriendelijke groeten,
Aldo Fieuw`,

    25: `Geachte medewerkers,

Na twaalf herinneringen over dossier KM-2026-09338, kan ik mijn bezorgdheid niet langer opzij schuiven. De gevaarlijke metalen beugels vormen nog steeds een direct risico.

Ik verzoek u met klem om prioritaire behandeling en spoedige verwijdering.

Met vriendelijke groet,
Aldo Fieuw`,

    30: `Beste klantendienst,

Mijn vijftiende bericht betreffende de gevaarlijke situatie in de Bergbosstraat. Dossier KM-2026-09338 blijft onopgelost na meerdere herinneringen.

Ik verzoek u dringend om spoedige interventie en een update over de geplande maatregelen.

Met vriendelijke groeten,
Aldo Fieuw`,

    40: `Geachte heer/mevrouw,

Na achttien herinneringen over de gevaarlijke paal (KM-2026-09338), ben ik genoodzaakt deze zaak opnieuw aan te kaarten. De situatie is onaanvaardbaar.

Ik verzoek u met grote dringendheid om onmiddellijke actie en prioritaire behandeling.

Met vriendelijke groet,
Aldo Fieuw`,

    50: `Beste medewerkers,

Mijn twintigste bericht over dossier KM-2026-09338. De gevaarlijke metalen restanten vormen nog steeds een direct fysiek gevaar voor wandelaars en kinderen.

Ik verzoek u dringend om spoedige oplossing van dit veiligheidsrisico.

Met vriendelijke groeten,
Aldo Fieuw`,

    75: `Geachte klantendienst,

Na veertig herinneringen over de gevaarlijke situatie in de Bergbosstraat, blijf ik mijn bezorgdheid uiten. Dossier KM-2026-09338 is nog steeds onopgelost.

Ik verzoek u met klem om prioritaire actie en spoedige interventie.

Met vriendelijke groet,
Aldo Fieuw`,

    100: `Beste heer/mevrouw,

Mijn vijfentwintigste bericht betreffende de gevaarlijke paal (KM-2026-09338). De situatie blijft onveranderd en vormt een ernstig risico voor het publiek.

Ik verzoek u dringend om onmiddellijke actie en spoedige opvolging.

Met vriendelijke groeten,
Aldo Fieuw`,

    150: `Geachte medewerkers,

Na zeventig herinneringen over dossier KM-2026-09338, kan ik mijn bezorgdheid niet langer opzij schuiven. De gevaarlijke metalen beugels vormen nog steeds een direct risico.

Ik verzoek u met grote dringendheid om prioritaire behandeling en spoedige verwijdering.

Met vriendelijke groet,
Aldo Fieuw`
  };
  
  return examples[reminderCount] || examples[0];
}

function log(msg) {
  Logger.log(msg);
}
