// Plain-text handoff only. Exporting never creates or updates an external ticket.
export function ticketMarkdown(fix, client) {
  const evidence = (fix.evidenceAnswers || []).map(
    (answer) =>
      `- ${answer.engine}: “${answer.question}” - ${answer.label}; original answer ID: ${answer.id}`,
  );
  return [
    `## ${fix.title}`,
    '',
    `**Fix ID:** ${fix.id}`,
    `**Client:** ${client.name} (${client.domain})`,
    `**Page:** ${fix.url}`,
    `**Engines:** ${fix.engines.join(', ') || 'All'}`,
    `**Priority:** ${fix.impact} · **Evidence:** ${fix.evidence}`,
    '',
    '### Handoff identity',
    'Use the Fix ID to find and update the existing ticket when exporting again. Do not create a duplicate.',
    'External ticket completion is reported status; website implementation must be checked separately.',
    '',
    '### Original answer evidence',
    ...(evidence.length
      ? evidence
      : ['No linked answer observation; this remains an unverified hypothesis.']),
    '',
    '### Context',
    fix.why,
    '',
    '### Draft change',
    `\`\`\`${fix.lang === 'text' ? '' : fix.lang}`,
    fix.code,
    '```',
    '',
    '### Acceptance criteria',
    '- [ ] Confirm the website facts and replace every placeholder before publishing.',
    `- [ ] The change is live on ${fix.url}`,
    `- [ ] ${fix.verify}`,
    '- [ ] Record dated website evidence separately from any later visibility observation.',
  ].join('\n');
}
