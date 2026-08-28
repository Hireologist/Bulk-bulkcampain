/**
 * 🎲 Spintax (Spin Syntax) Parser Module
 * Supports single, double, and triple bracket variations:
 * {{option 1 | option 2 | option 3}} or {{{a | b}}} or {a | b}
 */

export function parseSpintax(text = '') {
  if (!text || typeof text !== 'string') return '';

  let current = text;
  // Match spintax patterns with 1, 2, or 3 curly braces containing pipe '|'
  const spintaxRegex = /\{{1,3}([^{}]+?\|[^{}]+?)\}{1,3}/g;

  let iterations = 0;
  while (spintaxRegex.test(current) && iterations < 10) {
    current = current.replace(spintaxRegex, (_, choices) => {
      const options = choices.split('|').map((c) => c.trim());
      return options[Math.floor(Math.random() * options.length)];
    });
    iterations++;
  }

  return current;
}
