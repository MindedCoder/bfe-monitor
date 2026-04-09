#!/usr/bin/env bash
# Apply all k8s manifests for bfe-monitor and roll the deployment.
# Secret files (k8s/*-secret.yaml) are gitignored — they must exist locally.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="bfe"
DEPLOYMENT="bfe-monitor"

# kubectl 走代理会连不上 API server
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy

echo "[deploy] applying manifests in ${SCRIPT_DIR}"
shopt -s nullglob
files=("${SCRIPT_DIR}"/*.yaml)
if [ ${#files[@]} -eq 0 ]; then
  echo "[deploy] no yaml files found"; exit 1
fi
for f in "${files[@]}"; do
  echo "  - $(basename "$f")"
  kubectl apply -f "$f"
done

echo "[deploy] rolling deployment ${NAMESPACE}/${DEPLOYMENT}"
kubectl -n "${NAMESPACE}" rollout restart deployment/"${DEPLOYMENT}"
kubectl -n "${NAMESPACE}" rollout status deployment/"${DEPLOYMENT}" --timeout=120s

echo "[deploy] done"
