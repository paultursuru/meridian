// navigator.geolocation.getCurrentPosition as a promise.
/** @returns {Promise<GeolocationPosition>} */
export function getPosition(timeoutMs) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: timeoutMs });
  });
}
