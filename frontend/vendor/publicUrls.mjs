export function appUrl(base, path = '') {
  return new URL(
    path.replace(/^\/+/, ''),
    base.replace(/\/?$/, '/')
  ).toString();
}

export function publicOrigin(value) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new Error(
      'Public site URL must be an HTTP(S) origin without a path or credentials.'
    );
  }
  return url.origin;
}
