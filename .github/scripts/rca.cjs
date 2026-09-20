// Run only from the trusted base checkout in rca.yml. PR text/files are data.
const fields = [
  'Root cause',
  'Discovery',
  'Exposing test',
  'Fix verification',
  'Regression test',
  'Remaining risk',
  'Process improvement',
];

function meaningful(value) {
  const text = value.replace(/<!--[^]*?-->/g, '').trim();
  return text && !/^(?:TBD|TODO|N\/A|None|\.\.\.|<[^]*>)\.?$/i.test(text);
}

function parseRcas(body = '') {
  const blocks = new Map();
  const pattern = /<!-- rca:start issue=([1-9]\d*) -->\s*([^]*?)\s*<!-- rca:end -->/g;
  for (const match of body.matchAll(pattern)) {
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || blocks.has(number)) {
      throw new Error(`Duplicate or invalid RCA issue number: ${match[1]}.`);
    }
    const content = match[2].trim();
    const headings = [...content.matchAll(/^### (.+)\r?$/gm)];
    if (headings.length !== fields.length || headings.some((h, i) => h[1] !== fields[i])) {
      throw new Error(`RCA #${number}: use all seven template headings in order.`);
    }
    for (let i = 0; i < headings.length; i++) {
      const value = content.slice(headings[i].index + headings[i][0].length,
        headings[i + 1]?.index ?? content.length);
      if (!meaningful(value)) throw new Error(`RCA #${number}: complete "${fields[i]}".`);
      if (fields[i] === 'Fix verification' && !/https:\/\/\S+/.test(value)) {
        throw new Error(`RCA #${number}: Fix verification needs an HTTPS evidence link.`);
      }
    }
    blocks.set(number, content);
  }
  const remainder = body.replace(pattern, '');
  if (/<!--\s*rca:(?:start|end)\b/i.test(remainder)) {
    throw new Error('Malformed RCA block. Use <!-- rca:start issue=123 --> and <!-- rca:end -->.');
  }
  return blocks;
}

function requiresRca(issue) {
  return issue.labels.some(label => (label.name ?? label) === 'rca-required') ||
    /^### Severity\s*\r?\n\s*High\s*(?:\r?\n|$)/m.test(issue.body ?? '') ||
    /^### RCA requirement\s*\r?\n\s*Assignment example \(required\)/m.test(issue.body ?? '');
}

function validate({ body, issues, readme, repository, prNumber }) {
  const blocks = parseRcas(body);
  const byNumber = new Map(issues.map(issue => [issue.number, issue]));
  for (const issue of issues) {
    if (requiresRca(issue) && !blocks.has(issue.number)) {
      throw new Error(`Issue #${issue.number} requires an RCA. Add its template block and RCA log row.`);
    }
  }
  const log = readme.match(/^## Root Cause Analysis Log\r?\n([^]*?)(?=^## |$(?![^]))/m)?.[1] ?? '';
  const rows = log.split('\n').filter(line => line.startsWith('|')).map(line =>
    line.trim().slice(1, -1).split('|').map(cell => cell.trim()));
  for (const number of blocks.keys()) {
    const issue = byNumber.get(number);
    if (!issue || issue.pull_request || !issue.labels.some(label => (label.name ?? label) === 'bug')) {
      throw new Error(`RCA #${number}: target must be a bug issue in ${repository} closed by this PR. Use Closes #${number}.`);
    }
    const issueUrl = `https://github.com/${repository}/issues/${number}`;
    const prUrl = `https://github.com/${repository}/pull/${prNumber}`;
    const row = rows.find(cells => cells.length === 8 &&
      cells[1].includes(`](${issueUrl})`) && cells[4].includes(`](${prUrl})`));
    if (!row || row.some(cell => !meaningful(cell))) {
      throw new Error(`RCA #${number}: complete all eight columns in tests/README.md's RCA log, linking ${issueUrl} and ${prUrl}.`);
    }
  }
  return blocks;
}

async function closingIssues(github, owner, repo, number) {
  const result = [];
  let cursor = null;
  do {
    const data = await github.graphql(`query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          closingIssuesReferences(first: 100, after: $cursor) {
            nodes { number repository { nameWithOwner } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }`, { owner, repo, number, cursor });
    const connection = data.repository.pullRequest.closingIssuesReferences;
    result.push(...connection.nodes.filter(issue =>
      issue.repository.nameWithOwner.toLowerCase() === `${owner}/${repo}`.toLowerCase()));
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return Promise.all(result.map(issue => github.rest.issues.get({ owner, repo, issue_number: issue.number })
    .then(response => response.data)));
}

async function run({ github, context, core, publish = false }) {
  const { owner, repo } = context.repo;
  const eventPr = context.payload.pull_request;
  // Re-running the closed event retains its original PR body, even if someone
  // subsequently edits the description. No dispatch accepts arbitrary text.
  if (publish && (context.payload.action !== 'closed' || !eventPr?.merged)) {
    core.info('No merged PR; nothing to publish.');
    return;
  }
  const pr = publish ? eventPr : (await github.rest.pulls.get({ owner, repo, pull_number: eventPr.number })).data;
  if (pr.base.ref !== 'main') throw new Error('RCA automation only supports PRs targeting main.');
  const issues = await closingIssues(github, owner, repo, pr.number);
  const blocks = parseRcas(pr.body ?? '');
  let readme = '';
  if (blocks.size || issues.some(requiresRca)) {
    const { data } = await github.rest.repos.getContent({ owner, repo,
      path: 'tests/README.md', ref: publish ? pr.merge_commit_sha : pr.head.sha });
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new Error('Could not read tests/README.md as a regular file.');
    }
    readme = Buffer.from(data.content, 'base64').toString('utf8');
  }
  validate({ body: pr.body ?? '', issues, readme, repository: `${owner}/${repo}`, prNumber: pr.number });
  core.info(`Validated ${blocks.size} RCA section(s) for PR #${pr.number}.`);
  if (!publish) return;
  for (const [number, content] of blocks) {
    const marker = `<!-- makeshift-rca:pr=${pr.number}:issue=${number} -->`;
    const body = `${marker}\n## Root Cause Analysis\n\n${content}\n\n` +
      `Fix PR: ${pr.html_url}\n\nMerged commit: https://github.com/${owner}/${repo}/commit/${pr.merge_commit_sha}\n\n` +
      'Published from the PR description captured at merge. Maintainers reviewed the analysis in the fix PR.';
    const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 });
    const existing = comments.find(comment => comment.user?.login === 'github-actions[bot]' &&
      comment.body?.startsWith(marker + '\n'));
    if (existing) {
      if (existing.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    } else {
      await github.rest.issues.createComment({ owner, repo, issue_number: number, body });
    }
    core.info(`Published RCA for issue #${number}.`);
  }
}

module.exports = { fields, parseRcas, requiresRca, validate, run };
