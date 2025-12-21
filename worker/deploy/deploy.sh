#!/bin/bash

# Configuration
STACK_NAME="dailydutch-worker-stack"
KEY_NAME="dailydutch-worker-key"
KEY_FILE="${KEY_NAME}.pem"
REGION="eu-central-1"

cd $(dirname $0)
set -e

echo "--- 1. Checking for SSH Key Pair ---"
# Check if key exists in AWS, if not create it
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "Key '$KEY_NAME' already exists in AWS."
    if [ ! -f "$KEY_FILE" ]; then
        echo "WARNING: Key exists in AWS but '$KEY_FILE' is missing locally."
        echo "You won't be able to SSH unless you find that file."
        echo "Delete the key in AWS console if you want to regenerate it."
        exit 1
    fi
else
    echo "Creating new key pair '$KEY_NAME'..."
    aws ec2 create-key-pair --key-name "$KEY_NAME" --query 'KeyMaterial' --output text --region "$REGION" > "$KEY_FILE"
    chmod 400 "$KEY_FILE"
    echo "Key saved to $KEY_FILE"
fi

echo -e "\n--- 2. Deploying Infrastructure (this takes ~3 minutes) ---"
aws cloudformation deploy \
  --template-file infra.yaml \
  --stack-name "$STACK_NAME" \
  --parameter-overrides KeyName="$KEY_NAME" \
  --capabilities CAPABILITY_IAM \
  --region "$REGION"

echo -e "\n--- 3. Fetching Connection Details ---"
PUBLIC_IP=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='PublicIP'].OutputValue" \
    --output text \
    --region "$REGION")

echo "=========================================================="
echo "Deployment Complete!"
echo "Instance Public IP: $PUBLIC_IP"
echo "=========================================================="
echo ""
echo "To deploy your project, run the following command:"
echo "rsync -av -e \"ssh -i deploy/$KEY_FILE -o StrictHostKeyChecking=no\" --exclude 'venv' --exclude '.git' ./ ec2-user@$PUBLIC_IP:~/app"
echo ""
echo "Then connect and run docker:"
echo "ssh -i deploy/$KEY_FILE ec2-user@$PUBLIC_IP 'cd ~/app && scripts/prod.sh'"
echo ""
