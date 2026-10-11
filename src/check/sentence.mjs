/**
 * prumo — what the words around a citation say about it: that the file is gone, that it is
 * written by the agent or a build, that its existence is a condition, or that it belongs to
 * another repository. Most of the filters that keep the checks quiet read prose here.
 */

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

/**
 * Verbs that say the path is written by the agent, a command or a build, so the file is not here yet
 * by design: *"save it to `x`"*, *"the script creates `x`"*, *"Output: `x`"*. The verb nearest the
 * path in its sentence governs it, so *"read `a` and write the result to `b`"* keeps `a` checked.
 */
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
/**
 * Verbs that presume the file is here: it is read, edited, run or said to live somewhere. They only
 * matter beside a producing verb, since a path with no verb at all is checked anyway.
 */
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
/** A producing verb after the path counts only in the passive: *"`x` is generated"*, never *"`x` creates users"*. */
const PRODUCED = /\b(is|are|gets?|be|will be|should be|must be|ser[áa]|ser[ãa]o|s[ãa]o|fica|ficam|deve ser|devem ser)\s+(written|created|generated|saved|stored|placed|produced|emitted|rendered|dumped|recorded|logged|output|gerad[oa]s?|criad[oa]s?|salv[oa]s?|gravad[oa]s?|escrit[oa]s?|produzid[oa]s?)\b/i;
/** A label in front of the path that names it as the thing written: `Output: x`, `Location: x`, `Saída: x`. */
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
 * it, a producing verb after it counting only in the passive. Empty when neither family is there.
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
  if (m.kind === 'code') return proseAt(aboveBlank(m.anchor - 1));
  const item = lines[i].match(LIST_ITEM);
  if (item) {
    let j = i - 1;
    for (; j >= 0; j--) {
      const it = lines[j].match(LIST_ITEM);
      if (it) { if (it[1].length < item[1].length) break; continue; }
      if (/^\s+\S/.test(lines[j]) || (!lines[j].trim() && j > 0 && LIST_ITEM.test(lines[j - 1]))) continue;
      break;
    }
    return proseAt(aboveBlank(j));
  }
  if (TABLE_ROW.test(lines[i])) {
    let j = i;
    while (j > 0 && TABLE_ROW.test(lines[j - 1])) j--;
    return `${lines[j]} ${proseAt(aboveBlank(j - 1))}`;
  }
  return '';
}

/**
 * Whether the sentence, the block's introduction or the section heading says the path is produced
 * or consumed. A label such as `Output:` opening the line settles it on its own.
 */
export function verdictOn(lines, marked, headings, i, m, at, len) {
  if (m.kind === 'prose') {
    const s = sentenceAround(m.text, at, len);
    if (s.at === at && OUTPUT_LABEL.test(m.text)) return 'produces';
    const v = governs(s.text, s.at, len);
    if (v) return v;
  }
  const lead = mentions(introOf(lines, marked, i, m));
  if (lead) return lead;
  const h = headings[i];
  return h >= 0 ? mentions(lines[h]) : '';
}
