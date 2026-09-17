const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { fields, parseRcas, requiresRca, validate, run } = require('../.github/scripts/rca.cjs');

const repository = 'Kakrl/MakeShift';
const issue = (number = 12, severity = 'High') => ({ number, labels: [{ name: 'bug' }],
  body: `### Severity\n\n${severity}\n\n### Summary\nBroken workflow.` });
const block = (number = 12) => `<!-- rca:start issue=${number} -->\n` + fields.map(field =>
  `### ${field}\n${field === 'Fix verification' ? 'Passed https://example.com/run/1' : `Completed analysis for ${field}.`}`
).join('\n\n') + '\n<!-- rca:end -->';
const row = (number = 12) => `| D1 | [#${number}](https://github.com/${repository}/issues/${number}) | High | Missing state update | [#82](https://github.com/${repository}/pull/82) | regression.test | 2026-09-17 | Tester |`;
const readme = (...numbers) => `## Root Cause Analysis Log\n\n${numbers.map(row).join('\n')}\n\n## Other section\n`;
const input = (overrides = {}) => ({ body: block(), issues: [issue()], readme: readme(12), repository, prNumber: 82, ...overrides });

test('ordinary PR, including unchanged PR template, needs no RCA or log read', () => {
  assert.equal(validate(input({ body: readFileSync('.github/pull_request_template.md', 'utf8'), issues: [], readme: '' })).size, 0);
});

test('high severity, assignment selection and explicit issue label require RCA', () => {
  assert.equal(requiresRca(issue()), true);
  assert.equal(requiresRca(issue(12, 'Medium')), false);
  assert.equal(requiresRca({ ...issue(12, 'Low'), body: '### RCA requirement\n\nAssignment example (required)\n' }), true);
  assert.equal(requiresRca({ ...issue(12, 'Low'), labels: [{ name: 'rca-required' }] }), true);
  assert.throws(() => validate(input({ body: '' })), /#12 requires an RCA/);
});

test('complete RCA and log row validate', () => {
  assert.equal(validate(input()).size, 1);
  assert.equal(validate(input({ body: block().replaceAll('\n', '\r\n') })).size, 1);
});

test('missing, empty and placeholder fields fail with useful errors', () => {
  assert.throws(() => parseRcas(block().replace('### Discovery', '### Wrong')), /seven template headings/);
  for (const value of ['', 'TBD', 'TODO', '<Describe cause>', '<!-- hidden -->']) {
    assert.throws(() => parseRcas(block().replace('Completed analysis for Root cause.', value)), /complete "Root cause"/);
  }
  assert.throws(() => parseRcas(block().replace('https://example.com/run/1', 'local run')), /HTTPS evidence link/);
});

test('malformed and duplicate blocks are rejected', () => {
  assert.throws(() => parseRcas(block() + block()), /Duplicate/);
  assert.throws(() => parseRcas(block().replace('issue=12', 'issue=other/12')), /Malformed/);
  assert.throws(() => parseRcas(block().replace('<!-- rca:end -->', '')), /Malformed/);
});

test('each target must be a closing bug issue, never a PR or unrelated issue', () => {
  assert.throws(() => validate(input({ issues: [] })), /target must be a bug issue/);
  assert.throws(() => validate(input({ issues: [{ ...issue(), labels: [] }] })), /target must be a bug issue/);
  assert.throws(() => validate(input({ issues: [{ ...issue(), pull_request: {} }] })), /target must be a bug issue/);
});

test('multiple required defects each need their own RCA and log row', () => {
  assert.throws(() => validate(input({ issues: [issue(), issue(13)] })), /#13 requires an RCA/);
  assert.equal(validate(input({ issues: [issue(), issue(13)], body: block() + '\n' + block(13), readme: readme(12, 13) })).size, 2);
});

test('log must have all columns and exact issue/PR links inside the RCA log section', () => {
  for (const value of ['', readme(123), readme(12).replace('/pull/82)', '/pull/8)'),
    readme(12).replace('| Tester |', '| TBD |'), `## Other\n${row()}\n`]) {
    assert.throws(() => validate(input({ readme: value })), /complete all eight columns/);
  }
});

function fixture({ body = block(), issues = [issue()], merged = true, action = 'closed', failIssue = null } = {}) {
  const calls = [];
  const comments = new Map();
  const pr = { number: 82, body, merged, head: { sha: 'head-sha' }, base: { ref: 'main' },
    merge_commit_sha: 'merge-sha', html_url: `https://github.com/${repository}/pull/82` };
  const github = {
    graphql: async () => ({ repository: { pullRequest: { closingIssuesReferences: {
      nodes: issues.map(item => ({ number: item.number, repository: { nameWithOwner: repository } })),
      pageInfo: { hasNextPage: false },
    } } } }),
    paginate: async (_method, args) => comments.get(args.issue_number) ?? [],
    rest: {
      pulls: { get: async () => ({ data: pr }) },
      repos: { getContent: async args => {
        calls.push(['read', args]);
        return { data: { encoding: 'base64', content: Buffer.from(readme(...issues.map(i => i.number))).toString('base64') } };
      } },
      issues: {
        get: async args => ({ data: issues.find(item => item.number === args.issue_number) }),
        listComments: () => {},
        createComment: async args => {
          if (args.issue_number === failIssue) throw new Error('API unavailable');
          calls.push(['create', args]);
          comments.set(args.issue_number, [{ id: args.issue_number, body: args.body, user: { login: 'github-actions[bot]' } }]);
        },
        updateComment: async args => { calls.push(['update', args]); },
      },
    },
  };
  return { github, context: { repo: { owner: 'Kakrl', repo: 'MakeShift' }, payload: { action, pull_request: pr } },
    core: { info: () => {} }, calls, comments, recover: () => { failIssue = null; }, publish: true };
}

test('merge publishes with correct target, commit and PR provenance', async () => {
  const f = fixture();
  await run(f);
  assert.equal(f.calls[0][1].ref, 'merge-sha');
  const post = f.calls.find(call => call[0] === 'create')[1];
  assert.equal(post.issue_number, 12);
  assert.match(post.body, /makeshift-rca:pr=82:issue=12/);
  assert.match(post.body, /\/commit\/merge-sha/);
  assert.match(post.body, /\/pull\/82/);
});

test('non-merged closures and non-closure events never read or write', async () => {
  for (const options of [{ merged: false }, { action: 'opened' }]) {
    const f = fixture(options);
    await run(f);
    assert.deepEqual(f.calls, []);
  }
});

test('ordinary merged PR is a no-op', async () => {
  const f = fixture({ body: 'Closes #81', issues: [] });
  await run(f);
  assert.deepEqual(f.calls, []);
});

test('validation reads PR head as data and never posts', async () => {
  const f = fixture();
  await run({ ...f, publish: false });
  assert.deepEqual(f.calls.map(call => call[0]), ['read']);
  assert.equal(f.calls[0][1].ref, 'head-sha');
});

test('rerun reuses bot comment; changed generated comment is updated', async () => {
  const f = fixture();
  await run(f);
  await run(f);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
  f.comments.get(12)[0].body += '\naccidental edit';
  await run(f);
  assert.equal(f.calls.filter(call => call[0] === 'update').length, 1);
});

test('a human comment with the marker is never overwritten', async () => {
  const f = fixture();
  f.comments.set(12, [{ id: 99, body: '<!-- makeshift-rca:pr=82:issue=12 -->\nSpoof', user: { login: 'someone' } }]);
  await run(f);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'update').length, 0);
});

