const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('b/assets/bundle-vaulted-home-apps-20261029.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function vaultedSearchText'), source.indexOf('function vaultedLauncherUrl')), context);
const {vaultedSearchScore: score, vaultedSearchGames: search} = context;
const matches = [
 ['GTA III', 'GT'], ['GTA III', 'GTA'], ['GTA III', 'Grand Theft Auto'],
 ['Grand Theft Auto: San Andreas', 'GTA'], ['GTA: San Andreas', 'gta san'],
 ['FNAF 2', 'fnaf'], ['Five Nights at Freddy’s 2', 'fnaf'],
 ['Friday Night Funkin', 'fnf'], ['FNF', 'Friday Night Funkin'],
 ['Counter-Strike', 'counterstrike'], ['Super Mario 64', 'mario super'],
 ['Pokémon', 'pokemon'], ['TikTok', 'TIK TOK'], ['Minecraft', 'minecratf'],
 ['Account settings', 'account set'], ['Jane Smith', 'smith jane'],
 ['日本語', '日本'], ['Grand Theft Auto', 'gta  ']
];
for (const [title, query] of matches) assert.ok(score(title, query) > 0, `${title} should match ${query}`);
for (const [title, query] of [['GTA III','zzzzz'], ['Music','GTA'], ['Minecraft','fnaf'], ['Jane Smith','john']]) assert.equal(score(title,query), 0);
const catalog = JSON.parse(fs.readFileSync('b/assets/json/xander.json', 'utf8'));
const gta = catalog.filter(game => /gta|grand theft auto/i.test(game.name));
assert.ok(gta.length, 'Actual catalog must include GTA games');
for (const game of gta) assert.ok(search([game], 'GTA').length, `${game.name} vanished at GTA`);
const ranked = search([{name:'Minecraft Classic'}, {name:'Minecraft'}, {name:'Minecratf'}], 'Minecraft');
assert.equal(ranked[0].name, 'Minecraft');
assert.equal(search(catalog,'').length,catalog.length);
console.log(`Search checks passed: ${matches.length} positive cases, 4 negative cases, ranking, empty query, and ${gta.length} actual GTA entries.`);
