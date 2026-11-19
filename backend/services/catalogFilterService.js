import { AppError } from '../utils/AppError.js';

export function applyCatalogFilters(query, params) {
  if (Object.keys(params).some(key => /^(minPrice|maxPrice|inStock|onSale)\[/.test(key))) throw new AppError(400, 'INVALID_CATALOG_FILTER', 'Use one value for each catalog filter.');
  const prices = {};
  for (const [key, operator] of [
    ['minPrice', '$gte'],
    ['maxPrice', '$lte'],
  ]) {
    if (params[key] === undefined) continue;
    const value = params[key];
    if (
      typeof value !== 'string' ||
      !/^\d+(?:\.\d{1,2})?$/.test(value) ||
      !Number.isFinite(Number(value)) ||
      Number(value) > Number.MAX_SAFE_INTEGER / 100
    ) {
      throw new AppError(
        400,
        'INVALID_PRICE_FILTER',
        'Use a valid non-negative price with up to two decimal places.'
      );
    }
    prices[operator] = Number(value);
  }
  if (
    prices.$gte !== undefined &&
    prices.$lte !== undefined &&
    prices.$gte > prices.$lte
  )
    throw new AppError(
      400,
      'INVALID_PRICE_FILTER',
      'Minimum price must not exceed maximum price.'
    );
  if (Object.keys(prices).length) query.price = prices;
  const expressions = query.$expr ? [query.$expr] : [];
  for (const key of ['inStock', 'onSale'])
    if (params[key] !== undefined && !['true', 'false'].includes(params[key]))
      throw new AppError(
        400,
        'INVALID_CATALOG_FILTER',
        'Choose a valid availability or discount filter.'
      );
  const anyAvailable = (array, stock, held, minimum) => ({
    $anyElementTrue: [
      {
        $map: {
          input: { $ifNull: [array, []] },
          as: 'v',
          in: {
            $gte: [
              { $subtract: [{ $ifNull: [stock, 0] }, { $ifNull: [held, 0] }] },
              minimum,
            ],
          },
        },
      },
    ],
  });
  if (params.inStock === 'true')
    expressions.push({
      $cond: [
        { $eq: ['$productType', 'fabric'] },
        anyAvailable(
          '$colorVariants',
          '$$v.rollStockHalfYards',
          '$$v.reservedHalfYards',
          2
        ),
        anyAvailable('$sizes', '$$v.stock', '$$v.reservedStock', 1),
      ],
    });
  if (params.onSale === 'true')
    expressions.push({ $gt: ['$originalPrice', '$price'] });
  if (expressions.length)
    query.$expr =
      expressions.length === 1 ? expressions[0] : { $and: expressions };
  return query;
}
