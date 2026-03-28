const REQUIRED_FIELDS = {
  docker: ["username", "password"],
  git: ["token"],
  aws: ["accessKey", "secretKey"],
  azure: ["clientId", "clientSecret", "tenantId"],
  gcp: ["jsonKey"],
};

/**
 * @param {string} type
 * @param {Record<string, unknown>} credentials
 */
export function validateSecretByType(type, credentials) {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    return { valid: false, message: "credentials must be an object" };
  }

  const fields = REQUIRED_FIELDS[type];
  if (!fields) {
    return { valid: false, message: "Invalid secret type" };
  }

  for (const field of fields) {
    const value = credentials[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      return { valid: false, message: `${field} is required for ${type}` };
    }
  }

  return { valid: true };
}
