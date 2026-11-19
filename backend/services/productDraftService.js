import { z } from 'zod';
export const materials = [
  'Cotton',
  'Linen',
  'Silk',
  'Wool',
  'Denim',
  'Chiffon',
  'Satin',
  'Ankara',
  'Lace',
  'Polyester',
  'Velvet',
  'Crepe',
  'Other',
];
const label = z.string().trim().min(1).max(40);
const count = z.number().int().min(0).max(1000000);
const factsSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    productType: z.enum(['retail', 'fabric']).optional(),
    category: label.optional(),
    price: z
      .number()
      .finite()
      .positive()
      .max(100000000)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001)
      .optional(),
    description: z.string().trim().min(1).max(600).optional(),
    material: z.enum(materials).optional(),
    variants: z
      .array(z.object({ size: label, color: label, stock: count }).strict())
      .min(1)
      .max(10)
      .optional(),
    rolls: z
      .array(z.object({ colorName: label, halfYards: count }).strict())
      .min(1)
      .max(10)
      .optional(),
  })
  .strict();
const money = (value) => {
  const match = String(value)
    .trim()
    .match(
      /^(?:₦|ngn\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?(?:\s*(?:naira|per yard|\/yd))?$/i
    );
  return match
    ? Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1)
    : NaN;
};
// Extract only stated facts. Unknown stock, material, size and colour stay unknown.
export function parseStatedFacts(text = '') {
  if (text.length > 4000) throw new Error('DRAFT_TEXT_TOO_LONG');
  const facts = {},
    errors = [];
  const lines = text
    .split(/\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  const labels = new Set();
  for (const line of lines) {
    const match = line.match(
      /^(name|type|category|price|description|material|variants|rolls|stock)\s*:\s*(.*)$/i
    );
    if (!match) continue;
    const key = match[1].toLowerCase(),
      value = match[2].trim();
    if (labels.has(key)) {
      errors.push(`Use one ${key} line.`);
      continue;
    }
    labels.add(key);
    if (key === 'name' || key === 'category' || key === 'description')
      facts[key] = value;
    if (key === 'type') facts.productType = value.toLowerCase();
    if (key === 'price') facts.price = money(value);
    if (key === 'material')
      facts.material =
        materials.find((v) => v.toLowerCase() === value.toLowerCase()) || value;
    if (key === 'variants')
      facts.variants = value.split(';').map((part) => {
        const bits = part.split('/').map((v) => v.trim());
        return {
          size: bits[0],
          color: bits[1],
          stock:
            bits.length === 3 && /^\d+$/.test(bits[2]) ? Number(bits[2]) : NaN,
        };
      });
    if (key === 'rolls')
      facts.rolls = value.split(';').map((part) => {
        const bits = part.split('/').map((v) => v.trim());
        return {
          colorName: bits[0],
          halfYards:
            bits.length === 2 && /^\d+(?:\.5|\.0)?$/.test(bits[1])
              ? Number(bits[1]) * 2
              : NaN,
        };
      });
    // "Stock" alone is ambiguous: require an explicitly named size/colour combination.
    if (key === 'stock')
      errors.push(
        'Use Variants: size / colour / units, or Rolls: colour or pattern / yards.'
      );
  }
  if (!labels.size) {
    const first = text.split(/,|\n/)[0]?.trim();
    if (first?.length >= 2 && first.length <= 200) facts.name = first;
    const prices = [
      ...text.matchAll(
        /(?:₦|ngn\s*)(\d[\d,]*(?:\.\d{1,2})?\s*k?)|\b(\d[\d,]*(?:\.\d{1,2})?\s*k)\b|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:naira|per yard|\/yd)/gi
      ),
    ];
    if (prices.length === 1)
      facts.price = money(prices[0][1] || prices[0][2] || prices[0][3]);
  }
  // Reject invalid fields individually so valid corrections survive; errors block save until corrected.
  const valid = {};
  for (const [key, value] of Object.entries(facts)) {
    const result = factsSchema.shape[key].safeParse(value);
    if (result.success) valid[key] = result.data;
    else errors.push(`Check ${key}; use the format in /help.`);
  }
  return { facts: valid, errors };
}
export function validateDraft(facts, images = []) {
  const parsed = factsSchema.safeParse(facts),
    missing = [];
  if (!parsed.success) return ['Check product details using /help.'];
  for (const key of ['name', 'productType', 'category', 'price'])
    if (facts[key] === undefined)
      missing.push(key === 'productType' ? 'type (retail or fabric)' : key);
  if (!images.length || !images.every((v) => /^https:\/\//.test(v)))
    missing.push('a product photo');
  if (facts.productType === 'retail' && !facts.variants?.length)
    missing.push(
      'Variants: size / colour / units (use Standard if there is no size or colour)'
    );
  if (facts.productType === 'fabric') {
    if (!facts.material) missing.push('material (use Other if unknown)');
    if (!facts.rolls?.length) missing.push('Rolls: colour or pattern / yards');
    if (facts.category !== 'Fabrics') missing.push('Category: Fabrics');
  }
  const entries = facts.productType === 'fabric' ? facts.rolls : facts.variants;
  const keys = (entries || []).map((v) =>
    (v.colorName || `${v.size}|${v.color}`).toLowerCase()
  );
  if (new Set(keys).size !== keys.length)
    missing.push('each stock combination once');
  return missing;
}
export const draftHelp =
  'Send a photo, then add or correct details in the same chat.\n\nName: Linen shirt\nType: retail\nCategory: Men\nPrice: 15000\nVariants: M / Navy / 2; L / Navy / 0\n\nFor fabric:\nType: fabric\nCategory: Fabrics\nMaterial: Linen\nRolls: Indigo / 12.5; White / 0\n\nUse Standard for a product without a size or colour. Review the exact balances, then Save product. /new starts another draft; /cancel discards the current draft; /draft resumes it. Voice notes require separately enabled AI and confirmation. /status and /stock show store information.';
