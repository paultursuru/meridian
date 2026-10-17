// Requests relayed by the site's nginx all come from the Fly machine, so
// CF-Connecting-IP would put every visitor in one rate-limit bucket. nginx
// forwards the visitor's IP in X-Client-IP, and it is only believed alongside
// the shared secret: otherwise anyone could name their own IP and dodge the
// limit.
export function clientIp(request, secret) {
  const relayed = request.headers.get('X-Client-IP');
  if (relayed && secret && request.headers.get('X-Edge-Secret') === secret) return relayed;
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}
