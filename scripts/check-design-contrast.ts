/** Prints the WCAG contrast ratio of the StyleGuide text pairs and exits 1 below AA (4.5). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Pair = { label: string; foreground: string; background: string; documented: number };

const PALETTE: Record<string, string> = JSON.parse(
  readFileSync(join(import.meta.dir, '../design/tokens.json'), 'utf8'),
).palette;
const MINIMUM_RATIO = 4.5;
const PAIRS: Pair[] = [
  { label: 'Ink on white', foreground: 'ink', background: 'white', documented: 17 },
  { label: 'Muted on white', foreground: 'ink-muted', background: 'white', documented: 6.1 },
  { label: 'Teal 700 on white', foreground: 'teal-700', background: 'white', documented: 6.0 },
  { label: 'White on Teal 700', foreground: 'white', background: 'teal-700', documented: 6.0 },
  { label: 'Teal 700 on Teal 100', foreground: 'teal-700', background: 'teal-100', documented: 5.1 },
  { label: 'Ink 300 on Ink', foreground: 'ink-300', background: 'ink', documented: 9.0 },
  { label: 'Amber text on amber tint', foreground: 'amber-text', background: 'amber-tint', documented: 7.5 },
  { label: 'Red text on red tint', foreground: 'red-text', background: 'red-tint', documented: 8.6 },
];

const toLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const getLuminance = (hex: string): number => {
  const [red, green, blue] = [1, 3, 5].map((start) => toLinear(parseInt(hex.slice(start, start + 2), 16)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const getRatio = (foreground: string, background: string): number => {
  const [light, dark] = [getLuminance(foreground), getLuminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

let hasFailure = false;
for (const pair of PAIRS) {
  const ratio = getRatio(PALETTE[pair.foreground], PALETTE[pair.background]);
  const isPass = ratio >= MINIMUM_RATIO;
  hasFailure ||= !isPass;
  console.log(`${pair.label.padEnd(26)} ${ratio.toFixed(2).padStart(6)} : 1  (documented ${pair.documented})  ${isPass ? 'AA pass' : 'FAIL'}`);
}
process.exit(hasFailure ? 1 : 0);
