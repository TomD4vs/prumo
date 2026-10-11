import { LIST_ITEM, TABLE_ROW } from './lines.mjs';

export const NEGATION = new RegExp(
  [
    '(does|do|did|is|are|was|were|has|have|will) ?n.?t ',
    'no longer', '\\bnever', 'used to', 'formerly', 'replaced by', 'deprecated',
    'was removed', 'were removed', 'has been removed', 'deleted', 'renamed', 'migrated', '\\bmoved\\b',
    'historical', 'reverted', 'superseded', 'not published', 'not exist',
    'n[ãa]o (existe|publica|h[áa]|tem)', 'n[ãa]o [ée] ', 'removid', 'apagad', 'deletad',
    'exclu[ií]d', '\\bsumi', 'deixou de', 'foi renomead', 'virou', 'passou a ser',
    'hist[óo]ric', 'obsolet', 'superad', 'revertid', 'substitu[íi]d',
    'antes (era|fazia|chamava)', '\\berrad', 'min[úu]scul', 'mai[úu]scul', 'caixa',
    '已(删除|移除|下线|废弃|迁移)', '不存在', '重命名',
    '\\bcitad', 'exemplo', 'placeholder', 'example', '\\be\\.g\\.', 'gitignor', '\\bno\\b[^.\\n]{0,40}\\bfound\\b',
  ].join('|'),
  'i'
);

export const PRODUCES = new RegExp('\\b(' + [
  'outputs?', 'writes?|writing|written', 'saves?|saved|saving', 'creates?|created|creating',
  'generates?|generated|generating', 'emits?|emitted|emitting', 'produces?|produced|producing',
  'renders? to|rendered to', 'dumps? to|dumped to', 'stores? (in|to|at)|stored (in|to|at)',
  'records? (in|to)|recorded (in|to)', 'logs? to|logged to', 'places? (in|at)|placed (in|at)',
  'puts? (it |them )?(in|at)', 'adds? (it |them )?to|added to', 'maintains?|maintaining', 'location', 'destination',
  'gera|geram|gere|gerar|gerad[oa]s?', 'cria|criam|crie|criar|criad[oa]s?', 'salva|salvam|salve|salvar|salv[oa]s?',
  'grava|gravam|grave|gravar|gravad[oa]s?', 'escreve|escrevem|escreva|escrever|escrit[oa]s?',
  'produz|produzem|produza|produzir|produzid[oa]s?',
].join('|') + ')\\b', 'i');
const CONSUMES = new RegExp('\\b(' + [
  'reads?|reading', 'see', 'consults?', 'refers? to', 'checks?', 'looks? (at|in|into)', 'opens?', 'edits?|editing',
  'updates?|updating', 'modif(y|ies|ying)', 'follows?', 'defined in', 'lives? in', 'found in', 'located (in|at)',
  'exists? (in|at)', 'sits? in', 'uses?|using', 'imports?', 'includes?', 'requires?', 'runs?|running', 'executes?',
  'loads?', 'from', 'outputs? of', 'keeps?', 'according to',
  '(generated|created|written|produced|saved|emitted|rendered|built|made) (by|via|with|using)',
  '(gerad[oa]s?|criad[oa]s?|escrit[oa]s?|produzid[oa]s?) (por|via|com|usando)',
  'leia|leiam', 'veja|vejam', 'consulte|consultem', 'confira|confiram', 'abra|abram', 'edite|editem',
  'atualize|atualizem', 'use|usem', 'rode|rodem', 'execute|executem', 'importe|importem', 'carregue', 'siga|sigam',
  'fica em|ficam em', 'est[áa] em|est[ãa]o em', 'definid[oa]s? em', 'mora em', 'encontra-se em', 'a partir de',
].join('|') + ')\\b', 'i');
const PRODUCED = /\b(is|are|gets?|be|will be|should be|must be|ser[áa]|ser[ãa]o|s[ãa]o|fica|ficam|deve ser|devem ser)\s+(written|created|generated|saved|stored|placed|produced|emitted|rendered|dumped|recorded|logged|output|gerad[oa]s?|criad[oa]s?|salv[oa]s?|gravad[oa]s?|escrit[oa]s?|produzid[oa]s?)\b/i;
const OUTPUT_LABEL = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?(?:outputs?|output (?:files?|paths?)|location|destination|target (?:files?|paths?)|generated files?|sa[íi]da|destino|arquivos? gerados?)(?:\*\*|__)?\s*:/i;
const PRODUCES_ALL = new RegExp(PRODUCES.source, 'gi');
const PRODUCED_ALL = new RegExp(PRODUCED.source, 'gi');
const CONSUMES_ALL = new RegExp(CONSUMES.source, 'gi');

