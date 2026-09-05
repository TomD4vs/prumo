#!/usr/bin/env bash
# New-user simulation. Installs the package the way npm ships it, then follows the
# README and docs literally inside throwaway git repositories, comparing every
# output to what the documentation shows. Unit tests exercise analyze(); this
# exercises what the docs promise through the CLI. Exit code 1 when a check fails.
#
#   bash test/simulate-new-user.sh              pack this checkout and test the tarball
#   bash test/simulate-new-user.sh --registry   test the published version instead
#   bash test/simulate-new-user.sh --global     also try npm install -g (touches the machine)
#   KEEP=1 bash test/simulate-new-user.sh       leave the temp folder behind
set +e
# The shell that runs this may carry FORCE_COLOR, NO_COLOR or PRUMO_BANNER; every comparison below reads the plain output the docs show.
unset FORCE_COLOR NO_COLOR PRUMO_BANNER
HERE=$(cd "$(dirname "$0")/.." && pwd)
command -v cygpath >/dev/null 2>&1 && HERE=$(cygpath -m "$HERE")
VERSION=$(node -p "require('$HERE/package.json').version")
REGISTRY=0; GLOBAL=0
for a in "$@"; do case "$a" in --registry) REGISTRY=1 ;; --global) GLOBAL=1 ;; esac; done

U=$(mktemp -d "${TMPDIR:-/tmp}/prumo-sim-XXXXXX")
command -v cygpath >/dev/null 2>&1 && U=$(cygpath -m "$U")
trap '[ -n "$KEEP" ] && echo "kept: $U" || rm -rf "$U"' EXIT

PASS=0; FAILS=0
ok() { printf "  [OK]   %s\n" "$1"; PASS=$((PASS + 1)); }
bad() { printf "  [FAIL] %s\n" "$1"; FAILS=$((FAILS + 1)); }
chk() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (got '$1', expected '$2')"; fi; }
mk() { cd "$U" && rm -rf "$1" && git init -q "$1" && cd "$1"; }
ci() { git add -A >/dev/null 2>&1; git -c user.email=sim@prumo -c user.name=sim -c core.safecrlf=false commit -qm x >/dev/null 2>&1; }
BT='`'

echo "########## 0. Install as a user would"
if [ "$REGISTRY" = 1 ]; then PKG="@tomd4vs/prumo@$VERSION"; echo "  package: $PKG from the registry"
else TGZ=$(cd "$HERE" && npm pack --pack-destination "$U" 2>/dev/null | tail -1); PKG="$U/$TGZ"; echo "  package: $TGZ from npm pack"; fi
mk consumer; printf '# app\n' > AGENTS.md; npm init -y >/dev/null 2>&1
npm i "$PKG" --silent --no-audit --no-fund >/dev/null 2>&1; ci
PB="$U/consumer/node_modules/@tomd4vs/prumo/bin/prumo.mjs"; PR="node $PB"
[ -f "$PB" ] && ok "installed" || { bad "install failed"; exit 1; }
chk "$($PR --version)" "$VERSION" "--version"
H=$($PR --help); MISSING=""
for s in USAGE ARGUMENTS OPTIONS CONFIG "SUPPRESSING ONE LINE" ENVIRONMENT "EXIT CODE" EXAMPLES; do echo "$H" | grep -q "^$s" || MISSING="$MISSING $s"; done
[ -z "$MISSING" ] && ok "--help has the eight sections" || bad "--help lacks:$MISSING"
npx prumo 2>&1 | grep -q "nothing to review" && ok "'npx prumo' from a devDependency" || bad "npx prumo"
$PR 2>&1 | head -1 | grep -q "^prumo —" && ok "in a pipe the report opens with the header line, no banner" || bad "banner leaked into a pipe: $($PR 2>&1 | head -1)"
PRUMO_BANNER=1 NO_COLOR=1 $PR 2>&1 | head -1 | grep -q "^██████╗" && ok "PRUMO_BANNER=1 puts the name above the report" || bad "PRUMO_BANNER=1: $(PRUMO_BANNER=1 $PR 2>&1 | head -1)"
[ -f node_modules/.bin/prumo-mcp ] || [ -f node_modules/.bin/prumo-mcp.cmd ] && ok "prumo-mcp binary installed" || bad "prumo-mcp missing"

echo; echo "########## A. Quick start on a clean Python + React monorepo"
mk tickets
mkdir -p backend/app/Models backend/tests frontend/src/components scripts docs/notes .cursor/rules .github .claude/skills/release/scripts
for f in backend/app/main.py backend/app/db.py backend/app/Models/ticket.py backend/tests/test_api.py frontend/src/components/TicketList.tsx frontend/src/App.tsx scripts/seed_db.py Makefile .claude/skills/release/checklist.md .claude/skills/release/scripts/release.sh; do echo x > "$f"; done
printf 'node_modules/\n' > .gitignore
printf 'dev:\n\tuvicorn backend.app.main:app --reload\n' > Makefile
cat > CLAUDE.md <<EOT
# tickets

