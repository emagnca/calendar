#!/bin/bash

# Calendar AWS Lambda Layer Build Script
# Builds the calendar layer, uploads to S3, and publishes to AWS Lambda

set -e

# Parse arguments
DRYRUN=false
ARGS=()

for arg in "$@"; do
    if [ "$arg" = "--dryrun" ]; then
        DRYRUN=true
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
    exit 1
fi

LAYER_NAME="calendar"
VERSION="${ARGS[0]}"

if [ "$DRYRUN" = true ]; then
    echo "🔨 Building ${LAYER_NAME} layer version ${VERSION} (DRY RUN - local build only)"
else
    echo "🚀 Building ${LAYER_NAME} layer version ${VERSION}..."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/layer-build"
DIST_DIR="$PROJECT_ROOT/dist"

# Configuration
DEPLOYMENT_BUCKET="tinycalendar-deployments"
AWS_REGION="eu-north-1"
COMPATIBLE_RUNTIMES="nodejs20.x nodejs22.x nodejs24.x"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "Project root: $PROJECT_ROOT"
if [ "$DRYRUN" = false ]; then
    echo "Deployment bucket: $DEPLOYMENT_BUCKET"
    echo "Region: $AWS_REGION"
fi
echo ""

# Create build and dist directories
mkdir -p "$BUILD_DIR"
mkdir -p "$DIST_DIR"

# Build layer
build_layer() {
    local build_layer_dir="$BUILD_DIR/${LAYER_NAME}-layer"

    echo "📦 Building ${LAYER_NAME} layer..."

    mkdir -p "$build_layer_dir/nodejs"

    cp "$PROJECT_ROOT/server/package.json" "$build_layer_dir/nodejs/"
    if [ -f "$PROJECT_ROOT/server/package-lock.json" ]; then
        cp "$PROJECT_ROOT/server/package-lock.json" "$build_layer_dir/nodejs/"
    fi

    cd "$build_layer_dir/nodejs"
    npm install --omit=dev --omit=optional --no-package-lock

    echo "Cleaning up unnecessary files..."
    find . -name "*.md"       -type f -delete
    find . -name "*.txt"      -type f -delete
    find . -name "LICENSE*"   -type f -delete
    find . -name "CHANGELOG*" -type f -delete
    find . -name ".npmignore" -type f -delete
    find . -name "test"    -type d -exec rm -rf {} + 2>/dev/null || true
    find . -name "tests"   -type d -exec rm -rf {} + 2>/dev/null || true
    find . -name "docs"    -type d -exec rm -rf {} + 2>/dev/null || true
    find . -name "examples" -type d -exec rm -rf {} + 2>/dev/null || true

    local zip_filename="${LAYER_NAME}-layer-v${VERSION}.zip"
    cd "$build_layer_dir"
    zip -r "$DIST_DIR/$zip_filename" nodejs/

    echo "✅ Layer built: $DIST_DIR/$zip_filename"
    echo "   Size: $(du -h "$DIST_DIR/$zip_filename" | cut -f1)"
}

# Step 1: Build
echo "📦 Step 1: Building layer..."
build_layer

LAYER_FILE="$DIST_DIR/${LAYER_NAME}-layer-v${VERSION}.zip"

# Step 2: Upload to S3
if [ "$DRYRUN" = false ]; then
    echo ""
    echo "📤 Step 2: Uploading layer to S3..."

    if aws s3 ls "s3://$DEPLOYMENT_BUCKET" --region "$AWS_REGION" 2>/dev/null; then
        echo "✅ Deployment bucket exists: $DEPLOYMENT_BUCKET"
    else
        echo "⚠️  Deployment bucket does not exist, creating..."
        aws s3 mb "s3://$DEPLOYMENT_BUCKET" --region "$AWS_REGION"
        echo "✅ Created deployment bucket: $DEPLOYMENT_BUCKET"
    fi

    DEPLOYMENT_KEY="layers/${LAYER_NAME}/${LAYER_NAME}-layer-v${VERSION}_${TIMESTAMP}.zip"
    echo "Uploading to S3: s3://$DEPLOYMENT_BUCKET/$DEPLOYMENT_KEY"
    aws s3 cp "$LAYER_FILE" "s3://$DEPLOYMENT_BUCKET/$DEPLOYMENT_KEY" --region "$AWS_REGION"
    echo "✅ Layer uploaded: s3://$DEPLOYMENT_BUCKET/$DEPLOYMENT_KEY"
fi

# Step 3: Publish to Lambda
if [ "$DRYRUN" = false ]; then
    echo ""
    echo "🚀 Step 3: Publishing layer to AWS Lambda..."

    LAYER_VERSION=$(aws lambda publish-layer-version \
        --layer-name "$LAYER_NAME" \
        --zip-file "fileb://$LAYER_FILE" \
        --compatible-runtimes $COMPATIBLE_RUNTIMES \
        --description "Calendar layer v${VERSION} - Built at ${TIMESTAMP}" \
        --region "$AWS_REGION" \
        --query 'Version' \
        --output text)

    echo "✅ Layer published: ${LAYER_NAME} version ${LAYER_VERSION}"

    LAYER_ARN=$(aws lambda list-layer-versions \
        --layer-name "$LAYER_NAME" \
        --region "$AWS_REGION" \
        --query "LayerVersions[0].LayerVersionArn" \
        --output text)

    echo "   ARN: $LAYER_ARN"
fi

# Clean up build directory
echo ""
echo "🧹 Cleaning up build directory..."
rm -rf "$BUILD_DIR"

# Summary
echo ""
if [ "$DRYRUN" = true ]; then
    echo "🎉 Local build completed successfully!"
    echo ""
    echo "📋 Summary:"
    echo "   Layer:      ${LAYER_NAME}"
    echo "   Version:    ${VERSION}"
    echo "   Local File: ${LAYER_FILE}"
    echo "   Size:       $(du -h "$LAYER_FILE" | cut -f1)"
    echo ""
    echo "🔗 Next steps:"
    echo "   Deploy to AWS: $0 ${VERSION}"
else
    echo "🎉 Layer deployment completed successfully!"
    echo ""
    echo "📋 Summary:"
    echo "   Layer:          ${LAYER_NAME}"
    echo "   Version:        ${VERSION}"
    echo "   Lambda Version: ${LAYER_VERSION}"
    echo "   Region:         ${AWS_REGION}"
    echo "   Local File:     ${LAYER_FILE}"
    echo "   S3 Location:    s3://${DEPLOYMENT_BUCKET}/${DEPLOYMENT_KEY}"
    echo "   Layer ARN:      ${LAYER_ARN}"
    echo ""
    echo "🔗 Next steps:"
    echo "   Attach layer to your Lambda function:"
    echo "   aws lambda update-function-configuration \\"
    echo "     --function-name <your-function-name> \\"
    echo "     --layers ${LAYER_ARN} \\"
    echo "     --region ${AWS_REGION}"
fi
