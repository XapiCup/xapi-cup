// Test de la logique tournoi
import { generatePoules, generatePouleMatches, computeStandings, buildBracket, splitQualifiers, setBracketWinner } from './js/tournament.js';

function assert(cond, label) {
  if (cond) console.log('  ✅', label);
  else { console.error('  ❌', label); process.exit(1); }
}

function showStandings(poule, teams) {
  const matches = generatePouleMatches(0, teams);
  // Simuler des scores aléatoires
  matches.forEach(m => {
    m.scoreA = Math.floor(Math.random() * 5);
    m.scoreB = Math.floor(Math.random() * 5);
    m.finished = true;
  });
  const standings = computeStandings(teams, matches);
  return { standings, matches };
}

console.log('=== TEST 1 : 12 équipes, 4 poules de 3 ===');
const teams12 = Array.from({length: 12}, (_, i) => ({ id: 't'+i, name: 'Team '+(i+1), color: '#000' }));
const poules12 = generatePoules(teams12, 4);
console.log('  Poules sizes:', poules12.map(p => p.length));
assert(poules12.every(p => p.length === 3), '12 équipes = 4 poules de 3');
assert(poules12.flat().length === 12, 'Total = 12 équipes');
const allStandings12 = poules12.map((p, i) => showStandings(i, p).standings);
allStandings12.forEach((s, i) => {
  console.log(`  Poule ${String.fromCharCode(65+i)}: ${s.map(x => x.team.name).join(' > ')}`);
});

console.log('\n=== TEST 2 : 16 équipes, 4 poules de 4 ===');
const teams16 = Array.from({length: 16}, (_, i) => ({ id: 't'+i, name: 'Team '+(i+1), color: '#000' }));
const poules16 = generatePoules(teams16, 4);
assert(poules16.every(p => p.length === 4), '16 équipes = 4 poules de 4');

const allS16 = poules16.map((p, i) => showStandings(i, p).standings);
const { gold, consolante } = splitQualifiers(allS16, 2, true);
console.log(`  Gold (${gold.length}):`, gold.map(t => t.name).join(', '));
console.log(`  Consolante (${consolante.length}):`, consolante.map(t => t.name).join(', '));
assert(gold.length === 8 && consolante.length === 8, 'Gold=8, Consolante=8');

const goldBracket = buildBracket(gold);
console.log(`  Gold bracket: ${goldBracket.size} slots, ${goldBracket.totalRounds} rounds, ${goldBracket.rounds[0].length} matchs au tour 1`);
assert(goldBracket.totalRounds === 3, 'Bracket à 8 = 3 tours');
assert(goldBracket.rounds[0].length === 4, '8 équipes = 4 matchs en 1/4');

console.log('\n=== TEST 3 : 7 équipes (nombre non-puissance de 2) ===');
const teams7 = Array.from({length: 7}, (_, i) => ({ id: 't'+i, name: 'Team '+(i+1), color: '#000' }));
const bracket7 = buildBracket(teams7);
console.log(`  7 équipes → bracket ${bracket7.size} slots, ${bracket7.byes} byes, ${bracket7.rounds[0].length} matchs au tour 1`);
assert(bracket7.byes === 1, '7 équipes = 1 bye (pour aller à 8)');
const byes = bracket7.rounds[0].filter(m => m.bye);
assert(byes.length === 1, '1 match avec bye');

// Simuler la propagation d'un vainqueur
const bracket10 = buildBracket(Array.from({length: 10}, (_, i) => ({ id: 't'+i, name: 'T'+(i+1), color: '#000' })));
console.log(`\n=== TEST 4 : 10 équipes → bracket ${bracket10.size} ===`);
let b = bracket10;
b.rounds[0].forEach((m, i) => {
  if (m.bye) return;
  m.scoreA = 2 + i; m.scoreB = 1;
  m.winnerSlot = 'A'; m.finished = true;
  // propager manuellement (comme le ferait setBracketWinner)
  if (b.rounds.length > 1) {
    const next = b.rounds[1];
    const ni = Math.floor(i / 2);
    if (i % 2 === 0) next[ni].slotA = m.winnerSlot === 'A' ? m.slotA : m.slotB;
    else next[ni].slotB = m.winnerSlot === 'A' ? m.slotA : m.slotB;
  }
});
const filled = b.rounds[1].filter(m => m.slotA && m.slotB).length;
console.log(`  Après tour 1, ${filled}/4 matchs du tour 2 ont leurs 2 équipes`);
assert(filled === 4, 'Tous les vainqueurs sont propagés au tour 2');

console.log('\n🎉 Tous les tests passent !');