Backend entry point: ${BT}backend/app/main.py${BT}. Models live in ${BT}backend/app/Models/ticket.py${BT}.
The list view is ${BT}frontend/src/components/TicketList.tsx${BT}.
Seed the database with ${BT}python scripts/seed_db.py${BT}, then ${BT}alembic upgrade head${BT}.
Routes are served under ${BT}/api/v1/tickets${BT}.
Read [Architecture](docs/architecture.md) and [[deploy-checklist]] before deploying.
We removed ${BT}backend/app/legacy.py${BT}; do not recreate it.
EOT
printf '# agents\n\nRun `make dev`. See `docs/architecture.md`.\n' > AGENTS.md
printf 'Components in `src/components/`. App shell `src/App.tsx`.\n' > frontend/AGENTS.md
printf -- '---\ndescription: backend\nglobs: backend/**\n---\nUse the session from `backend/app/db.py`.\n' > .cursor/rules/backend.mdc
printf 'Tests live in `backend/tests/`.\n' > .github/copilot-instructions.md
printf -- '---\nname: release\ndescription: r\n---\nFollow [the checklist](checklist.md) and run `scripts/release.sh`.\n' > .claude/skills/release/SKILL.md
printf 'The API lives in `backend/app/main.py`; models in `backend/app/Models/`.\n' > docs/architecture.md
printf '# notes\n\n- [[deploy-checklist]]\n- [[db-conventions]]\n- [[phase-1-complete]]\n' > docs/notes/MEMORY.md
printf 'Deploy steps.\n' > docs/notes/deploy-checklist.md
printf 'Tables are declared in `backend/app/Models/ticket.py`.\n' > docs/notes/db-conventions.md
printf 'Removed `backend/app/legacy.py` in phase 1.\n' > docs/notes/phase-1-complete.md
ci
OUT=$($PR 2>&1); RC=$?; chk "$RC" "0" "clean repository: exit 0"
echo "$OUT" | head -1 | grep -q "6 context files" && ok "six context files detected (CLAUDE, AGENTS x2, .mdc, copilot, installed SKILL)" || bad "header: $(echo "$OUT" | head -1)"
echo "$OUT" | grep -q "api/v1/tickets" && bad "an HTTP route was read as a path" || ok "HTTP route left alone"
echo "$OUT" | grep -q "legacy.py" && bad "negation 'We removed' not filtered" || ok "negation filtered"

echo; echo "########## B. Three months later: the README's 'Reading the result'"
git mv backend/app/Models backend/app/tmp_ && git mv backend/app/tmp_ backend/app/models
git mv docs/notes/deploy-checklist.md docs/notes/deploy_checklist.md
git rm -q scripts/seed_db.py
git mv frontend/src/components/TicketList.tsx frontend/src/components/TicketTable.tsx
ci
OUT=$($PR 2>&1); RC=$?; chk "$RC" "1" "findings: exit 1"
echo "$OUT" | grep -q "^CASE MISMATCH  (1)   resolves on Windows and macOS, breaks on Linux and CI" && ok "CASE MISMATCH with its caption" || bad "CASE MISMATCH"
echo "$OUT" | grep -q -- "->  backend/app/models/ticket.py" && ok "-> the spelling git holds" || bad "->"
echo "$OUT" | grep -q "^BROKEN LINK  (1)   1 with a likely destination" && ok "BROKEN LINK with a likely destination" || bad "BROKEN LINK"
echo "$OUT" | grep -q "^  CLAUDE.md:7  \[\[deploy-checklist\]\]   ->  deploy_checklist" && ok "file, line, link and suggestion on one line" || bad "link line"
echo "$OUT" | grep -q "^MISSING PATH  (2)" && ok "MISSING PATH (2): a deleted script cited inside a command, and a renamed component" || bad "MISSING PATH: $(echo "$OUT" | grep MISSING)"
echo "$OUT" | grep -qE "^      ->  frontend/src/components/TicketTable.tsx   renamed in [0-9a-f]{7}, today" && ok "a missing path says where git moved it: renamed in <commit>, today" || bad "history rename: $(echo "$OUT" | grep -A2 TicketList | tr '
' '|')"
echo "$OUT" | grep -qE "^      deleted in [0-9a-f]{7}, today" && ok "and a deleted script says when it went" || bad "history delete: $(echo "$OUT" | grep -A2 seed_db | tr '
' '|')"
echo "$OUT" | grep -q "^4 to review" && ok "4 to review" || bad "total"
G=$($PR --format github 2>/dev/null); chk "$(echo "$G" | grep -Ec '^::(error|warning) file=[^,]+,line=[0-9]+::')" "4" "--format github: one annotation per finding"
J=$($PR --format json 2>/dev/null)
chk "$(echo "$J" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(Object.keys(j).join(',')+' '+Object.keys(j.stats).sort().join(','))})")" "schemaVersion,prumoVersion,repo,checkedAt,caseMismatch,brokenLinks,missingPaths,unknownCommands,configIssues,orphans,elsewhere,stats baselineStale,baselined,configs,gitignored,historical,suppressed,targets,tracked,untracked" "--format json: the keys docs/api.md lists"
echo "$J" | grep -q '"schemaVersion": 7' && echo "$J" | grep -q "\"prumoVersion\": \"$VERSION\"" && ok "--format json identifies the run by schema and version" || bad "json identity"
$PR --json out.json >/dev/null 2>&1; [ -s out.json ] && ok "--json FILE" || bad "--json FILE"; rm -f out.json
chk "$($PR 2>&1 | grep -c $'\x1b')" "0" "in a pipe the report carries no colour code"
[ "$(FORCE_COLOR=1 $PR 2>&1 | grep -c $'\x1b')" -gt 0 ] && ok "FORCE_COLOR=1 paints the report" || bad "FORCE_COLOR"
Q=$($PR --quiet 2>&1); RC=$?; chk "$RC:${#Q}" "1:0" "--quiet: exit 1, no output"
$PR --json >/dev/null 2>&1; chk "$?" "2" "--json without a path: exit 2"
$PR --bogus >/dev/null 2>&1; chk "$?" "2" "unknown option: exit 2"
cd "$U"; $PR "$U/tickets" --quiet; chk "$?" "1" "'prumo <path>' from elsewhere"; cd "$U/tickets"

