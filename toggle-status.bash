#!/bin/bash
# Check status of all GCP services

PROJECT="renovix-ai-prod"
REGION="asia-southeast2"

echo "🔍 Service Status for $PROJECT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Cloud SQL
echo ""
echo "📦 Cloud SQL:"
SQL_STATE=$(gcloud sql instances describe renovix-db-${REGION} \
  --project=$PROJECT \
  --format="value(state)" 2>/dev/null)
SQL_POLICY=$(gcloud sql instances describe renovix-db-${REGION} \
  --project=$PROJECT \
  --format="value(settings.activationPolicy)" 2>/dev/null)

if [[ "$SQL_STATE" == "RUNNABLE" ]]; then
  echo "  ✅ ON  — state=$SQL_STATE, policy=$SQL_POLICY"
elif [[ "$SQL_STATE" == "SUSPENDED" ]]; then
  echo "  🔴 OFF — state=$SQL_STATE, policy=$SQL_POLICY"
elif [[ -z "$SQL_STATE" ]]; then
  echo "  🔴 OFF — instance not found"
else
  echo "  ⚠️  $SQL_STATE (policy=$SQL_POLICY)"
fi

# 2. VPC Connector
echo ""
echo "🔌 VPC Connector:"
VPC_CONN=$(gcloud compute networks vpc-access connectors list \
  --region=$REGION \
  --project=$PROJECT \
  --format="value(name)" 2>/dev/null)

if [[ -z "$VPC_CONN" ]]; then
  echo "  🔴 OFF — no connector found"
else
  echo "  ✅ ON  — $VPC_CONN"
fi

# 3. Cloud Run Services
echo ""
echo "🚀 Cloud Run Services:"
for SERVICE in renovix-api renovix-chat renovix-dashboard renovix-landing; do
  EXISTS=$(gcloud run services describe $SERVICE \
    --region=$REGION \
    --project=$PROJECT \
    --format="value(metadata.name)" 2>/dev/null)

  if [[ -z "$EXISTS" ]]; then
    echo "  🔴 $SERVICE — not found (deleted)"
    continue
  fi

  INFO=$(gcloud run services describe $SERVICE \
    --region=$REGION \
    --project=$PROJECT \
    --format="value(spec.template.spec.containerConcurrency),value(status.conditions[0].status)" 2>/dev/null)
  
  INGRESS=$(gcloud run services describe $SERVICE \
    --region=$REGION \
    --project=$PROJECT \
    --format="value(metadata.annotations['run.googleapis.com/ingress'])" 2>/dev/null)
  
  MAX_INST=$(gcloud run services describe $SERVICE \
    --region=$REGION \
    --project=$PROJECT \
    --format="value(spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'])" 2>/dev/null)

  if [[ "$INGRESS" == "internal" ]]; then
    echo "  🔴 $SERVICE — ingress=internal (blocked), max=$MAX_INST"
  elif [[ "$MAX_INST" == "0" ]]; then
    echo "  🟡 $SERVICE — max-instances=0 (no new instances), ingress=$INGRESS"
  elif [[ -n "$MAX_INST" ]]; then
    echo "  ✅ $SERVICE — ingress=${INGRESS:-all}, max=$MAX_INST"
  else
    echo "  ⚠️  $SERVICE — describe error"
  fi
done

# 4. Load Balancer (Forwarding Rules)
echo ""
echo "🌐 Load Balancer (Forwarding Rules):"
FWD_RULES=$(gcloud compute forwarding-rules list \
  --project=$PROJECT \
  --format="value(name)" 2>/dev/null)

if [[ -z "$FWD_RULES" ]]; then
  echo "  🔴 OFF — no forwarding rules"
else
  while IFS= read -r rule; do
    echo "  ✅ ON  — $rule"
  done <<< "$FWD_RULES"
fi

# 5. Target HTTPS Proxy
echo ""
echo "🔒 HTTPS Proxy:"
PROXIES=$(gcloud compute target-https-proxies list \
  --project=$PROJECT \
  --format="value(name)" 2>/dev/null)

if [[ -z "$PROXIES" ]]; then
  echo "  🔴 OFF — no HTTPS proxy"
else
  while IFS= read -r proxy; do
    echo "  ✅ ON  — $proxy"
  done <<< "$PROXIES"
fi

# 6. Reserved Static IPs
echo ""
echo "📍 Reserved Static IPs:"
IPS=$(gcloud compute addresses list \
  --project=$PROJECT \
  --filter="status=RESERVED" \
  --format="value(name,purpose,address)" 2>/dev/null)

if [[ -z "$IPS" ]]; then
  echo "  🔴 OFF — no reserved addresses"
else
  while IFS= read -r ip; do
    [[ -z "$ip" ]] && continue
    if echo "$ip" | grep -q "VPC_PEERING"; then
      echo "  ℹ $ip (private peering range; not the billable external static IP)"
    else
      echo "  ✅ ON  — $ip (can incur static IP charges if unused)"
    fi
  done <<< "$IPS"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
