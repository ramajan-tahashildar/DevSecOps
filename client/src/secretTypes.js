/** Mirrors server `validateSecret.js` REQUIRED_FIELDS */
export const SECRET_FIELD_MAP = {
  docker: [
    { key: "username", label: "Username", type: "text" },
    { key: "password", label: "Password", type: "password" },
  ],
  git: [{ key: "token", label: "Token / PAT", type: "password" }],
  aws: [
    { key: "accessKey", label: "Access key ID", type: "text" },
    { key: "secretKey", label: "Secret access key", type: "password" },
  ],
  azure: [
    { key: "clientId", label: "Client ID", type: "text" },
    { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "tenantId", label: "Tenant ID", type: "text" },
  ],
  gcp: [{ key: "jsonKey", label: "Service account JSON", type: "textarea" }],
};

export const SECRET_TYPE_LABELS = {
  docker: "Docker registry",
  git: "Git (token)",
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
};
