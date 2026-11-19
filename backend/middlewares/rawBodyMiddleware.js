/**
 * Preserves the unparsed raw request buffer on `req.rawBody` for cryptographic signature verification.
 * Used inside express.json() verify callback or as custom middleware.
 */
export const captureRawBody = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
};
