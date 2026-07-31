/**
 * Test script to generate 24 examples of increasing irritation
 * Run: clasp run testIrritationLadder
 */
function testIrritationLadder() {
  const subject = "FW: (KM-2026-09338) - Gevaarlijke paal Bergbosstraat";
  const snippet = `Inkomend bericht van 04/04/2026 door Burger
Toegekend dossiernummer: KM-2026-09338

Bericht: Beste, Ik maak melding van een gevaarlijke situatie op het aangegeven pad. Vaststelling: Langs het onverharde pad staat een groene paal waarvan het verkeersbord is verdwenen. De metalen bevestigingsbeugels zitten echter nog op de paal en steken scherp naar buiten op borst-/heuphoogte. Veiligheidsargumentatie: Deze uitstekende metalen delen vormen een direct fysiek gevaar voor wandelaars, lopers en spelende kinderen, zeker omdat het pad smal is en de paal vlak naast de omheining staat. In het donker of bij onoplettendheid kan men hier ernstige snijwonden of kledingschade door oplopen. Daarnaast ontbreekt hierdoor de noodzakelijke signalisatie voor dit pad. Verzoek: Ik verzoek de technische dienst om deze scherpe restanten zo snel mogelijk te verwijderen en, indien nodig, een nieuw bord te plaatsen.`;
  
  const recipient = { name: 'AWV-klantendienst', email: 'klantendienst-awv@wegenenverkeer.be' };
  
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║     IRRITATION LADDER TEST - 24 EXAMPLES                    ║');
  log('╚══════════════════════════════════════════════════════════════╝');
  log('');
  
  // Generate examples for different time periods
  const days = [1, 3, 5, 7, 10, 14, 15, 17, 20, 24, 28, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 120, 150];
  
  days.forEach((day, index) => {
    log(`\n${'═'.repeat(70)}`);
    log(`EXAMPLE ${index + 1}/24 - After ${day} days`);
    log(`${'═'.repeat(70)}`);
    
    const tone = getTone(day);
    log(`[TONE]: ${tone}`);
    log('');
    log('[SIMULATED AI RESPONSE]:');
    log(generateExampleEmail(day));
  });
  
  log('\n\n' + '═'.repeat(70));
  log('END OF TEST');
  log('═'.repeat(70));
}

function getTone(days) {
  if (days > 28) return '🔴 ZEER DRINGEND - Bezorgd over veiligheid';
  if (days > 14) return '🟡 VASTBERADEN - Wijzend op risico';
  return '🟢 VRIENDELIJK - Professioneel en beleefd';
}

