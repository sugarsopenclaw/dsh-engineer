#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="${ROOT}/dev/backend"
RELEASE="${ROOT}/dev/release"

usage() {
  echo "用法: $0 backend|release|all [--pull]" >&2
  exit 1
}

TARGET="${1:-}"
PULL=false
if [[ "${TARGET}" == "--pull" ]]; then
  PULL=true
  TARGET="${2:-all}"
elif [[ "${2:-}" == "--pull" ]]; then
  PULL=true
fi

[[ "${TARGET}" =~ ^(backend|release|all)$ ]] || usage

if ${PULL}; then
  git -C "${ROOT}" pull --ff-only
fi

if [[ -z "${DEPLOY_IMAGE_TAG:-}" ]]; then
  DEPLOY_IMAGE_TAG="$(git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
fi
export DEPLOY_IMAGE_TAG

deploy_backend() {
  [[ -f "${BACKEND}/.env" ]] || {
    echo "缺少 ${BACKEND}/.env" >&2
    exit 1
  }
  [[ -f "${BACKEND}/wechatpay_key/apiclient_key.pem" ]] || {
    echo "缺少微信支付私钥 ${BACKEND}/wechatpay_key/apiclient_key.pem" >&2
    exit 1
  }

  echo ">>> 部署 backend: xiaoliang-backend:${DEPLOY_IMAGE_TAG}"
  docker compose \
    --project-directory "${BACKEND}" \
    -f "${BACKEND}/docker-compose.backend.yml" \
    up -d --build --force-recreate --wait --wait-timeout 120
  curl -fsS --max-time 10 http://127.0.0.1:18092/health >/dev/null
}

deploy_release() {
  echo ">>> 部署 release: xiaoliang-release:${DEPLOY_IMAGE_TAG}"
  docker compose \
    --project-directory "${RELEASE}" \
    -f "${RELEASE}/docker-compose.release.yml" \
    up -d --build --force-recreate --wait --wait-timeout 120
  curl -fsS --max-time 10 http://127.0.0.1:18093/health >/dev/null
}

case "${TARGET}" in
  backend)
    deploy_backend
    ;;
  release)
    deploy_release
    ;;
  all)
    deploy_backend
    deploy_release
    ;;
esac

echo ">>> 部署完成，镜像标签: ${DEPLOY_IMAGE_TAG}"
