#!/bin/sh
# Executa um comando de build confiando numa CA extra, se o segredo de build
# "extra_ca" existir (redes com proxy corporativo). Sem o segredo, só executa.
set -eu
if [ -s /run/secrets/extra_ca ]; then
  bundle=/tmp/ca-bundle.pem
  cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca > "$bundle" 2>/dev/null || cp /run/secrets/extra_ca "$bundle"
  export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca
  export SSL_CERT_FILE="$bundle" CURL_CA_BUNDLE="$bundle" REQUESTS_CA_BUNDLE="$bundle" PIP_CERT="$bundle"
fi
# Atrás de proxy, faz o Node (ex.: download do Chrome do Remotion) respeitar HTTPS_PROXY.
if [ -n "${HTTPS_PROXY:-}${https_proxy:-}" ]; then
  export NODE_USE_ENV_PROXY=1
fi
exec "$@"
