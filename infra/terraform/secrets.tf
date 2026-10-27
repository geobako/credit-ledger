# Every credential the services need, generated here and stored in Secrets Manager under a
# customer-managed key. Tasks receive them as environment variables at start; nothing is baked
# into images or task definitions. Note: generated values also live in Terraform state, which is
# why the state bucket is encrypted, versioned and access-restricted.

resource "random_password" "webhook_secret" {
  length  = 48
  special = false
}

resource "random_password" "gateway_shared_secret" {
  length  = 48
  special = false
}

resource "random_password" "network_api_key" {
  length  = 40
  special = false
}

resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

# Signing key of the (simulated) identity provider. With a real IdP the API would only hold
# the IdP's public JWKS URL and this key would not exist.
resource "tls_private_key" "jwt" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

locals {
  secrets = {
    "webhook-secret"        = random_password.webhook_secret.result
    "gateway-shared-secret" = random_password.gateway_shared_secret.result
    "network-api-key"       = random_password.network_api_key.result
    "jwt-private-key"       = tls_private_key.jwt.private_key_pem_pkcs8
    "jwt-public-key"        = tls_private_key.jwt.public_key_pem
    "database-url"          = "postgres://${aws_db_instance.main.username}:${random_password.db_master.result}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}?sslmode=verify-full"
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each                = local.secrets
  name                    = "${local.name}/${each.key}"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = local.is_production ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "app" {
  for_each      = local.secrets
  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = each.value
}
