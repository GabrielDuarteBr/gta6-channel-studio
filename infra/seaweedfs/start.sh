#!/bin/sh
# Gera a configuração de credenciais do S3 a partir do ambiente e sobe o SeaweedFS
# em modo "mini" (master + volume + filer + S3 num processo só).
set -eu
: "${S3_ACCESS_KEY:?defina S3_ACCESS_KEY}"
: "${S3_SECRET_KEY:?defina S3_SECRET_KEY}"
umask 077
printf '{"identities":[{"name":"studio","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}\n' \
  "$S3_ACCESS_KEY" "$S3_SECRET_KEY" > /tmp/s3.json
exec /usr/bin/weed -logtostderr=true mini -dir=/data -s3.config=/tmp/s3.json -bucket="${S3_BUCKET:-studio}" -admin.ui=false
