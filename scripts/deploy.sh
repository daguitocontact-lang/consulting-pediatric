#!/usr/bin/env bash
# Manual prod deploy (native ARM build on this Mac, like Daguito's). Builds the
# api+panel image from the working tree, pushes to ECR, rolls the ECS service.
set -euo pipefail
cd "$(dirname "$0")/.."
SHA=$(git rev-parse --short=12 HEAD)
REG=322056173639.dkr.ecr.us-east-1.amazonaws.com
REPO=$REG/pediatric-api
REGION=us-east-1
PROFILE=${AWS_PROFILE:-default}
CLUSTER=pediatric-prod
SERVICE=pediatric-prod-api

aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
  | docker login --username AWS --password-stdin "$REG"
docker buildx build --platform linux/arm64 -f apps/api/Dockerfile.prod \
  -t "$REPO:$SHA" --push .

aws ecs describe-task-definition --task-definition pediatric-prod-api \
  --region "$REGION" --profile "$PROFILE" --query taskDefinition > /tmp/pediatric-td.json
jq --arg IMG "$REPO:$SHA" '(.containerDefinitions[] | select(.name=="api")).image=$IMG
  | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy)' \
  /tmp/pediatric-td.json > /tmp/pediatric-td.new.json
ARN=$(aws ecs register-task-definition --cli-input-json file:///tmp/pediatric-td.new.json \
  --region "$REGION" --profile "$PROFILE" --query 'taskDefinition.taskDefinitionArn' --output text)
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$ARN" --force-new-deployment --region "$REGION" --profile "$PROFILE"
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" --profile "$PROFILE"
echo "✅ deployed pediatric-prod-api $SHA"
