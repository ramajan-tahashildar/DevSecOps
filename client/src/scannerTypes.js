export const SCANNER_TYPES = ["docker", "sast", "aws", "azure", "gcp"];

export const SCANNER_TYPE_LABELS = {
  docker: "Container image",
  sast: "SAST (repository)",
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
};

export const DOCKER_REGISTRIES = [
  { value: "dockerhub", label: "Docker Hub" },
  { value: "ecr", label: "Amazon ECR" },
  { value: "gcr", label: "Google GCR" },
  { value: "acr", label: "Azure ACR" },
  { value: "private", label: "Private registry" },
];

export const SAST_TOOLS = [
  { value: "semgrep", label: "Semgrep" },
  { value: "sonarqube", label: "SonarQube" },
  { value: "eslint", label: "ESLint" },
];
