import * as answers from '../../repositories/answer-repository.js';
import * as fixes from '../../repositories/fix-repository.js';
import * as scans from '../../repositories/scan-repository.js';
import { loadAnswerSet } from '../engines/sample-answers.js';

const SITE = 'https://northsideplumbing.co.uk';

/**
 * The example client's four fixes, in rank order. `evidence` names the baseline answers each fix is
 * linked to as [question number in the answer set, engine]; every fix is expected to win back one
 * answer, so finishing all four estimates 6 of 10 against the baseline of 2. The first fix is
 * already shipped. Facts the site would have to state (phone, address, fees) are left as FILL_IN_
 * values: nothing here guesses a fact about the business.
 */
const NORTHSIDE_FIXES = Object.freeze([
  {
    title: 'Add LocalBusiness structured data to the home page',
    type: 'jsonld',
    impact: 'High',
    evidence: 'Strong',
    url: `${SITE}/`,
    engines: ['chatgpt', 'claude'],
    why: 'Asked how to find a trustworthy plumber in Leeds, neither engine named Northside. Structured data states who Northside is, where it works and how to reach it in a form assistants read directly.',
    lang: 'jsonld',
    code: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Plumber",
  "name": "Northside Plumbing",
  "url": "${SITE}/",
  "telephone": "FILL_IN_PHONE",
  "areaServed": { "@type": "City", "name": "Leeds" },
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "FILL_IN_STREET",
    "addressLocality": "Leeds",
    "addressCountry": "GB"
  }
}
</script>`,
    verify:
      'View the page source and find the JSON-LD block with the real phone number and address in place of every FILL_IN_ value.',
    shipped: true,
    answers: [
      [4, 'chatgpt'],
      [4, 'claude'],
    ],
  },
  {
    title: 'Publish an emergency plumber page for Leeds',
    type: 'page',
    impact: 'High',
    evidence: 'Medium',
    url: `${SITE}/emergency-plumber-leeds`,
    engines: ['chatgpt'],
    why: 'Asked who the best emergency plumber in Leeds is, ChatGPT recommended Rapid Flow and CityPipe and did not name Northside. Claude does name Northside second, so a page that answers the question directly gives ChatGPT the same material.',
    lang: 'markdown',
    code: `# Emergency plumber in Leeds

Open with one plain sentence: who Northside Plumbing is, where it works and what it fixes out of hours.

## When to call
List the emergencies Northside really attends.

## What happens after you call
- Arrival time: FILL_IN_ARRIVAL_TIME
- Call-out fee: FILL_IN_FEE

## Contact
- Phone: FILL_IN_PHONE`,
    verify:
      'Open the new page, check the arrival time and fee are stated, then ask ChatGPT the emergency question again after the next scan.',
    answers: [[0, 'chatgpt']],
  },
  {
    title: 'Add a boiler leak repair page',
    type: 'page',
    impact: 'Medium',
    evidence: 'Strong',
    url: `${SITE}/boiler-leak-repairs`,
    engines: ['chatgpt', 'claude'],
    why: 'Asked which plumber to call for a leaking boiler, both engines named CityPipe, and Claude named Rapid Flow too. Neither named Northside; a page about boiler leaks gives them something to cite.',
    lang: 'markdown',
    code: `# Leaking boiler repairs in Leeds

## What to do first
Switch the boiler off and keep a bowl under the leak.

## Who does the repair
State that a gas-registered engineer attends: FILL_IN_GAS_SAFE_NUMBER

## Contact
- Phone: FILL_IN_PHONE`,
    verify:
      'Open the new page and confirm the registration number is correct, then check the boiler question on the next scan.',
    answers: [
      [1, 'chatgpt'],
      [1, 'claude'],
    ],
  },
  {
    title: 'Describe bathroom fitting on the services page',
    type: 'copy',
    impact: 'Medium',
    evidence: 'Strong',
    url: `${SITE}/services`,
    engines: ['chatgpt', 'claude'],
    why: 'Asked who fits new bathrooms in Leeds, ChatGPT named Rapid Flow and Claude named CityPipe. Neither named Northside; the services page is where it should say it fits bathrooms.',
    lang: 'text',
    code: `[ ] Add a "Bathroom fitting" heading to the services page
[ ] Say in one sentence that Northside fits complete bathrooms in Leeds
[ ] List what is included: FILL_IN_SCOPE
[ ] Link to a page with photos of finished work`,
    verify:
      'Read the services page for a bathroom fitting section, then check the bathroom question on the next scan.',
    answers: [
      [2, 'chatgpt'],
      [2, 'claude'],
    ],
  },
]);

/**
 * Adds the example client's four fixes, linked to the answers of its baseline scan. A client that
 * already has fixes is left alone, so this can run on every seed. Call it inside a transaction.
 * The shipped fix is marked done at the moment the baseline finished, so it is awaiting a rescan.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} workspaceId
 * @param {number} clientId
 * @param {{ answerSet?: ReturnType<typeof loadAnswerSet> }} [options]
 * @returns {boolean} whether the fixes were added by this call
 */
export function addSampleFixes(db, workspaceId, clientId, { answerSet = loadAnswerSet() } = {}) {
  if (fixes.countFixes(db, workspaceId, clientId).total > 0) return false;
  const baseline = scans
    .listScans(db, workspaceId, clientId)
    .findLast((scan) => scan.state === 'done');
  const rows = baseline ? answers.listAnswers(db, workspaceId, baseline.id) : [];
  const answerId = ([question, engine]) =>
    rows.find((row) => row.questionText === answerSet.questions[question] && row.engine === engine)
      ?.id;

  for (const { answers: linked, shipped, ...fix } of NORTHSIDE_FIXES)
    fixes.insertFix(db, {
      workspaceId,
      clientId,
      ...fix,
      gain: 1,
      status: shipped ? 'done' : 'todo',
      doneAt: shipped && baseline ? baseline.finishedAt : null,
      answerIds: linked.map(answerId).filter((id) => id !== undefined),
    });
  return true;
}
