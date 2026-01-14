#!/usr/bin/env node
/**
 * Fetches GitHub issue information using the Octokit SDK.
 * Useful when the gh CLI is not available (e.g., in cloud environments).
 *
 * Usage:
 *   node scripts/github-issue.mjs <owner> <repo> <issue-number>
 *   node scripts/github-issue.mjs solo-ist prose 72
 *
 * For private repos, set GITHUB_TOKEN environment variable.
 */

import { Octokit } from 'octokit'

const [owner, repo, issueNumber] = process.argv.slice(2)

if (!owner || !repo || !issueNumber) {
  console.error('Usage: node scripts/github-issue.mjs <owner> <repo> <issue-number>')
  console.error('Example: node scripts/github-issue.mjs solo-ist prose 72')
  process.exit(1)
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
})

try {
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: parseInt(issueNumber, 10)
  })

  console.log('---')
  console.log(`# ${issue.title}`)
  console.log(`Issue #${issue.number} | State: ${issue.state}`)
  console.log(`Author: ${issue.user?.login} | Created: ${issue.created_at}`)

  if (issue.labels?.length > 0) {
    const labels = issue.labels.map((l) => (typeof l === 'string' ? l : l.name)).join(', ')
    console.log(`Labels: ${labels}`)
  }

  if (issue.assignees?.length > 0) {
    const assignees = issue.assignees.map((a) => a.login).join(', ')
    console.log(`Assignees: ${assignees}`)
  }

  if (issue.milestone) {
    console.log(`Milestone: ${issue.milestone.title}`)
  }

  console.log('---')
  console.log('')
  console.log(issue.body || '(No description)')
  console.log('')

  // Fetch comments if any
  if (issue.comments > 0) {
    console.log('---')
    console.log(`## Comments (${issue.comments})`)
    console.log('')

    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: parseInt(issueNumber, 10)
    })

    for (const comment of comments) {
      console.log(`### ${comment.user?.login} (${comment.created_at})`)
      console.log(comment.body)
      console.log('')
    }
  }
} catch (error) {
  if (error.status === 404) {
    console.error(`Issue not found: ${owner}/${repo}#${issueNumber}`)
    console.error('If this is a private repo, set GITHUB_TOKEN environment variable.')
  } else if (error.status === 403) {
    console.error('Rate limit exceeded or authentication required.')
    console.error('Set GITHUB_TOKEN environment variable to increase rate limits.')
  } else {
    console.error(`Error fetching issue: ${error.message}`)
  }
  process.exit(1)
}
