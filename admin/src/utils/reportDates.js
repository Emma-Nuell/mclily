export function localDate(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function reportDates(preset, now = new Date()) {
  const to = localDate(now);
  const date = new Date(to + 'T12:00:00Z');
  if (preset === 'month') return { from: to.slice(0, 8) + '01', to };
  date.setUTCDate(
    date.getUTCDate() - (preset === 'week' ? 6 : preset === 'today' ? 0 : 29)
  );
  return { from: date.toISOString().slice(0, 10), to };
}
