// One caveat surface per screen: a single row of quiet chips plus one "About this scan" disclosure that keeps
// the full honest wording (evidence source, comparison limits, saved setup). Used by Overview and Answers.
import { h, icon } from './lib.js';
import { scanContextText, comparisonReasons } from './scan-context.js';

export function caveatRow({
  configuration,
  comparison,
  previousLabel = 'the previous scan',
  early = false,
  comparableText,
  baselineText,
  missingText,
}) {
  const context = scanContextText(configuration);
  const reasons = comparisonReasons(comparison);
  const comparable = comparison?.comparable === true;
  const chips = [
    h('span.cv-chip', icon('info', 14), context.evidenceLabel),
    comparison
      ? h('span.cv-chip', comparable ? `Comparable with ${previousLabel}` : 'New baseline')
      : null,
    early && comparable ? h('span.cv-chip', 'Early signal') : null,
  ].filter(Boolean);
  return h(
    'details.caveats',
    h(
      'summary',
      h('span.cv-chips', chips),
      h('span.cv-more', 'About this scan', icon('chevronDown', 14)),
    ),
    h(
      'div.cv-body',
      h('p.muted.small', comparable ? comparableText : baselineText),
      reasons.length
        ? h(
            'ul.scan-context-reasons',
            reasons.map((r) => h('li', r)),
          )
        : !comparison
          ? h(
              'p.muted.small',
              missingText || 'Comparison context was not recorded for this historical result.',
            )
          : null,
      h(
        'dl.scan-context-rows',
        context.rows.map(([label, value]) => h('div', h('dt', label), h('dd', value))),
      ),
      context.limitations.map((limit) => h('p.muted.small', limit)),
    ),
  );
}