test('partial API failure is surfaced; retry does not duplicate successful targets', async () => {
  const f = fixture({ body: block() + '\n' + block(13), issues: [issue(), issue(13)], failIssue: 13 });
  await assert.rejects(run(f), /API unavailable/);
  await assert.rejects(run(f), /API unavailable/);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
  f.recover();
  await run(f);
  assert.deepEqual(f.calls.filter(call => call[0] === 'create').map(call => call[1].issue_number), [12, 13]);
});

test('all targets validate before any comments are written', async () => {
  const f = fixture({ body: block() + '\n' + block(13) });
  await assert.rejects(run(f), /target must be a bug issue/);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 0);
});

test('recovery uses merge event body, not a later PR description edit', async () => {
  const f = fixture();
  f.github.rest.pulls.get = async () => { throw new Error('Must not fetch mutable PR description'); };
  await run(f);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
});

test('closing references paginate and cross-repository targets are excluded', async () => {
  const f = fixture({ body: block() + '\n' + block(13), issues: [issue(), issue(13)] });
  const cursors = [];
  f.github.graphql = async (_query, args) => {
    cursors.push(args.cursor);
    return { repository: { pullRequest: { closingIssuesReferences: {
      nodes: args.cursor ? [{ number: 13, repository: { nameWithOwner: repository } }] :
        [{ number: 12, repository: { nameWithOwner: repository } }, { number: 99, repository: { nameWithOwner: 'other/repo' } }],
      pageInfo: { hasNextPage: !args.cursor, endCursor: 'next' },
    } } } };
  };
  await run(f);
  assert.deepEqual(cursors, [null, 'next']);
  assert.deepEqual(f.calls.filter(call => call[0] === 'create').map(call => call[1].issue_number), [12, 13]);
});
