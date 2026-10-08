#!/bin/bash
# File: scripts/gcp-start.sh
# Restores all GCP services

PROJECT="renovix-ai-prod"
REGION="asia-southeast2"

echo "▶️  Starting all services for $PROJECT..."

# 1. Start Cloud SQL
echo "→ Starting Cloud SQL..."
gcloud sql instances patch renovix-db-${REGION} \
  --activation-policy=ALWAYS \
  --project=$PROJECT

echo "→ Waiting for Cloud SQL to be ready..."
gcloud sql instances describe renovix-db-${REGION} \
  --project=$PROJECT \
  --format="value(state)" | grep -q "RUNNABLE" || sleep 30

# 2. Recreate VPC Connectorz
echo "→ Creating VPC Connector..."
gcloud compute networks vpc-access connectors create renovix-connector \
  --region=$REGION \
  --network=renovix-vpc \
  --range=10.8.0.0/28 \
  --machine-type=e2-micro \
  --min-instances=2 \
  --max-instances=3 \
  --project=$PROJECT

# 3. Restore Cloud Run services (set max instances back)
echo "→ Restoring Cloud Run services..."
gcloud run services update renovix-api \
  --region=$REGION \
  --project=$PROJECT \
  --max-instances=10

for SERVICE in renovix-chat renovix-dashboard renovix-landing; do
  gcloud run services update $SERVICE \
    --region=$REGION \
    --project=$PROJECT \
    --max-instances=5
done

# 4. Restore Load Balancer (re-apply terraform is cleanest)
echo "→ Restoring Load Balancer..."
echo "  Run: cd infra && terraform apply -target=module.cdn"
echo "  Or manually recreate forwarding rules below:"

# Recreate HTTPS proxy
gcloud compute target-https-proxies create renovix-https-proxy \
  --url-map=renovix-url-map \
  --ssl-certificates=renovix-ssl-cert \
  --project=$PROJECT

# Recreate forwarding rule
gcloud compute forwarding-rules create renovix-https-rule \
  --global \
  --target-https-proxy=renovix-https-proxy \
  --ports=443 \
  --project=$PROJECT

echo ""
echo "✅ All services restored!"
echo "🔍 Verify: gcloud run services list --project=$PROJECT --region=$REGION"