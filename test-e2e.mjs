// Test e2e via jsdom : on simule le navigateur, on charge les modules,
// on remplit le state, on vérifie que le DOM admin et viewer se construisent sans erreur.

import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div></body></html>`, {
  url: 'http://localhost:8765/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.BroadcastChannel = dom.window.BroadcastChannel;
global.structuredClone = (x) => JSON.parse(JSON.stringify(x));

// Importer les modules
const { store } = await import('./js/state.js');
const { generatePoules, generatePouleMatches, computeStandings, buildBracket } = await import('./js/tournament.js');

console.log('1. Initialisation store OK');
console.log('   - state phase:', store.state.phase);
console.log('   - teams:', store.state.teams.length);

// Ajouter 8 équipes
const added = [];
['FC Hasparren', 'Real Basque', 'Athletic U13', 'Aviron Bayonne',
 'Biarritz Olympique', 'Saint-Jean', 'Bayonne FC', 'Hasparren B'].forEach(n => {
  const t = store.addTeam(n);
  if (t) added.push(t);
});
console.log('\n2. Ajout équipes:', added.length);
console.log('   -', added.map(t => t.name).join(', '));

// Tirer 2 poules de 4
const nbPoules = 2;
const poules = generatePoules(store.state.teams, nbPoules);
const matches = [];
poules.forEach((p, idx) => {
  matches.push(...generatePouleMatches(idx, p));
});
console.log('\n3. Tirage OK:', poules.length, 'poules,', matches.length, 'matchs');

// Simuler des scores
matches.forEach(m => {
  m.scoreA = Math.floor(Math.random() * 4);
  m.scoreB = Math.floor(Math.random() * 4);
  m.finished = true;
});

// Calculer les qualifiés
const allStandings = poules.map((p, idx) => {
  const ms = matches.filter(x => x.pouleIdx === idx);
  return computeStandings(p, ms);
});
allStandings.forEach((s, i) => {
  console.log(`   Poule ${String.fromCharCode(65+i)}: ${s.map(x => `${x.team.name} (${x.points}pts)`).join(' > ')}`);
});

// Construire le bracket Or
const gold = [];
allStandings.forEach(s => gold.push(s[0].team, s[1].team));
const goldBracket = buildBracket(gold);
console.log('\n4. Bracket Or généré:');
console.log('   -', goldBracket.rounds.length, 'rounds');
console.log('   -', goldBracket.rounds[0].length, 'matchs au tour 1');
console.log('   -', goldBracket.byes, 'byes');

// Tester render
const { renderPoule, renderBracket } = await import('./js/render.js');

// Mettre à jour le state
store.setState((s) => {
  s.poules = poules;
  s.matches = matches;
  s.brackets = { gold: goldBracket, silver: null };
  s.phase = 'knockout';
});

// Render un arbre
const tree = renderBracket(goldBracket, store.state, { title: 'Tableau Or', kind: 'gold' });
console.log('\n5. Rendu bracket:');
console.log('   - HTML length:', tree.outerHTML.length, 'chars');
console.log('   - rounds rendus:', tree.querySelectorAll('.bracket-round').length);
console.log('   - matchs rendus:', tree.querySelectorAll('.bracket-match').length);

// Render une poule
const poule = renderPoule(0, poules[0], matches.filter(m => m.pouleIdx === 0), 2, false);
console.log('   - Poule A: lignes classement =', poule.querySelectorAll('.standings-table tbody tr').length);

// Tester app.js helpers
const { el, $, $$, toast, downloadFile, copyToClipboard } = await import('./js/app.js');
const testEl = el('div', { class: 'test' }, 'Hello ', el('strong', {}, 'World'));
console.log('   - el() test:', testEl.outerHTML);

console.log('\n🎉 Tous les tests e2e passent !');
