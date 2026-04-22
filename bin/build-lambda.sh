#!/bin/bash

# Calendar AWS Lambda Deployment Script
# Creates a deployment package, backs up current version to S3, and deploys to Lambda

set -e

# Configuration
LAMBDA_FUNCTION_NAME="calendar"
BACKUP_BUCKET="tinycalendar-backups"
DEPLOYMENT_BUCKET="tinycalendar-deployments"
LAMBDA_REGION="eu-north-1"

# Parse arguments
DRYRUN=false
FORCE=false
ARGS=()

for arg in "$@"; do
    if [ "$arg" = "--dryrun" ]; then
        DRYRUN=true
    elif [ "$arg" = "--force" ]; then
        FORCE=true
    else
        ARGS+=("$arg")
    fi
done

if [ ${#ARGS[@]} -ne 1 ]; then
    echo "Usage: $0 <version> [--dryrun]"
    echo "Example: $0 1.0"
    echo "Example: $0 1.0 --dryrun"
    echo ""
    echo "Options:"
    echo "  --dryrun      Build locally only, skip AWS deployment"
    echo "  --force       Rebuild even if the zip for this version already exists"
    exit 1
fi

VERSION="${ARGS[0]}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

if [ "$DRYRUN" = true ]; then
    echo "🔨 Building ${LAMBDA_FUNCTION_NAME} Lambda function version ${VERSION} (DRY RUN - local build only)"
else
    echo "🚀 Deploying ${LAMBDA_FUNCTION_NAME} Lambda function version ${VERSION}"
fi
echo "Function: ${LAMBDA_FUNCTION_NAME}"
if [ "$DRYRUN" = false ]; then
    echo "Region:            ${LAMBDA_REGION}"
    echo "Backup bucket:     ${BACKUP_BUCKET}"
    echo "Deployment bucket: ${DEPLOYMENT_BUCKET}"
fi
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/dist"

mkdir -p "$DIST_DIR"

# Step 1: Create deployment package
echo "📦 Step 1: Creating deployment package..."
cd "$PROJECT_ROOT"

PACKAGE_FILE="$DIST_DIR/${LAMBDA_FUNCTION_NAME}_${VERSION}.zip"

if [ -f "$PACKAGE_FILE" ] && [ "$FORCE" = false ]; then
    echo "⚠️  Package already exists, using existing file: $PACKAGE_FILE"
else
    [ -f "$PACKAGE_FILE" ] && rm "$PACKAGE_FILE" && echo "🗑️  Removed existing package (--force)"
    # Stage files flat so handler.js is at the zip root (Lambda requires this)
    STAGE_DIR="$DIST_DIR/.stage"
    rm -rf "$STAGE_DIR"
    mkdir -p "$STAGE_DIR"

    cp "$PROJECT_ROOT/server/handler.js"   "$STAGE_DIR/"
    cp "$PROJECT_ROOT/server/api.js"       "$STAGE_DIR/"
    cp "$PROJECT_ROOT/server/package.json" "$STAGE_DIR/"
    cp -r "$PROJECT_ROOT/server/middleware" "$STAGE_DIR/"
    cp -r "$PROJECT_ROOT/server/models"    "$STAGE_DIR/"
    cp -r "$PROJECT_ROOT/server/utils"     "$STAGE_DIR/"
    cp -r "$PROJECT_ROOT/client"           "$STAGE_DIR/"

    echo "$VERSION" > "$STAGE_DIR/version.txt"
    echo "✅ Created version.txt: $VERSION"

    cd "$STAGE_DIR"
    zip -r "$PACKAGE_FILE" . -x "*.DS_Store" -x "*/.git/*"
    cd "$PROJECT_ROOT"

    rm -rf "$STAGE_DIR"

    echo "✅ Package created: $PACKAGE_FILE"
    echo "   Size: $(du -h "$PACKAGE_FILE" | cut -f1)"
fi

# Step 1b: Upload deployment package to S3
if [ "$DRYRUN" = false ]; then
    echo ""
    echo "📤 Step 1b: Uploading deployment package to S3..."

    if aws s3 ls "s3://$DEPLOYMENT_BUCKET" --region "$LAMBDA_REGION" 2>/dev/null; then
        echo "✅ Deployment bucket exists: $DEPLOYMENT_BUCKET"
    else
        echo "⚠️  Deployment bucket does not exist, creating..."
        aws s3 mb "s3://$DEPLOYMENT_BUCKET" --region "$LAMBDA_REGION"
        echo "✅ Created deployment bucket: $DEPLOYMENT_BUCKET"
    fi

    DEPLOYMENT_KEY="deployments/${LAMBDA_FUNCTION_NAME}/${LAMBDA_FUNCTION_NAME}_v${VERSION}_${TIMESTAMP}.zip"
    echo "Uploading to S3: s3://$DEPLOYMENT_BUCKET/$DEPLOYMENT_KEY"
    aws s3 cp "$PACKAGE_FILE" "s3://$DEPLOYMENT_BUCKET/$DEPLOYMENT_KEY" --region "$LAMBDA_REGION"
    echo "✅ Deployment package uploaded: s3://$DEPLOYMENT_BUCKET/$DEPLOYMENT_KEY"
fi

# Step 2: Check if Lambda function exists
if [ "$DRYRUN" = false ]; then
    echo ""
    echo "🔍 Step 2: Checking if Lambda function exists..."
    if aws lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --region "$LAMBDA_REGION" &>/dev/null; then
        echo "✅ Lambda function '$LAMBDA_FUNCTION_NAME' exists"
        FUNCTION_EXISTS=true
    else
        echo "⚠️  Lambda function '$LAMBDA_FUNCTION_NAME' does not exist"
        FUNCTION_EXISTS=false
    fi

    # Step 3: Backup current function code
    if [ "$FUNCTION_EXISTS" = true ]; then
        echo ""
        echo "💾 Step 3: Backing up current Lambda function to S3..."

        if aws s3 ls "s3://$BACKUP_BUCKET" --region "$LAMBDA_REGION" 2>/dev/null; then
            echo "✅ Backup bucket exists: $BACKUP_BUCKET"
        else
            echo "⚠️  Backup bucket does not exist, creating..."
            aws s3 mb "s3://$BACKUP_BUCKET" --region "$LAMBDA_REGION"
            echo "✅ Created backup bucket: $BACKUP_BUCKET"
        fi

        BACKUP_FILE="$DIST_DIR/${LAMBDA_FUNCTION_NAME}_backup_${TIMESTAMP}.zip"
        CODE_LOCATION=$(aws lambda get-function \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --region "$LAMBDA_REGION" \
            --query 'Code.Location' \
            --output text)

        curl -s "$CODE_LOCATION" -o "$BACKUP_FILE"

        BACKUP_KEY="backups/${LAMBDA_FUNCTION_NAME}/${LAMBDA_FUNCTION_NAME}_backup_${TIMESTAMP}.zip"
        echo "Uploading backup to S3: s3://$BACKUP_BUCKET/$BACKUP_KEY"
        aws s3 cp "$BACKUP_FILE" "s3://$BACKUP_BUCKET/$BACKUP_KEY" --region "$LAMBDA_REGION"
        rm "$BACKUP_FILE"

        echo "✅ Backup completed: s3://$BACKUP_BUCKET/$BACKUP_KEY"
    else
        echo ""
        echo "⏭️  Step 3: Skipping backup (function doesn't exist yet)"
    fi

    # Step 4: Deploy to Lambda
    echo ""
    echo "🚀 Step 4: Deploying to Lambda..."

    if [ "$FUNCTION_EXISTS" = true ]; then
        aws lambda update-function-code \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --zip-file "fileb://$PACKAGE_FILE" \
            --region "$LAMBDA_REGION" \
            --output json > /dev/null

        echo "✅ Function code updated"

        echo "Waiting for function update to complete..."
        aws lambda wait function-updated \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --region "$LAMBDA_REGION"
        echo "✅ Function update complete"
    else
        echo "⚠️  Function does not exist. Create it first:"
        echo "   aws lambda create-function \\"
        echo "     --function-name $LAMBDA_FUNCTION_NAME \\"
        echo "     --runtime nodejs20.x \\"
        echo "     --role arn:aws:iam::YOUR_ACCOUNT:role/YOUR_LAMBDA_ROLE \\"
        echo "     --handler handler.calendar \\"
        echo "     --zip-file fileb://$PACKAGE_FILE \\"
        echo "     --region $LAMBDA_REGION"
        exit 1
    fi

    # Step 5: Publish new version
    echo ""
    echo "📌 Step 5: Publishing Lambda version..."
    echo "Waiting for function to be ready..."
    aws lambda wait function-updated \
        --function-name "$LAMBDA_FUNCTION_NAME" \
        --region "$LAMBDA_REGION"

    PUBLISHED_VERSION=$(aws lambda publish-version \
        --function-name "$LAMBDA_FUNCTION_NAME" \
        --description "Version $VERSION" \
        --region "$LAMBDA_REGION" \
        --query 'Version' \
        --output text)

    echo "✅ Published Lambda version: $PUBLISHED_VERSION"
fi

# Summary
echo ""
if [ "$DRYRUN" = true ]; then
    echo "🎉 Local build completed successfully!"
    echo ""
    echo "📋 Summary:"
    echo "   Function:     ${LAMBDA_FUNCTION_NAME}"
    echo "   Version:      ${VERSION}"
    echo "   Local Package: ${PACKAGE_FILE}"
    echo "   Size:         $(du -h "$PACKAGE_FILE" | cut -f1)"
    echo ""
    echo "🔗 Next steps:"
    echo "   Deploy to AWS: $0 ${VERSION}"
else
    echo "🎉 Deployment completed successfully!"
    echo ""
    echo "📋 Summary:"
    echo "   Function:        ${LAMBDA_FUNCTION_NAME}"
    echo "   Version:         ${VERSION}"
    echo "   Lambda Version:  ${PUBLISHED_VERSION}"
    echo "   Region:          ${LAMBDA_REGION}"
    echo "   Local Package:   ${PACKAGE_FILE}"
    echo "   S3 Deployment:   s3://${DEPLOYMENT_BUCKET}/${DEPLOYMENT_KEY}"
    echo "   S3 Backup:       s3://${BACKUP_BUCKET}/${BACKUP_KEY}"
    echo ""
    echo "🔗 Next steps:"
    echo "   1. Test:      aws lambda invoke --function-name ${LAMBDA_FUNCTION_NAME} --region ${LAMBDA_REGION} output.json"
    echo "   2. View logs: aws logs tail /aws/lambda/${LAMBDA_FUNCTION_NAME} --follow --region ${LAMBDA_REGION}"
    echo "   3. Pin alias: aws lambda update-alias --function-name ${LAMBDA_FUNCTION_NAME} --name production --function-version ${PUBLISHED_VERSION} --region ${LAMBDA_REGION}"
fi
