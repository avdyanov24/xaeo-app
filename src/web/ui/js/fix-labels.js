// Diagnostic "fixes" record that the website could not be inspected. They are not ranked work: they never lead
// the overview's next step, they sit below the ranked list, and they get a plain-words title.
// The server marks them with kind:'diagnostic' and diagnostic:{observationId,outcome,checkedAt,simulated}.
// Done/won't-do rows saved before that change keep the old title "Review website inspection: <outcome>" and an
// internal "why", so the title match stays only as a fallback for those rows.
const LEGACY = /^Review website inspection\b/i;
export const isDiagnostic = (f) =>
  f?.kind ? f.kind === 'diagnostic' : LEGACY.test(f?.title || '');
const simulated = (f) =>
  f?.diagnostic ? f.diagnostic.simulated === true : /Synthetic scan/i.test(f?.why || '');

export const fixTitle = (f) =>
  !isDiagnostic(f)
    ? f.title
    : simulated(f)
      ? 'We couldn’t check the website for sample data'
      : 'We couldn’t inspect the website';

// New diagnostics already carry a plain-words "why" from the server. Legacy rows carry record ids and ISO
// timestamps, so they get plain words here; the saved observation stays reviewable under "How we checked this".
export const fixWhy = (f) => {
  if (!isDiagnostic(f) || f.diagnostic) return f.why;
  if (simulated(f))
    return 'Sample scans use scripted answers, so the website itself was not fetched. A scan of a live website can check the page and its schema.';
  const outcome = (String(f.title || '').split(':')[1] || '').trim();
  return `The scan could not read the website${outcome ? ` (result: ${outcome})` : ''}. Check that the page loads publicly, then run the next scan.`;
};

// Ranked work only: the diagnostic never counts as a fix in badges, counts or progress.
export const rankedTodo = (fixes) =>
  (fixes || []).filter((f) => f.status === 'todo' && !isDiagnostic(f)).length;
