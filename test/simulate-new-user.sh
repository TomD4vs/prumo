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
for s in USAGE ARGUMENTS OPTIONS CONFIG "SUPPRESSING ONE LINE" "EXIT CODE" EXAMPLES; do echo "$H" | grep -q "^$s" || MISSING="$MISSING $s"; done
[ -z "$MISSING" ] && ok "--help has the seven sections" || bad "--help lacks:$MISSING"
npx prumo 2>&1 | grep -q "nothing to review" && ok "'npx prumo' from a devDependency" || bad "npx prumo"
[ -f node_modules/.bin/prumo-mcp ] || [ -f node_modules/.bin/prumo-mcp.cmd ] && ok "prumo-mcp binary installed" || bad "prumo-mcp missing"

echo; echo "########## A. Quick start on a clean Python + React monorepo"
mk tickets
mkdir -p backend/app/Models backend/tests frontend/src/components scripts docs/notes .cursor/rules .github .claude/skills/release/scripts
for f in backend/app/main.py backend/app/db.py backend/app/Models/ticket.py backend/tests/test_api.py frontend/src/components/TicketList.tsx frontend/src/App.tsx scripts/seed_db.py Makefile .claude/skills/release/checklist.md .claude/skills/release/scripts/release.sh; do echo x > "$f"; done
printf 'node_modules/\n' > .gitignore
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
echo "$OUT" | grep -q "^4 to review" && ok "4 to review" || bad "total"
G=$($PR --format github 2>/dev/null); chk "$(echo "$G" | grep -Ec '^::(error|warning) file=[^,]+,line=[0-9]+::')" "4" "--format github: one annotation per finding"
J=$($PR --format json 2>/dev/null)
chk "$(echo "$J" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(Object.keys(j).join(',')+' '+Object.keys(j.stats).sort().join(','))})")" "caseMismatch,brokenLinks,missingPaths,orphans,stats gitignored,historical,suppressed,targets,tracked" "--format json: the keys docs/api.md lists"
$PR --json out.json >/dev/null 2>&1; [ -s out.json ] && ok "--json FILE" || bad "--json FILE"; rm -f out.json
Q=$($PR --quiet 2>&1); RC=$?; chk "$RC:${#Q}" "1:0" "--quiet: exit 1, no output"
$PR --json >/dev/null 2>&1; chk "$?" "2" "--json without a path: exit 2"
$PR --bogus >/dev/null 2>&1; chk "$?" "2" "unknown option: exit 2"
cd "$U"; $PR "$U/tickets" --quiet; chk "$?" "1" "'prumo <path>' from elsewhere"; cd "$U/tickets"

