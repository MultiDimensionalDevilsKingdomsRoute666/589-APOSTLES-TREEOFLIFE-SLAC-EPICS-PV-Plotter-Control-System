#!/bin/bash

echo "=================================="
echo "PR Status Summary"
echo "=================================="
echo ""

# Get latest PR number
LATEST_PR=$(gh pr list --limit 1 --json number --jq '.[0].number' 2>/dev/null)

if [ -z "$LATEST_PR" ]; then
    echo "No open pull requests found"
    echo ""
else
    echo "Latest PR: #$LATEST_PR"
    echo ""
    
    echo "PR Details:"
    gh pr view $LATEST_PR 2>/dev/null
    
    echo ""
    echo "=================================="
    echo "PR Check Status:"
    echo "=================================="
    gh pr view $LATEST_PR --json statusCheckRollup \
      --jq '.statusCheckRollup[] | "\(.name): \(.conclusion // .status)"' 2>/dev/null
fi

echo ""
echo "=================================="
echo "Recent Workflow Runs:"
echo "=================================="
gh run list --limit 5 --json status,conclusion,name,databaseId,createdAt \
  --jq '.[] | "\(.databaseId) | \(.name) | \(.status) | \(.conclusion // "running")"'

echo ""
echo "=================================="
echo "Repository Info:"
echo "=================================="
echo "Repository: $(git remote get-url origin)"
echo "Current branch: $(git branch --show-current)"
echo "Latest commit: $(git log -1 --oneline)"