/** True when the lines around a citation name another repository, which is whose path it is. */
export function namesAnotherRepo(window, own) {
  if (!own) return false;
  for (const m of window.matchAll(/(?:github|gitlab)\.com[:/]([\w.-]+\/[\w.-]+)/gi)) {
    if (m[1].replace(/\.git$/, '').toLowerCase() !== own) return true;
  }
  return false;
}

const masked = (text) => text.replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length));

/**
 * The sentence a citation sits in: from the terminator before it to the one after, with backtick
 * spans masked first, since a path holds dots of its own. `at` is where the citation starts.
 */
function sentenceAround(text, at, len) {
  const plain = masked(text);
  let start = 0;
  for (const m of plain.matchAll(/[.!?;]\s/g)) { if (m.index < at) start = m.index + m[0].length; else break; }
  const tail = plain.slice(at + len).search(/[.!?;](\s|$)/);
  const end = tail < 0 ? text.length : at + len + tail;
  return { text: text.slice(start, end), at: at - start };
}

/**
 * Which family of verb governs the citation at `at`: the producing or the consuming one nearest to
 * it, a producing verb after it counting only in the passive, *"`x` is generated"* and never
 * *"`x` creates users"*. Empty when neither family is there. A producing verb says the file is written
 * by the agent, a command or a build, so it is not here yet by design: *"save it to `x`"*, *"Output:
 * `x`"*. A consuming verb presumes the file is here, and only matters beside a producing one, so
 * *"read `a` and write the result to `b`"* keeps `a` checked.
 * Backtick spans are masked, since `scripts/generate.js` holds a verb that governs nothing.
 */
function governs(text, at, len) {
  const plain = masked(text);
  const nearest = (re, after) => {
    let best = Infinity;
    for (const m of plain.matchAll(re)) {
      if (m.index + m[0].length <= at) best = Math.min(best, at - (m.index + m[0].length));
      else if (after && m.index >= at + len) best = Math.min(best, m.index - (at + len));
    }
    return best;
  };
  const p = Math.min(nearest(PRODUCES_ALL, false), nearest(PRODUCED_ALL, true));
  const c = nearest(CONSUMES_ALL, true);
  if (p === Infinity && c === Infinity) return '';
  return p <= c ? 'produces' : 'consumes';
}

/** True when the sentence makes the file's existence a condition: *"if `x` exists, read it"*, *"check whether `x` is present"*, *"se `x` existir"*. */
export function conditionalExistence(text, at, len) {
  const s = sentenceAround(text, at, len);
  const plain = masked(s.text);
  const state = '(exists?|present|available|found|missing|absent|existir|existirem|exista|existe|presente|ausente|faltar)';
  const after = plain.slice(s.at + len);
  const holds = '(has|have|holds|contains|ships|tem|tiver|houver|contiver|traz)';
  return (/\b(if|when|whether|unless|se|caso|quando)\b[^.;!?]{0,60}$/i.test(plain.slice(0, s.at)) && new RegExp('^[^.;!?]{0,40}\\b' + state + '\\b', 'i').test(after))
    || new RegExp('\\b(if|when|whether|unless|se|caso|quando)\\b[^.;!?]{0,40}\\b' + holds + '\\b[^.;!?]{0,60}$', 'i').test(plain.slice(0, s.at))
    || new RegExp('^[^.;!?]{0,40}\\b(if|when|whether|unless|se|caso|quando)\\b[^.;!?]{0,40}\\b' + state + '\\b', 'i').test(after);
}