function generateExampleEmail(days) {
  const examples = {
    // Level 1: Friendly (1-14 days)
    1: `Beste medewerker,

Ik stuur u deze e-mail in verband met mijn eerdere melding over een gevaarlijke situatie in de Bergbosstraat te Merelbeke (dossiernummer: KM-2026-09338).

Graag zou ik weten of u al de gelegenheid heeft gehad om deze kwestie te bekijken.

Alvast bedankt voor uw tijd en moeite.

Met vriendelijke groeten,
Aldo Fieuw`,

    3: `Geachte heer/mevrouw,

Ik hoop dat alles goed met u gaat.

Ik wil graag een vriendelijke herinnering sturen betreffende mijn melding over de gevaarlijke paal in de Bergbosstraat (dossier KM-2026-09338).

Zou u mij kunnen laten weten of er al enige voortgang is?

Met vriendelijke groet,
Aldo Fieuw`,

    5: `Beste,

Allereerst excuses voor het storen. Ik wilde enkel navragen of u mijn eerdere melding over de gevaarlijke situatie (dossier KM-2026-09338) in behandeling heeft kunnen nemen.

Ik sta graag ter beschikking voor bijkomende informatie.

Met vriendelijke groeten,
Aldo Fieuw`,

    7: `Geachte klantendienst,

Graag zou ik een update willen vragen betreffende dossier KM-2026-09338. Het gaat om de gevaarlijke metalen beugels aan de paal in de Bergbosstraat.

Ik verneem graag of er al een plan van aanpak is.

Met vriendelijke groet,
Aldo Fieuw`,

    10: `Beste medewerkers,

Ik stuur u een vriendelijke herinnering inzake mijn melding van 04/04/2026 over de gevaarlijke situatie (dossier KM-2026-09338).

Zou u mij een korte status kunnen doorgeven?

Alvast dank,
Aldo Fieuw`,

    14: `Geachte heer/mevrouw,

Naar aanleiding van mijn eerdere bericht over de gevaarlijke paal in de Bergbosstraat (KM-2026-09338), wil ik graag polsen of er al resultaat is.

Ik begrijp dat het werk druk is, maar geef alvast mijn dank voor de opvolging.

Met vriendelijke groeten,
Aldo Fieuw`,

    // Level 2: Firm (15-28 days)
    15: `Beste klantendienst,

Het is nu twee weken geleden dat ik melding maakte van een gevaarlijke situatie in de Bergbosstraat (dossier KM-2026-09338). De scherpe metalen beugels vormen een direct risico voor wandelaars en kinderen.

Ik verzoek u vriendelijk maar dringend om spoedige opvolging en een update over de planning voor de verwijdering.

Met vriendelijke groet,
Aldo Fieuw`,

    17: `Geachte heer/mevrouw,

Ik keer terug bij u met een follow-up over dossier KM-2026-09338. De gevaarlijke situatie langs het onverharde pad is nog steeds aanwezig en vormt een ernstig veiligheidsrisico.

Graag verneem ik wanneer de nodige maatregelen genomen zullen worden.

Met vriendelijke groeten,
Aldo Fieuw`,

    20: `Beste medewerkers,

Twee weken zijn nu verstreken sinds mijn melding over de gevaarlijke paal (KM-2026-09338). Gezien het veiligheidsrisico voor voorbijgangers, verzoek ik u vriendelijk maar dringend om prioritering van deze zaak.

Ik hoor graag wat de status is.

Met vriendelijke groet,
Aldo Fieuw`,

    24: `Geachte klantendienst,

Bij deze wil ik opnieuw op de bres komen voor dossier KM-2026-09338. De scherpe metalen delen steken nog steeds scherp naar buiten op borsthoogte, wat een direct gevaar vormt voor wandelaars.

Ik verzoek u vriendelijk maar vastberaden om spoedige actie.

Met vriendelijke groeten,
Aldo Fieuw`,

    // Level 3: Urgent (29+ days)
    28: `Beste heer/mevrouw,

Het is nu ruim een maand geleden dat ik melding maakte van de gevaarlijke situatie in de Bergbosstraat (dossier KM-2026-09338). Ik maak mij ernstige zorgen over de veiligheid van wandelaars, lopers en spelende kinderen.

Ik verzoek u met klem om deze zaak prioritair in behandeling te nemen en mij zo snel mogelijk op de hoogte te stellen van de nodige maatregelen.

Met vriendelijke groet,
Aldo Fieuw`,

    30: `Geachte klantendienst,

Ik kan mijn bezorgdheid niet langer opzij schuiven. Meer dan een maand geleden meldde ik een gevaarlijke situatie (KM-2026-09338) die nog steeds niet opgelost is. De scherpe metalen beugels vormen een direct fysiek gevaar.

Ik verzoek u dringend om onmiddellijke actie en een spoedupdate.

Met vriendelijke groeten,
Aldo Fieuw`,

    35: `Beste medewerkers,

Mijn melding over de gevaarlijke paal (KM-2026-09338) is nu 35 dagen geleden. Ondertussen zijn wandelaars en kinderen nog steeds blootgesteld aan dit veiligheidsrisico.

Ik verzoek u met grote dringendheid om prioritering van deze zaak en spoedige verwijdering van de gevaarlijke restanten.

Met vriendelijke groet,
Aldo Fieuw`,

    40: `Geachte heer/mevrouw,

Ik moet u teleurstellen dat er na 40 dagen nog geen actie is ondernomen betreffende dossier KM-2026-09338. De gevaarlijke situatie blijft bestaan en vormt een ernstig risico voor de veiligheid van het publiek.

Ik verzoek u dringend om onmiddellijke interventie en een spoedverslag over de geplande maatregelen.

Met vriendelijke groeten,
Aldo Fieuw`,

    45: `Beste klantendienst,

Na 45 dagen wachten op respons betreffende de gevaarlijke paal (KM-2026-09338), ben ik ernstig bezorgd. De situatie is onveranderd en de veiligheid van wandelaars blijft in het gedrang.

Ik verzoek u met klem om prioritaire actie en onmiddellijke informatie over de timing van de werkvoren.

Met vriendelijke groet,
Aldo Fieuw`,

    50: `Geachte heer/mevrouw,

Ik schrijf u opnieuw over dossier KM-2026-09338. Na 50 dagen is er nog geen enkele reactie gekomen op mijn melding van de gevaarlijke situatie. De scherpe metalen beugels vormen nog steeds een direct risico.

Ik verzoek u dringend om spoedige actie en een update over de planning.

Met vriendelijke groeten,
Aldo Fieuw`,

    55: `Beste medewerkers,

Na 55 dagen zonder reactie op mijn melding over de gevaarlijke paal (KM-2026-09338), ben ik genoodzaakt deze zaak opnieuw onder de aandacht te brengen. De veiligheid van voorbijgangers is in het gedrang.

Ik verzoek u dringend om spoedige opvolging en informatie over de geplande maatregelen.

Met vriendelijke groet,
Aldo Fieuw`,

    60: `Geachte klantendienst,

Het is nu 60 dagen geleden dat ik melding maakte van de gevaarlijke situatie in de Bergbosstraat. Dossier KM-2026-09338 blijft zonder resultaat. De scherpe metalen delen vormen nog steeds een ernstig risico voor wandelaars.

Ik verzoek u met klem om prioritaire behandeling en spoedige actie.

Met vriendelijke groeten,
Aldo Fieuw`,

    70: `Beste heer/mevrouw,

Na 70 dagen wachten op respons betreffende dossier KM-2026-09338, blijf ik mijn bezorgdheid uiten over de aanhoudende gevaarlijke situatie. De veiligheid van het publiek is mijn grootste zorg.

Ik verzoek u dringend om onmiddellijke actie en een spoedupdate over de geplande maatregelen.

Met vriendelijke groet,
Aldo Fieuw`,

    80: `Geachte klantendienst,

Na 80 dagen zonder enige reactie op mijn melding over de gevaarlijke paal (KM-2026-09338), zie ik mij genoodzaakt deze zaak opnieuw aan te kaarten. De situatie blijft onaanvaardbaar.

Ik verzoek u met dringendheid om prioritaire behandeling en spoedige interventie.

Met vriendelijke groeten,
Aldo Fieuw`,

    90: `Beste medewerkers,

Na 90 dagen wachten op respons, ben ik nog steeds niet op de hoogte van de voortgang betreffende dossier KM-2026-09338. De gevaarlijke situatie in de Bergbosstraat blijft bestaan en vormt een ernstig risico.

Ik verzoek u dringend om spoedige actie en een update over de geplande maatregelen.

Met vriendelijke groet,
Aldo Fieuw`,

    100: `Geachte heer/mevrouw,

Na 100 dagen zonder reactie op mijn melding over de gevaarlijke paal (KM-2026-09338), kan ik niet anders dan mijn grote bezorgdheid uiten. De veiligheid van wandelaars en kinderen blijft in het gedrang.

Ik verzoek u dringend om prioritaire actie en spoedige oplossing van dit veiligheidsrisico.

Met vriendelijke groeten,
Aldo Fieuw`,

    120: `Beste klantendienst,

Na 4 maanden wachten op respons betreffende dossier KM-2026-09338, ben ik genoodzaakt deze zaak opnieuw onder de aandacht te brengen. De gevaarlijke situatie is onveranderd en vormt nog steeds een ernstig risico.

Ik verzoek u dringend om spoedige interventie en een update over de planning.

Met vriendelijke groet,
Aldo Fieuw`,

    150: `Geachte heer/mevrouw,

Na bijna 5 maanden zonder reactie op mijn melding over de gevaarlijke paal (KM-2026-09338), beroep ik mij opnieuw op uw aandacht. De situatie blijft een ernstig veiligheidsrisico voor het publiek.

Ik verzoek u dringend om onmiddellijke actie en spoedige oplossing.

Met vriendelijke groeten,
Aldo Fieuw`
  };
  
  return examples[days] || examples[1];
}

function log(msg) {
  Logger.log(msg);
}