echo; echo "########## C. The hook from docs/agents.md, bash and PowerShell"
node -e "
const fs=require('fs');
const hooks=(f)=>[...fs.readFileSync(f,'utf8').matchAll(/\`\`\`json\n([\s\S]*?)\`\`\`/g)]
  .map(m=>JSON.parse(m[1])).filter(j=>j.hooks&&j.hooks.PostToolUse).map(j=>j.hooks.PostToolUse[0].hooks[0]);
const en=hooks(process.argv[1]), pt=hooks(process.argv[2]);
if(en.length!==2) throw new Error('expected 2 hook blocks, found '+en.length);
if(JSON.stringify(en)!==JSON.stringify(pt)) throw new Error('the translated hooks drifted from the English ones');
if(!en.every(h=>h.command.includes('npx @tomd4vs/prumo'))) throw new Error('a hook no longer calls npx @tomd4vs/prumo');
const local=(c)=>c.split('npx @tomd4vs/prumo').join('node \"'+process.argv[3]+'\"');
fs.writeFileSync('hook-bash.txt',local(en.find(h=>!h.shell).command));
fs.writeFileSync('hook-ps1.ps1',local(en.find(h=>h.shell==='powershell').command));
" "$HERE/docs/agents.md" "$HERE/docs/agents.pt-BR.md" "$PB" && ok "every json block in docs/agents.md parses, both pages carry the same two hooks, and both call npx @tomd4vs/prumo" || bad "hook JSON"
HC=$(cat hook-bash.txt)
P1='{"tool_name":"Write","tool_input":{"file_path":"C:\\Users\\me\\tickets\\CLAUDE.md"}}'
P2='{"tool_name":"Edit","tool_input":{"file_path":"C:\\Users\\me\\tickets\\backend\\app\\main.py"}}'
P3='{"tool_name":"Write","tool_input":{"file_path":"/home/me/t/.claude/skills/release/SKILL.md"}}'
echo "$P1" | bash -c "$HC" 2>&1 | grep -q "^prumo —" && ok "bash hook: Write CLAUDE.md with a Windows path runs prumo" || bad "bash hook P1"
[ -z "$(echo "$P2" | bash -c "$HC" 2>&1)" ] && ok "bash hook: Edit main.py stays silent" || bad "bash hook P2"
echo "$P3" | bash -c "$HC" 2>&1 | grep -q "^prumo —" && ok "bash hook: an installed SKILL.md runs prumo" || bad "bash hook P3"
P4='{"tool_name":"Write","tool_input":{"file_path":"/home/me/t/.claude/commands/deploy.md"}}'
echo "$P4" | bash -c "$HC" 2>&1 | grep -q "^prumo —" && ok "bash hook: a slash command file runs prumo" || bad "bash hook P4"
echo "$P1" | bash -c "$HC" >/dev/null 2>&1; chk "$?" "0" "bash hook exits 0 despite findings, so the agent is not blocked"
if command -v powershell >/dev/null 2>&1; then
  PS1=$(echo "$P1" | powershell -NoProfile -ExecutionPolicy Bypass -File hook-ps1.ps1 2>&1)
  echo "$PS1" | grep -q "^prumo —" && ok "PowerShell hook: Write CLAUDE.md runs prumo" || bad "PowerShell hook P1: $(echo "$PS1" | head -4 | tr '\n' '|')"
  [ -z "$(echo "$P2" | powershell -NoProfile -ExecutionPolicy Bypass -File hook-ps1.ps1 2>&1)" ] && ok "PowerShell hook: Edit main.py stays silent" || bad "PowerShell hook P2"
else echo "  (no powershell here: PowerShell hook skipped)"; fi
rm -f hook-bash.txt hook-ps1.ps1

echo; echo "########## D. The README's CI step"
$PR --quiet; chk "$?" "1" "the CI step would fail on this state"
$PR --format github 2>/dev/null | head -1 | grep -q "^::error file=CLAUDE.md,line=3::Case mismatch" && ok "annotation on the exact line" || bad "annotation"
chk "$($PR --format sarif 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);console.log(s.version+':'+s.runs[0].results.length+':'+s.runs[0].results[0].ruleId)})")" "2.1.0:4:case-mismatch" "--format sarif: one result per finding"
$PR --sarif out.sarif >/dev/null 2>&1; grep -q '"ruleId": "missing-path"' out.sarif && ok "--sarif FILE beside the text report" || bad "--sarif FILE"; rm -f out.sarif
grep -q "^  using: composite" "$HERE/action.yml" && grep -q 'GITHUB_ACTION_PATH/bin/prumo.mjs' "$HERE/action.yml" && ok "action.yml runs the checked-out prumo" || bad "action.yml"
grep -q "^- id: prumo" "$HERE/.pre-commit-hooks.yaml" && grep -q "language: node" "$HERE/.pre-commit-hooks.yaml" && ok ".pre-commit-hooks.yaml declares the hook" || bad "pre-commit hook file"

echo; echo "########## E. Silencing: three markers, four config keys, --no-config"
sed 's#^The list view is.*$#& <!-- prumo-ignore -->#' CLAUDE.md > C.tmp && mv C.tmp CLAUDE.md
awk '/^Seed the database/{print "<!-- prumo-ignore-next-line -->"}1' CLAUDE.md > C.tmp && mv C.tmp CLAUDE.md
OUT=$($PR 2>&1); echo "$OUT" | grep -q "2 lines or files suppressed by a prumo-ignore marker" && ok "header counts two suppressions" || bad "suppressions"
echo "$OUT" | grep -q "^2 to review" && ok "2 to review: the case and the link" || bad "what remains: $(echo "$OUT" | tail -1)"
printf '<!-- prumo-ignore-file -->\n' | cat - AGENTS.md > A.tmp && mv A.tmp AGENTS.md
$PR 2>&1 | grep -q "3 lines or files suppressed" && ok "prumo-ignore-file counted too" || bad "ignore-file"
git checkout -q -- CLAUDE.md AGENTS.md
printf '{ "ignore": ["scripts/**", "frontend/src/components/*"] }\n' > .prumorc.json
$PR 2>&1 | grep -q "^2 to review" && ok "ignore: globs silence two paths" || bad "ignore"
printf '{ "exclude": ["CLAUDE.md"] }\n' > .prumorc.json
OUT=$($PR 2>&1); echo "$OUT" | grep -q "nothing to review" && echo "$OUT" | head -1 | grep -q "5 context files" && ok "exclude: five files, clean" || bad "exclude"
printf '{ "targets": ["docs/notes"] }\n' > .prumorc.json
$PR 2>&1 | grep -q "db-conventions.md" && ok "targets: checks docs/notes instead of auto-detecting" || bad "targets"
printf '{ "transient": ["frontend/src/components"] }\n' > .prumorc.json
$PR 2>&1 | grep -q "TicketList" && bad "transient: a bare folder did not cover its contents" || ok "transient: a bare folder covers its contents"
$PR --no-config 2>&1 | grep -q "TicketList" && ok "--no-config bypasses the file" || bad "--no-config"
printf '{ bad' > .prumorc.json; $PR >/dev/null 2>&1; chk "$?" "2" "invalid JSON: exit 2"; rm .prumorc.json

echo; echo "########## F. --fix: case mismatches and the renames git recorded, nothing else"
OUT=$($PR --fix 2>&1); echo "$OUT" | grep -q "^FIXED  2 paths in 1 file" && ok "FIXED 2 paths in 1 file: the case and the rename git recorded" || bad "FIXED: $(echo "$OUT" | grep -A3 FIXED | tr '\n' '|')"
echo "$OUT" | grep -qE "^  CLAUDE.md:[0-9]+   frontend/src/components/TicketList.tsx  ->  frontend/src/components/TicketTable.tsx   renamed in [0-9a-f]{7}$" && ok "the rename line names the commit" || bad "rename line: $(echo "$OUT" | grep TicketList | tr '\n' '|')"
chk "$(git diff --numstat | tr '\t' ' ')" "2 2 CLAUDE.md" "two lines changed in one file"
grep -q "frontend/src/components/TicketTable.tsx" CLAUDE.md && ok "CLAUDE.md now cites the component where git moved it" || bad "CLAUDE.md not rewritten"
OUT=$($PR 2>&1); echo "$OUT" | grep -q "^MISSING PATH  (1)" && echo "$OUT" | grep -q "scripts/seed_db.py" && ok "after the fix only the deleted script remains, and a deletion is never rewritten" || bad "after fix: $(echo "$OUT" | grep -A2 MISSING | tr '\n' '|')"
git checkout -q -- CLAUDE.md
sed 's#(checklist.md)#(Checklist.md)#' .claude/skills/release/SKILL.md > S.tmp && mv S.tmp .claude/skills/release/SKILL.md; ci
OUT=$($PR 2>&1); echo "$OUT" | grep -q "^CASE MISMATCH  (2)" && echo "$OUT" | grep -q "Checklist.md" && ok "a markdown link with the wrong case is a case mismatch" || bad "link case: $(echo "$OUT" | grep -A3 CASE | tr '\n' '|')"
$PR --fix >/dev/null 2>&1; grep -q "(checklist.md)" .claude/skills/release/SKILL.md && ok "--fix rewrote the link" || bad "link not rewritten"
git reset -q --hard HEAD~1

mk espaco; mkdir -p docs; echo z > "docs/Nota Longa.md"
printf '# x\n\nCerto: [a](docs/Nota%%20Longa.md).\n\nCaixa: [b](docs/nota%%20longa.md).\n\nSumiu: [c](docs/Outra%%20Nota.md).\n' > CLAUDE.md
ci
OUT=$($PR --all 2>&1)
if echo "$OUT" | grep -q "CLAUDE.md:3"; then bad "a correct %20 link must resolve: $OUT"; else ok "a link that writes a space as %20 resolves"; fi
echo "$OUT" | grep -q -- "->  docs/Nota%20Longa.md" && ok "the wrong case in it is a case mismatch, suggested still encoded" || bad "encoded case: $OUT"
echo "$OUT" | grep -q "docs/Outra%20Nota.md" && ok "and a %20 link that really is gone is still reported" || bad "encoded missing: $OUT"
$PR --fix >/dev/null 2>&1
grep -q "(docs/Nota%20Longa.md)" CLAUDE.md && ok "--fix writes the link back encoded, so it still works" || bad "fix broke the link: $(sed -n 5p CLAUDE.md)"
echo; echo "########## G. Filters the docs describe"
mk filters; mkdir -p resources/js/utils tests/Concerns notes security; echo x > resources/js/utils/foo.js; echo x > tests/Concerns/ReadsPdf.php
printf '/.claude\nsecurity/\n' > .gitignore
printf 'The project does not publish `config/dompdf.php`.\nO projeto nao publica `config/outro.php`.\nAssets in `public/build/manifest.json` and `.vite/x.json`.\nUses `@/utils/foo.js` and `tests/Concerns/ReadsPdf`.\nRun `node .claude/skills/run/driver.mjs` and read `security/findings.json`.\nLogo `public/img/LOGO WIDE.png`.\nOld: `git mv src/old.php src/new.php`.\n' > CLAUDE.md
printf 'Shipped `app/Gone.php`.\n' > notes/phase-3-complete.md; printf 'index\n' > notes/MEMORY.md; echo x > notes/loose.md; ci
OUT=$($PR 2>&1); echo "$OUT" | grep -q "nothing to review" && ok "negation EN and PT, built-in transients, alias, omitted extension, a name with spaces, a move command: nothing reported" || bad "filters: $(echo "$OUT" | grep -E '^  ' | tr '\n' '|')"
echo "$OUT" | grep -q "2 paths under .gitignore exempt" && ok "header counts two paths under .gitignore" || bad "gitignore count: $(echo "$OUT" | grep gitignore)"
OUT=$($PR . notes 2>&1)
echo "$OUT" | grep -q "1 historical entry exempt from path checks" && ok "historical note exempt" || bad "historical"
echo "$OUT" | grep -q "NOT IN INDEX" && echo "$OUT" | grep -q "loose.md" && ok "NOT IN INDEX: a note the MEMORY.md never mentions" || bad "NOT IN INDEX"

mk acentos; mkdir -p docs src "serviços"
printf '# raiz\n\nO fluxo esta em `docs/ação.md`.\n' > CLAUDE.md
echo a > "docs/Ação.md"; echo x > src/App.php
printf '# api\n\nO upload passa por `src/app.php`.\n' > "serviços/AGENTS.md"; ci
OUT=$($PR 2>&1)
echo "$OUT" | grep -q "2 context files" && ok "a folder whose name has an accent holds a context file, and it is detected" || bad "accented folder: $OUT"
echo "$OUT" | grep -q -- "->  docs/Ação.md" && ok "an accented path with the wrong case is a case mismatch, with the spelling git holds" || bad "accented case: $OUT"
echo "$OUT" | grep -q -- "->  src/App.php" && ok "the context file under the accented folder is really checked" || bad "accented nested: $OUT"

mk nomesolto; printf '# raiz\n\nO texto A esta em `politica.md`.\n\nO texto B esta em [politica](politica.md).\n' > CLAUDE.md
echo p > Politica.md; ci
OUT=$($PR 2>&1)
echo "$OUT" | grep -q "CLAUDE.md:5" && ok "a bare file name is checked when it is a markdown link" || bad "bare name as link: $OUT"
if echo "$OUT" | grep -q "CLAUDE.md:3"; then bad "a bare name in prose should be left alone: $OUT"; else ok "the same bare name in prose is left alone, as the reference says"; fi

mk marcadores; mkdir -p src chapters
printf '# raiz\n\nRode um teste com `npm test -- path/to/test.js`.\n\nSuporte `server/discover` e `tools/list`.\n\nO ajudante fica em `src/discover`.\n\n- [Um](chapters/ch01-<slug>.md)\n- [Dois](chapters/ch02-real.md)\n- [Tres](chapters/ch01-intro.md)\n' > CLAUDE.md
echo d > src/discover.ts; echo i > chapters/ch01-intro.md; ci
OUT=$($PR --all 2>&1)
if echo "$OUT" | grep -q "path/to"; then bad "path/to in an example is a placeholder: $OUT"; else ok "path/to in a command example is not reported"; fi
if echo "$OUT" | grep -q "server/discover"; then bad "an extensionless identifier is not a path: $OUT"; else ok "server/discover beside tools/list is not reported"; fi
if echo "$OUT" | grep -q -- "<slug>"; then bad "a template placeholder in a link is not a link: $OUT"; else ok "a markdown link holding <slug> is not reported"; fi
echo "$OUT" | grep -q "chapters/ch02-real.md" && ok "the real broken link beside them is still reported" || bad "real link lost: $OUT"

echo; echo "########## H. Monorepo, folder targets, spaces, truncation"
mk mono; mkdir -p packages/api docs/deep; printf '# root\n' > AGENTS.md; printf 'See `src/gone.php`.\n' > packages/api/AGENTS.md; printf 'Doc `x/y.php`.\n' > docs/a.md; printf 'Deep `x/z.php`.\n' > docs/deep/b.md; ci
$PR 2>&1 | grep -q "packages/api/AGENTS.md" && ok "nested AGENTS.md read" || bad "nested"
OUT=$($PR . docs 2>&1); echo "$OUT" | head -1 | grep -q "1 context file," && echo "$OUT" | grep -q "x/y.php" && ok "a folder target reads the .md files directly inside it" || bad "folder target"
cd "$U"; rm -rf "My Project"; git init -q "My Project"; cd "My Project"; printf 'A `b/c.php`.\n' > CLAUDE.md; ci
$PR "$U/My Project" 2>&1 | grep -q "b/c.php" && ok "a quoted path with spaces" || bad "spaces"
mk many; mkdir -p config; echo x > config/app.php; { echo "# N"; for i in $(seq 1 30); do echo "See ${BT}config/f$i.php${BT}."; done; } > CLAUDE.md; ci
chk "$($PR 2>&1 | grep -c '^  CLAUDE.md:'):$($PR --all 2>&1 | grep -c '^  CLAUDE.md:')" "25:30" "25 shown by default, 30 with --all"

echo; echo "########## I. Skills"
mk withskill; mkdir -p .claude/skills/deploy/steps; printf '# app\n' > CLAUDE.md
printf -- '---\nname: deploy\ndescription: d\n---\n- [Setup](steps/setup.md)\n- [Rollout](steps/rollout.md)\n' > .claude/skills/deploy/SKILL.md
echo s > .claude/skills/deploy/steps/setup.md; echo r > .claude/skills/deploy/steps/rollout-canary.md; ci
OUT=$($PR 2>&1); echo "$OUT" | grep -q "2 context files" && echo "$OUT" | grep -q "^  .claude/skills/deploy/SKILL.md:6  steps/rollout.md" && ok "installed skill detected; broken link named with file and line" || bad "skill: $(echo "$OUT" | grep rollout)"
mk skillrepo; mkdir steps; printf -- '---\nname: s\ndescription: d\n---\n- [A](steps/a.md)\n' > SKILL.md; echo a > steps/b.md; ci
OUT=$($PR 2>&1)
echo "$OUT" | grep -q "no context files found" && ok "a root SKILL.md is not auto-detected" || bad "root SKILL.md"
echo "$OUT" | grep -q "SKILL.md at the root" && ok "and the message says why, and names the command that checks it" || bad "no hint about the root SKILL.md: $OUT"
$PR . SKILL.md 2>&1 | grep -q "steps/a.md" && ok "'prumo . SKILL.md' checks it explicitly" || bad "explicit SKILL.md"

echo; echo "########## J. Troubleshooting"
mkdir -p "$U/plain"; cd "$U/plain"; OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^prumo: not a git repository" && chk "$RC" "2" "outside git: message and exit 2" || bad "outside git: $OUT"
mk empty; echo x > a.txt; ci; OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^prumo: no context files found" && chk "$RC" "2" "no context files: message and exit 2" || bad "no context files"

mk typo; printf 'See `src/a.py`.
' > AGENTS.md; mkdir src; echo x > src/a.py; ci
OUT=$($PR . no-such-file.md 2>&1); RC=$?
echo "$OUT" | grep -q "^prumo: target not found: no-such-file.md" && chk "$RC" "2" "a target that does not exist: message and exit 2" || bad "missing target: $OUT"
OUT=$($PR . AGENTS.md no-such-file.md 2>&1); RC=$?
echo "$OUT" | grep -q "^prumo: target not found: no-such-file.md" && chk "$RC" "2" "a typo among valid targets is not dropped in silence" || bad "typo among targets: $OUT"
printf '{"targets":["docs/no-such-file.md"]}
' > .prumorc.json
OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^prumo: target not found: docs/no-such-file.md" && chk "$RC" "2" "a targets typo in .prumorc.json: message and exit 2" || bad "config target: $OUT"
rm .prumorc.json

echo; echo "########## K. The API from docs/api.md, imported from the installed package"
cd "$U/consumer"
node --input-type=module -e "import { analyze, resolveTargets } from '@tomd4vs/prumo'; const repo=process.argv[1]; const r=analyze({ repo, targets: resolveTargets(repo, []) }); process.exit(r.caseMismatch.length===1 && r.brokenLinks.length===1 && r.missingPaths.length===2 && r.stats.targets===6 ? 0 : 1)" -- "$U/tickets" && ok "ESM: analyze + resolveTargets" || bad "ESM"
node -e "const { analyze, resolveTargets } = require('@tomd4vs/prumo'); const repo=process.argv[1]; const r=analyze({ repo, targets: resolveTargets(repo, ['docs/notes']) }); process.exit(r.orphans.length===1 && r.brokenLinks.length===1 ? 0 : 1)" -- "$U/tickets" 2>/dev/null && ok "CommonJS require(): the renamed note is an orphan of docs/notes/MEMORY.md" || echo "  (require() of an ES module needs Node 22.12+: skipped on $(node -v))"

echo; echo "########## L. MCP server over stdio"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"sim","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"prumo_check\",\"arguments\":{\"repo\":\"$U/tickets\"}}}" \
  | node "$U/consumer/node_modules/@tomd4vs/prumo/bin/prumo-mcp.mjs" > mcp.out 2>/dev/null
grep -q '"serverInfo":{"name":"prumo"' mcp.out && ok "initialize answered" || bad "initialize"
grep -q '"name":"prumo_check"' mcp.out && grep -q '"name":"prumo_fix"' mcp.out && ok "tools/list: prumo_check and prumo_fix" || bad "tools/list"
grep -q '"total":4' mcp.out && grep -q '4 to review' mcp.out && ok "tools/call prumo_check: text report and structured findings" || bad "tools/call"
printf '%s
' "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"prumo_check\",\"arguments\":{\"repo\":\"$U/tickets\",\"targets\":[\"no-such-file.md\"]}}}"   | node "$U/consumer/node_modules/@tomd4vs/prumo/bin/prumo-mcp.mjs" > mcp-target.out 2>/dev/null
grep -q '"isError":true' mcp-target.out && grep -q 'prumo: target not found: no-such-file.md' mcp-target.out && ok "tools/call with a target that does not exist: isError, not a report about another file" || bad "mcp missing target: $(cat mcp-target.out)"
rm -f mcp.out

echo; echo "########## M. Fenced blocks, comments, and every citation --fix rewrites"
mk fences; mkdir -p src docs scripts; echo x > src/Component.vue; echo x > docs/README.md; echo x > scripts/build.js
printf '# app\n\n```\nsrc/component.vue\ndocs/missing-file.md\n```\n\n```markdown\n[quoted](docs/gone.md)\n```\n\n<!-- [commented](docs/also-gone.md) -->\n\nRun `node scripts/Build.js` twice: `node scripts/Build.js --watch`.\n\n[r]: docs/readme.md\n' > CLAUDE.md; ci
OUT=$($PR --all 2>&1)
echo "$OUT" | grep -q "^  CLAUDE.md:4$" && echo "$OUT" | grep -q "^  CLAUDE.md:5  docs/missing-file.md" && ok "a path inside a fenced block is checked, case and missing alike" || bad "fenced paths: $(echo "$OUT" | grep -E '^  CLAUDE' | tr '\n' '|')"
echo "$OUT" | grep -q "gone.md" && bad "a link inside a markdown fence or an HTML comment was reported" || ok "a link inside a markdown fence or an HTML comment is a quotation"
chk "$(echo "$OUT" | grep -c '^  CLAUDE.md:14$')" "1" "the same path twice on one line is one finding"
echo "$OUT" | grep -q "^  CLAUDE.md:16$" && ok "a reference definition with the wrong case is a case mismatch" || bad "reference definition: $(echo "$OUT" | grep -E '^  CLAUDE' | tr '\n' '|')"
OUT=$($PR --fix --all 2>&1); RC=$?
echo "$OUT" | grep -q "^FIXED  3 paths in 1 file" && echo "$OUT" | grep -q "^1 to review" && chk "$RC" "1" "--fix rewrites the fenced line, the command and the reference definition in one pass; the missing path remains, exit 1" || bad "fix: $(echo "$OUT" | grep -E '^(FIXED|  skipped|[0-9]+ to review)' | tr '\n' '|')"
grep -q "^src/Component.vue$" CLAUDE.md && grep -q "node scripts/build.js --watch" CLAUDE.md && grep -q "^\[r\]: docs/README.md$" CLAUDE.md && ok "each line carries the spelling git holds" || bad "rewritten lines: $(grep -n -E 'Component|build.js|\[r\]' CLAUDE.md | tr '\n' '|')"
mk untracked; mkdir -p src .claude/skills/deploy/steps .claude/commands; echo x > src/Component.vue
printf '.claude/skills/\n' > .gitignore; printf '# app\n' > CLAUDE.md; printf 'Run `scripts/deploy.sh` first.\n' > .claude/commands/deploy.md
printf -- '---\nname: deploy\ndescription: d\n---\nEdit `src/component.vue` and follow [setup](steps/setup.md).\n' > .claude/skills/deploy/SKILL.md; echo s > .claude/skills/deploy/steps/setup.md; ci
OUT=$($PR 2>&1)
echo "$OUT" | head -3 | grep -q "3 context files" && echo "$OUT" | grep -q "1 context file not tracked by git" && ok "an installed skill under .gitignore and a slash command are both read, and the header says which came from disk" || bad "untracked: $(echo "$OUT" | head -3 | tr '\n' '|')"
echo "$OUT" | grep -q "^  .claude/skills/deploy/SKILL.md:5$" && ok "the case mismatch inside the untracked skill is reported" || bad "untracked case: $OUT"
echo "$OUT" | grep -q "steps/setup.md" && bad "the skill's own file beside it was reported" || ok "the file beside the skill is found on disk"
echo "$OUT" | grep -q "^  .claude/commands/deploy.md:1  scripts/deploy.sh" && ok "a slash command citing a dead path is reported" || bad "command target: $OUT"

echo; echo "########## N. A path the sentence writes, a source block, a script nothing defines, a heading anchor"
mk verbs; mkdir -p docs lib; echo x > docs/README.md; echo x > lib/index.js; printf '# Setup\n\n## Database\n' > docs/setup.md
printf '{"scripts":{"test:units":"x","build":"x"}}' > package.json
printf '# app\n\nOutput: `docs/report.md`\n\nRead `docs/guide.md` and write the summary to `docs/summary.md`.\n\n```js\nconst x = require(%slib/gone.js%s);\n```\n\n```bash\nnpm run test:unit && npm run build\n```\n\nSee [the schema](docs/setup.md#schema) and [the table](docs/setup.md#database).\n' "'" "'" > CLAUDE.md; ci
OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^MISSING PATH  (1)" && echo "$OUT" | grep -q "^  CLAUDE.md:5  docs/guide.md" && ok "a path a sentence says gets written is left alone, and the one it reads is reported" || bad "verbs: $(echo "$OUT" | grep -E '^  CLAUDE' | tr '\n' '|')"
echo "$OUT" | grep -q "gone.js" && bad "a js block was read" || ok "a fenced block in a programming language is not read"
echo "$OUT" | grep -q "^UNKNOWN COMMAND  (1)" && echo "$OUT" | grep -q "^  CLAUDE.md:12  npm run test:unit   ->  npm run test:units" && ok "a script nothing defines is reported with the closest name" || bad "command: $(echo "$OUT" | grep -E 'UNKNOWN|npm' | tr '\n' '|')"
echo "$OUT" | grep -q "^  CLAUDE.md:15  docs/setup.md#schema" && ! echo "$OUT" | grep -q "#database" && ok "a link to a heading the page lacks is a broken link, and one it has is not" || bad "anchor: $(echo "$OUT" | grep -E 'setup.md' | tr '\n' '|')"
echo "$OUT" | grep -q "^3 to review" && chk "$RC" "1" "3 to review, exit 1" || bad "total: $(echo "$OUT" | tail -1)"
mk elsewhere; mkdir -p docs; echo x > docs/README.md
printf '# template\n\nCopy this file to your project. Models in `app/Models/User.php`, routes in `routes/web.php`, views in `resources/views/home.blade.php`, tests in `tests/Feature/HomeTest.php`, and read `docs/README.md`.\n' > CLAUDE.md; ci
OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^ANOTHER PROJECT  (1)" && echo "$OUT" | grep -q "^  CLAUDE.md   4 of 5 cited paths" && chk "$RC" "0" "a file whose paths start in folders the repository lacks is held back, exit 0" || bad "elsewhere: $(echo "$OUT" | grep -E 'ANOTHER|CLAUDE' | tr '\n' '|')"
OUT=$($PR . CLAUDE.md 2>&1); RC=$?
echo "$OUT" | grep -q "^MISSING PATH  (4)" && chk "$RC" "1" "naming the file checks it in full" || bad "named: $(echo "$OUT" | grep -E 'MISSING|ANOTHER' | tr '\n' '|')"
mk agentconfig; mkdir -p .cursor/rules .claude/skills/deploy backend scripts; echo x > backend/app.py; echo x > scripts/live.mjs
printf -- '---\nglobs: legacy/**\n---\nRules.\n' > .cursor/rules/gone.mdc
printf -- '---\nname: deployer\n---\nSteps.\n' > .claude/skills/deploy/SKILL.md
printf '{"mcpServers":{"local":{"command":"node","args":["scripts/server.mjs"]},"here":{"command":"node","args":["scripts/live.mjs"]}}}\n' > .mcp.json
printf '# app\n' > CLAUDE.md; ci
OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^AGENT CONFIG  (3)" && echo "$OUT" | grep -q "^  .mcp.json:1  scripts/server.mjs" && chk "$RC" "1" "a dead glob, a skill without description and an MCP script that is not here: AGENT CONFIG (3), exit 1" || bad "agent config: $(echo "$OUT" | grep -E 'AGENT|mdc|SKILL|mcp' | tr '\n' '|')"
OUT=$($PR . CLAUDE.md 2>&1); echo "$OUT" | grep -q "AGENT CONFIG" && bad "config files checked on an explicit run" || ok "naming a target leaves the JSON configs alone"

echo; echo "########## O. A baseline for a legacy repository, and only what a commit or a branch touched"
mk legado; mkdir -p src docs; echo x > src/app.js
printf '# app\n\nSee \x60src/App.js\x60 and \x60config/old.php\x60.\n' > CLAUDE.md
printf '# docs\n\nRead \x60docs/gone.md\x60.\n' > AGENTS.md; ci
OUT=$($PR --baseline 2>&1); RC=$?
echo "$OUT" | grep -q "^baseline: .prumo-baseline.json, 3 findings recorded" && [ -f .prumo-baseline.json ] && chk "$RC" "0" "--baseline records the 3 findings in .prumo-baseline.json and exits 0" || bad "baseline write: $(echo "$OUT" | tail -2 | tr '\n' '|') rc=$RC"
OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^        3 findings held in .prumo-baseline.json" && echo "$OUT" | grep -q "^nothing to review" && chk "$RC" "0" "the next run holds them back, says so in the header, exit 0" || bad "baseline hold: $(echo "$OUT" | tr '\n' '|')"
printf 'And \x60docs/new.md\x60.\n' >> CLAUDE.md
OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^MISSING PATH  (1)" && echo "$OUT" | grep -q "docs/new.md" && echo "$OUT" | grep -q "^1 to review" && chk "$RC" "1" "a new finding fails the run; the held ones stay held" || bad "baseline new: $(echo "$OUT" | tr '\n' '|')"
OUT=$($PR --no-baseline 2>&1); RC=$?
echo "$OUT" | grep -q "^4 to review" && chk "$RC" "1" "--no-baseline reports all four" || bad "no-baseline: $(echo "$OUT" | grep 'to review')"
mkdir -p config; echo x > config/old.php; git add -A >/dev/null 2>&1
OUT=$($PR 2>&1); echo "$OUT" | grep -q "^        2 findings held in .prumo-baseline.json; 1 entry there matches nothing now" && ok "a resolved finding shows as an entry that matches nothing now" || bad "stale: $(echo "$OUT" | grep held)"
ci
J=$($PR --format json 2>&1); echo "$J" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);process.exit(j.stats.baselined===2&&j.stats.baselineStale===1&&j.schemaVersion===7?0:1)})" && ok "stats.baselined, stats.baselineStale and schemaVersion 7 in the JSON" || bad "json baseline stats"
printf 'Read \x60docs/also-gone.md\x60.\n' >> AGENTS.md; git add AGENTS.md >/dev/null 2>&1
OUT=$($PR --staged 2>&1); RC=$?
echo "$OUT" | grep -q "^prumo — 1 context file, " && echo "$OUT" | grep -q "^        only the context files staged for commit" && echo "$OUT" | grep -q "docs/also-gone.md" && ! echo "$OUT" | grep -q "docs/new.md" && chk "$RC" "1" "--staged checks the staged AGENTS.md alone" || bad "staged: $(echo "$OUT" | tr '\n' '|')"
ci
FIRST=$(git rev-list --max-parents=0 HEAD)
OUT=$($PR --since "$FIRST" 2>&1); RC=$?
echo "$OUT" | grep -q "^        only the context files changed since $FIRST" && echo "$OUT" | grep -q "^prumo — 2 context files, " && chk "$RC" "1" "--since REF checks the context files changed since it" || bad "since: $(echo "$OUT" | head -3 | tr '\n' '|')"
OUT=$($PR --since nope 2>&1); RC=$?; echo "$OUT" | grep -q 'git does not know "nope"' && chk "$RC" "2" "--since with a revision git does not know: message and exit 2" || bad "since unknown: $OUT rc=$RC"
OUT=$($PR --staged 2>&1); RC=$?; echo "$OUT" | grep -q "^prumo — 0 context files, " && chk "$RC" "0" "--staged with nothing staged checks nothing and exits 0" || bad "staged empty: $(echo "$OUT" | head -2 | tr '\n' '|')"
grep -q "args: \['--staged'\]" "$HERE/.pre-commit-hooks.yaml" && grep -q '^  since:' "$HERE/action.yml" && ok "the pre-commit hook passes --staged, and the action takes since" || bad "hook args / action since"

if [ "$GLOBAL" = 1 ]; then
  echo; echo "########## P. npm install -g (opt-in)"
  npm install -g "$PKG" --silent --no-audit --no-fund >/dev/null 2>&1 && hash -r
  chk "$(prumo --version 2>&1)" "$VERSION" "'prumo --version' after a global install"
  npm uninstall -g @tomd4vs/prumo --silent >/dev/null 2>&1; hash -r
fi

echo; echo "########## RESULT: $PASS ok, $FAILS failed"
[ "$FAILS" = 0 ]