/** What a heading or a block's introduction says about the paths under it: a producing verb anywhere wins, since *"Output path | When to use"* is about outputs. */
function mentions(text) {
  const plain = masked(text);
  if (PRODUCES.test(plain) || PRODUCED.test(plain)) return 'produces';
  return CONSUMES.test(plain) ? 'consumes' : '';
}

/**
 * The line that introduces the block a citation sits in: the sentence above a fenced block or a
 * list, the parent item of a nested list, and for a table its header row with the sentence above.
 */
function introOf(lines, marked, i, m) {
  const proseAt = (j) => (j >= 0 && marked[j].kind === 'prose' ? lines[j] : '');
  const aboveBlank = (j) => (j >= 0 && !lines[j].trim() ? j - 1 : j);
  const intro = INTROS.find((x) => x.when(lines, i, m));
  return intro ? intro.of(lines, i, m, proseAt, aboveBlank) : '';
}

const INTROS = [
  { when: (lines, i, m) => m.kind === 'code', of: (lines, i, m, proseAt, aboveBlank) => proseAt(aboveBlank(m.anchor - 1)) },
  { when: (lines, i) => LIST_ITEM.test(lines[i]), of: (lines, i, m, proseAt, aboveBlank) => proseAt(aboveBlank(aboveList(lines, i))) },
  { when: (lines, i) => TABLE_ROW.test(lines[i]), of: (lines, i, m, proseAt, aboveBlank) => { const head = tableHead(lines, i); return `${lines[head]} ${proseAt(aboveBlank(head - 1))}`; } },
];

/**
 * The line above the list an item sits in, or above its parent item when it is nested: the walk up
 * passes items as deep or deeper, their continuation lines, and blank lines between items.
 */
function aboveList(lines, i) {
  const depth = lines[i].match(LIST_ITEM)[1].length;
  let j = i - 1;
  for (; j >= 0; j--) {
    const it = lines[j].match(LIST_ITEM);
    const inside = it ? it[1].length >= depth : /^\s+\S/.test(lines[j]) || (!lines[j].trim() && j > 0 && LIST_ITEM.test(lines[j - 1]));
    if (!inside) break;
  }
  return j;
}

/** The header row of the table a row sits in. */
function tableHead(lines, i) {
  let j = i;
  while (j > 0 && TABLE_ROW.test(lines[j - 1])) j--;
  return j;
}

const VERDICTS = [
  (x) => (x.m.kind === 'prose' && x.sentence.at === x.at && OUTPUT_LABEL.test(x.m.text) ? 'produces' : ''),
  (x) => (x.m.kind === 'prose' ? governs(x.sentence.text, x.sentence.at, x.len) : ''),
  (x) => mentions(introOf(x.lines, x.marked, x.i, x.m)),
  (x) => (x.headings[x.i] >= 0 ? mentions(x.lines[x.headings[x.i]]) : ''),
];

/**
 * Whether the sentence, the block's introduction or the section heading says the path is produced
 * or consumed, asked in that order: the first of `VERDICTS` with an answer settles it. A label such
 * as `Output:` opening the line settles it before anything else.
 */
export function verdictOn(lines, marked, headings, i, m, at, len) {
  let sentence = null;
  const x = { lines, marked, headings, i, m, at, len, get sentence() { return sentence ??= sentenceAround(m.text, at, len); } };
  return VERDICTS.reduce((verdict, step) => verdict || step(x), '');
}
