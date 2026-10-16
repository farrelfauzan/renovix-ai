export function isRetryableError(error: any): boolean {
  // Connection/timeout errors are retryable
  if (error?.code === "ECONNREFUSED" || error?.code === "ETIMEDOUT") {
    return true;
  }
  // 5xx from SMTP are retryable
  if (error?.responseCode && error.responseCode >= 500) {
    return true;
  }
  // 4xx from SMTP are generally not retryable (except 421)
  if (error?.responseCode === 421) {
    return true;
  }
  return false;
}
