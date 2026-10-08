#!/bin/bash
# File: scripts/gcp-stop.sh
# Stops all GCP services to minimize billing

PROJECT="renovix-ai-prod"
REGION="asia-southeast2"

echo "⏹️  Stopping all services for $PROJECT..."

# 1. Stop Cloud SQL (biggest always-on cost)
echo "→ Stopping Cloud SQL..."
gcloud sql instances patch renovix-db-${REGION} \
  --activation-policy=NEVER \
  --project=$PROJECT

# 2. Delete VPC Connector (e2-micro VMs running 24/7)
echo "→ Deleting VPC Connector..."
gcloud compute networks vpc-access connectors delete renovix-connector \
  --region=$REGION \
  --project=$PROJECT \
  --quiet

# 3. Scale down all Cloud Run services to 0 max instances (effectively disable)
echo "→ Disabling Cloud Run services..."
for SERVICE in renovix-api renovix-chat renovix-dashboard renovix-landing; do
  gcloud run services update $SERVICE \
    --region=$REGION \
    --project=$PROJECT \
    --max-instances=0 \
    --quiet 2>/dev/null && echo "  ✓ $SERVICE stopped" || echo "  ⚠ $SERVICE not found"
done

# 4. Delete the Load Balancer forwarding rule (stops networking charges)
echo "→ Removing forwarding rules..."
gcloud compute forwarding-rules delete renovix-https-rule \
  --global \
  --project=$PROJECT \
  --quiet 2>/dev/null

gcloud compute forwarding-rules delete renovix-http-rule \
  --global \
  --project=$PROJECT \
  --quiet 2>/dev/null

# 5. Delete Target HTTPS Proxy
echo "→ Removing HTTPS proxy..."
gcloud compute target-https-proxies delete renovix-https-proxy \
  --project=$PROJECT \
  --quiet 2>/dev/null

# 6. Delete HTTP proxy and redirect URL map (cleanup)
echo "→ Removing HTTP proxy + redirect URL map..."
gcloud compute target-http-proxies delete renovix-http-proxy \
  --project=$PROJECT \
  --quiet 2>/dev/null

gcloud compute url-maps delete renovix-http-redirect \
  --project=$PROJECT \
  --quiet 2>/dev/null

# 7. Release global static IPs that still bill when RESERVED and unused
echo "→ Releasing external global static IPs..."
GLOBAL_IPS=$(gcloud compute addresses list \
  --global \
  --project=$PROJECT \
  --filter="status=RESERVED AND purpose != VPC_PEERING" \
  --format="value(name)" 2>/dev/null)

if [[ -n "$GLOBAL_IPS" ]]; then
  while IFS= read -r ip; do
    [[ -z "$ip" ]] && continue
    gcloud compute addresses delete "$ip" \
      --global \
      --project=$PROJECT \
      --quiet 2>/dev/null && echo "  ✓ released $ip" || echo "  ⚠ failed to release $ip"
  done <<< "$GLOBAL_IPS"
else
  echo "  ✓ no billable global static IPs found"
fi

echo ""
echo "✅ All services stopped!"
echo "💰 Expected charges: near storage-only (if Cloud SQL still exists)"
echo ""
echo "⚠️  To restore: run scripts/gcp-start.sh"