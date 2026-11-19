import { formatNaira } from '../utils/conversions';
import { Empty } from './AdminUI';
export default function SalesTrend({ daily }) {
  const max = Math.max(
    ...daily.flatMap((day) => [day.receivedKobo, day.refundsKobo]),
    0
  );
  if (!max)
    return (
      <Empty title="No money movements in this period.">
        Credit sales can still appear in the figures below.
      </Empty>
    );
  const width = 760,
    height = 240,
    left = 76,
    right = 18,
    top = 16,
    bottom = 38;
  const x = (index) =>
    left +
    (daily.length === 1
      ? (width - left - right) / 2
      : (index * (width - left - right)) / (daily.length - 1));
  const y = (value) => top + (1 - value / max) * (height - top - bottom);
  const points = (field) =>
    daily.map((day, index) => `${x(index)},${y(day[field])}`).join(' ');
  const dates = [
    ...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1]),
  ];
  return (
    <figure className="sales-trend">
      <figcaption>
        <h2>Money received and refunds</h2>
        <p className="row-meta">Daily amounts in naira · Nigerian time</p>
      </figcaption>
      <div className="chart-legend">
        <span>
          <i />
          Money received
        </span>
        <span className="refund">
          <i />
          Completed refunds
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily recorded money received and completed refunds; exact figures are available in Daily breakdown."
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={left}
              x2={width - right}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              stroke="var(--border-subtle)"
            />
            <text x={left - 10} y={y(max * fraction) + 4} textAnchor="end">
              {new Intl.NumberFormat('en-NG', {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format((max * fraction) / 100)}
            </text>
          </g>
        ))}
        <polyline
          points={points('receivedKobo')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
        />
        <polyline
          points={points('refundsKobo')}
          fill="none"
          stroke="var(--destructive)"
          strokeWidth="2.5"
          strokeDasharray="5 4"
        />
        {daily.length <= 31 &&
          daily.map((day, index) => (
            <g key={day.date}>
              <title>
                {day.date}: received {formatNaira(day.receivedKobo / 100)},
                refunds {formatNaira(day.refundsKobo / 100)}
              </title>
              <circle
                cx={x(index)}
                cy={y(day.receivedKobo)}
                r="3"
                fill="var(--accent)"
              />
              <circle
                cx={x(index)}
                cy={y(day.refundsKobo)}
                r="2.5"
                fill="var(--destructive)"
              />
            </g>
          ))}
        {dates.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={height - 12}
            textAnchor={
              daily.length === 1
                ? 'middle'
                : index === 0
                  ? 'start'
                  : index === daily.length - 1
                    ? 'end'
                    : 'middle'
            }
          >
            {new Date(daily[index].date + 'T12:00:00Z').toLocaleDateString(
              'en-NG',
              { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }
            )}
          </text>
        ))}
      </svg>
    </figure>
  );
}
