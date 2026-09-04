/**
 * 🎲 Spintax (Spin Syntax) Parser Module
 * Supports single, double, and triple bracket variations:
 * {{option 1 | option 2 | option 3}} or {{{a | b}}} or {a | b}
 * Safely resolves nested variations from innermost to outermost.
 */

export function parseSpintax(text = '') {
  if (!text || typeof text !== 'string') return '';

  let current = text;
  // Match innermost spintax patterns containing a pipe '|' and no inner braces
  const spintaxRegex = /(\{{1,3})([^{}]+?\|[^{}]+?)(\}{1,3})/;

  let iterations = 0;
  while (spintaxRegex.test(current) && iterations < 25) {
    current = current.replace(spintaxRegex, (_, openBraces, choices, closeBraces) => {
      const options = choices.split('|').map((c) => c.trim());
      const chosen = options[Math.floor(Math.random() * options.length)];
      // Consume equal number of braces from opening and closing
      const matchCount = Math.min(openBraces.length, closeBraces.length);
      const remainingOpen = openBraces.slice(matchCount);
      const remainingClose = closeBraces.slice(matchCount);
      return remainingOpen + chosen + remainingClose;
    });
    iterations++;
  }

  return current;
}
