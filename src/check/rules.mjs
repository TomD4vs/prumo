/**
 * Decides one citation by an ordered list of rules: the first whose `when` holds decides, so the
 * order of the list is the order the checks ask in. What it decided is noted for `--explain`, before
 * the rule's `act` does what the decision means, a finding pushed or a path cited: the outcome, the
 * reason in words, and for a citation that resolved, the file it reached. A rule's `reason` and `to`
 * may be functions of the citation.
 */
export function decide(rules, x) {
  const rule = rules.find((r) => r.when(x));
  if (!rule) return;
  const reason = typeof rule.reason === 'function' ? rule.reason(x) : rule.reason;
  const to = rule.to ? rule.to(x) : undefined;
  x.run.note(x.file, x.i, { kind: x.kind, cited: x.cited, outcome: rule.outcome, reason, ...(to ? { to } : {}) });
  if (rule.act) rule.act(x);
}
