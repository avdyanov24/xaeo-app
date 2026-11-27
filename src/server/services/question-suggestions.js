/**
 * Buyer questions for a new client, written from fixed templates and the client's own details.
 * Nothing is looked up and no model is called: the same details always give the same questions.
 * The first five are switched on; the last, which names the client, is offered but off, because it
 * shows what engines say to someone who already knows the name rather than to a new buyer.
 */

const MAX_TEXT = 200;

/**
 * @param {{ name: string, type?: string, city?: string }} details
 * @returns {{ text: string, intent: 'find' | 'compare' | 'urgent' | 'trust', on: boolean }[]}
 */
export function suggestQuestions({ name, type = '', city = '' }) {
  // "Who is the best plumber in Leeds?" reads naturally; with no type or city it still has to make sense.
  const what = type.trim().toLowerCase() || 'local business';
  const where = city.trim() ? ` in ${city.trim()}` : '';
  const templates = [
    ['find', `Who is the best ${what}${where}?`],
    ['urgent', `Which ${what}${where} can help me today?`],
    ['compare', `What are the best-reviewed ${what} companies${where}?`],
    ['trust', `How do I find a trustworthy ${what}${where}?`],
    ['compare', `How do I choose a ${what}${where}?`],
    ['trust', `Is ${name.trim()} a good ${what}${where}?`],
  ];
  return templates.map(([intent, text], index) => ({
    text: text.slice(0, MAX_TEXT),
    intent,
    on: index < 5,
  }));
}
