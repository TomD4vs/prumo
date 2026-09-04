/**
 * prumo — the name and version printed above the report when a person is looking, that is when
 * stdout is a terminal. A pipe, a file, CI and an agent get the report alone, byte for byte as before.
 */

const NAME = [
  '██████╗ ██████╗ ██╗   ██╗███╗   ███╗ ██████╗',
  '██╔══██╗██╔══██╗██║   ██║████╗ ████║██╔═══██╗',
  '██████╔╝██████╔╝██║   ██║██╔████╔██║██║   ██║',
  '██╔═══╝ ██╔══██╗██║   ██║██║╚██╔╝██║██║   ██║',
  '██║     ██║  ██║╚██████╔╝██║ ╚═╝ ██║╚██████╔╝',
  '╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝ ╚═════╝',
];
const WIDTH = Math.max(...NAME.map((l) => l.length));
const TAGLINE = 'is your documentation still true?';

const ESC = '[';
const RESET = ESC + '0m';
/** The face of the letters, their shadow, the rule in the colour of the social card, the small print, and the link. */
const PAINT = { face: '1;97', shadow: '38;5;240', rule: '38;5;79', small: '38;5;245', link: '4;38;5;79' };
const paint = (kind, text) => ESC + PAINT[kind] + 'm' + text + RESET;

/** Colours one row of the name: the blocks are the face, everything else that is not a space is shadow. */
function colourRow(row) {
  let out = '';
  for (const run of row.match(/█+|[^█ ]+| +/g)) {
    if (run[0] === ' ') out += run;
    else out += paint(run[0] === '█' ? 'face' : 'shadow', run);
  }
  return out;
}

/** The name, a rule as wide as it, the version and the tagline, and the GitHub page signed on the right when known. */
export function banner(version, { color = false, github = '' } = {}) {
  const rule = '━'.repeat(WIDTH);
  const lines = color
    ? [...NAME.map(colourRow), paint('rule', rule), paint('face', version) + '  ' + paint('small', TAGLINE)]
    : [...NAME, rule, `${version}  ${TAGLINE}`];
  if (github) {
    const page = `github.com/${github}`;
    lines.push(''.padEnd(WIDTH - page.length) + (color ? paint('link', page) : page));
  }
  return lines.join('\n');
}

/** True when the banner belongs in the output: stdout is a terminal, unless PRUMO_BANNER says otherwise. */
export function wantsBanner(env = process.env, stdout = process.stdout) {
  if (env.PRUMO_BANNER === '1') return true;
  if (env.PRUMO_BANNER === '0') return false;
  return Boolean(stdout.isTTY);
}

/** True when colour is welcome: a terminal or FORCE_COLOR, and never under NO_COLOR. */
export function wantsColor(env = process.env, stdout = process.stdout) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== '') return true;
  return Boolean(stdout.isTTY);
}