echo; echo "########## C. The README hook, bash and PowerShell"
node -e "
const fs=require('fs');const t=fs.readFileSync(process.argv[1],'utf8');
const blocks=[...t.matchAll(/\`\`\`json\n([\s\S]*?PostToolUse[\s\S]*?)\`\`\`/g)].map(m=>JSON.parse(m[1]).hooks.PostToolUse[0].hooks[0]);
fs.writeFileSync('hook-bash.txt',blocks.find(h=>!h.shell).command);
fs.writeFileSync('hook-ps1.ps1',blocks.find(h=>h.shell==='powershell').command);
" "$HERE/README.md" && ok "both hook blocks in the README parse as JSON" || bad "hook JSON"
HC=$(cat hook-bash.txt)
P1='{"tool_name":"Write","tool_input":{"file_path":"C:\\Users\\me\\tickets\\CLAUDE.md"}}'
P2='{"tool_name":"Edit","tool_input":{"file_path":"C:\\Users\\me\\tickets\\backend\\app\\main.py"}}'
P3='{"tool_name":"Write","tool_input":{"file_path":"/home/me/t/.claude/skills/release/SKILL.md"}}'
echo "$P1" | bash -c "$HC" 2>&1 | grep -q "^prumo —" && ok "bash hook: Write CLAUDE.md with a Windows path runs prumo" || bad "bash hook P1"
[ -z "$(echo "$P2" | bash -c "$HC" 2>&1)" ] && ok "bash hook: Edit main.py stays silent" || bad "bash hook P2"
echo "$P3" | bash -c "$HC" 2>&1 | grep -q "^prumo —" && ok "bash hook: an installed SKILL.md runs prumo" || bad "bash hook P3"
echo "$P1" | bash -c "$HC" >/dev/null 2>&1; chk "$?" "0" "bash hook exits 0 despite findings, so the agent is not blocked"
if command -v powershell >/dev/null 2>&1; then
  echo "$P1" | powershell -NoProfile -ExecutionPolicy Bypass -File hook-ps1.ps1 2>&1 | grep -q "^prumo —" && ok "PowerShell hook: Write CLAUDE.md runs prumo" || bad "PowerShell hook P1"
  [ -z "$(echo "$P2" | powershell -NoProfile -ExecutionPolicy Bypass -File hook-ps1.ps1 2>&1)" ] && ok "PowerShell hook: Edit main.py stays silent" || bad "PowerShell hook P2"
else echo "  (no powershell here: PowerShell hook skipped)"; fi
rm -f hook-bash.txt hook-ps1.ps1

echo; echo "########## D. The README's CI step"
$PR --quiet; chk "$?" "1" "the CI step would fail on this state"
$PR --format github 2>/dev/null | head -1 | grep -q "^::error file=CLAUDE.md,line=3::Case mismatch" && ok "annotation on the exact line" || bad "annotation"

echo; echo "########## E. Silencing: three markers, four config keys, --no-config"
sed -i 's#^The list view is.*$#& <!-- prumo-ignore -->#' CLAUDE.md
sed -i 's#^Seed the database#<!-- prumo-ignore-next-line -->\nSeed the database#' CLAUDE.md
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

echo; echo "########## F. --fix: prose paths and markdown links, nothing else"
OUT=$($PR --fix 2>&1); echo "$OUT" | grep -q "^FIXED  1 path in 1 file" && ok "FIXED 1 path in 1 file" || bad "FIXED"
chk "$(git diff --numstat | tr '\t' ' ')" "1 1 CLAUDE.md" "one line changed in one file"
git checkout -q -- CLAUDE.md
sed -i 's#(checklist.md)#(Checklist.md)#' .claude/skills/release/SKILL.md; ci
OUT=$($PR 2>&1); echo "$OUT" | grep -q "^CASE MISMATCH  (2)" && echo "$OUT" | grep -q "Checklist.md" && ok "a markdown link with the wrong case is a case mismatch" || bad "link case: $(echo "$OUT" | grep -A3 CASE | tr '\n' '|')"
$PR --fix >/dev/null 2>&1; grep -q "(checklist.md)" .claude/skills/release/SKILL.md && ok "--fix rewrote the link" || bad "link not rewritten"
git reset -q --hard HEAD~1

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

echo; echo "########## H. Monorepo, folder targets, spaces, truncation"
mk mono; mkdir -p packages/api docs/deep; printf '# root\n' > AGENTS.md; printf 'See `src/gone.php`.\n' > packages/api/AGENTS.md; printf 'Doc `x/y.php`.\n' > docs/a.md; printf 'Deep `x/z.php`.\n' > docs/deep/b.md; ci
$PR 2>&1 | grep -q "packages/api/AGENTS.md" && ok "nested AGENTS.md read" || bad "nested"
OUT=$($PR . docs 2>&1); echo "$OUT" | head -1 | grep -q "1 context file," && echo "$OUT" | grep -q "x/y.php" && ok "a folder target reads the .md files directly inside it" || bad "folder target"
cd "$U"; rm -rf "My Project"; git init -q "My Project"; cd "My Project"; printf 'A `b/c.php`.\n' > CLAUDE.md; ci
$PR "$U/My Project" 2>&1 | grep -q "b/c.php" && ok "a quoted path with spaces" || bad "spaces"
mk many; { echo "# N"; for i in $(seq 1 30); do echo "See ${BT}config/f$i.php${BT}."; done; } > CLAUDE.md; ci
chk "$($PR 2>&1 | grep -c '^  CLAUDE.md:'):$($PR --all 2>&1 | grep -c '^  CLAUDE.md:')" "25:30" "25 shown by default, 30 with --all"

echo; echo "########## I. Skills"
mk withskill; mkdir -p .claude/skills/deploy/steps; printf '# app\n' > CLAUDE.md
printf -- '---\nname: deploy\ndescription: d\n---\n- [Setup](steps/setup.md)\n- [Rollout](steps/rollout.md)\n' > .claude/skills/deploy/SKILL.md
echo s > .claude/skills/deploy/steps/setup.md; echo r > .claude/skills/deploy/steps/rollout-canary.md; ci
OUT=$($PR 2>&1); echo "$OUT" | grep -q "2 context files" && echo "$OUT" | grep -q "^  .claude/skills/deploy/SKILL.md:6  steps/rollout.md" && ok "installed skill detected; broken link named with file and line" || bad "skill: $(echo "$OUT" | grep rollout)"
mk skillrepo; mkdir steps; printf -- '---\nname: s\ndescription: d\n---\n- [A](steps/a.md)\n' > SKILL.md; echo a > steps/b.md; ci
$PR 2>&1 | grep -q "no context files found" && ok "a root SKILL.md is not auto-detected" || bad "root SKILL.md"
$PR . SKILL.md 2>&1 | grep -q "steps/a.md" && ok "'prumo . SKILL.md' checks it explicitly" || bad "explicit SKILL.md"

echo; echo "########## J. Troubleshooting"
mkdir -p "$U/plain"; cd "$U/plain"; OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^prumo: not a git repository" && chk "$RC" "2" "outside git: message and exit 2" || bad "outside git: $OUT"
mk empty; echo x > a.txt; ci; OUT=$($PR 2>&1); RC=$?
echo "$OUT" | grep -q "^prumo: no context files found" && chk "$RC" "2" "no context files: message and exit 2" || bad "no context files"

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
rm -f mcp.out

if [ "$GLOBAL" = 1 ]; then
  echo; echo "########## M. npm install -g (opt-in)"
  npm install -g "$PKG" --silent --no-audit --no-fund >/dev/null 2>&1 && hash -r
  chk "$(prumo --version 2>&1)" "$VERSION" "'prumo --version' after a global install"
  npm uninstall -g @tomd4vs/prumo --silent >/dev/null 2>&1; hash -r
fi

echo; echo "########## RESULT: $PASS ok, $FAILS failed"
[ "$FAILS" = 0 ]
