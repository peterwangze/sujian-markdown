const { gitDocumentContext, objectId, readGitBlob } = require('./review.cjs');

const pageSize = 50;
const historyMaxBuffer = 24 * 1024 * 1024;
const rawChange = /^\n?:[0-7]{6} ([0-7]{6}) [a-f0-9]+ ([a-f0-9]+) ([A-Z])\d*$/;

async function currentHead(runGit) {
  let output;
  try {
    output = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  } catch (error) {
    if (error.code === 1) return null;
    throw new Error('无法读取当前 Git 版本。', { cause: error });
  }
  const head = output.toString('ascii').trim();
  if (!objectId.test(head)) throw new Error('Git 返回了无法识别的当前版本。');
  return head;
}

function parseHistory(output, repoPath) {
  if (!output.length) return [];
  const fields = output.toString('utf8').split('\0');
  const entries = [];
  const seen = new Set();
  let currentPath = repoPath;
  let index = 0;
  while (index < fields.length - 1) {
    if (fields[index++] !== '') throw new Error('无法解析 Git 提交历史。');
    const commit = fields[index++];
    const author = fields[index++];
    const date = fields[index++];
    const subject = fields[index++];
    if (!objectId.test(commit) || subject === undefined) throw new Error('无法解析 Git 提交历史。');
    let match;
    while (fields[index]) {
      const change = rawChange.exec(fields[index++]);
      if (!change) throw new Error('无法解析 Git 文件变更。');
      const [, mode, blob, status] = change;
      const previousPath = fields[index++];
      const file = status === 'R' || status === 'C' ? fields[index++] : previousPath;
      if (!file || !objectId.test(blob)) throw new Error('无法解析 Git 文件变更。');
      if (file === currentPath) match = { path: file, previousPath, mode, blob, status };
    }
    if (!match) continue;
    if (match.status === 'R') currentPath = match.previousPath;
    if (seen.has(commit)) continue;
    seen.add(commit);
    const available = ['100644', '100755'].includes(match.mode) && !/^0+$/.test(match.blob);
    entries.push({ commit, author, date, subject, path: match.path, available, blob: match.blob });
  }
  return entries;
}

async function history({ runGit, repoPath }, head, count) {
  let output;
  try {
    output = await runGit([
      'log', '--follow', '--root', '--raw', '--no-abbrev', '-M', '-z', '--diff-merges=first-parent',
      '--no-color', '--no-decorate', '--no-graph', '--no-show-signature', '--no-notes', '--no-ext-diff', '--no-textconv',
      '--encoding=UTF-8', '--format=%x00%H%x00%an%x00%cI%x00%s', '--max-count=' + count, head, '--', repoPath,
    ], { timeout: 12_000, maxBuffer: historyMaxBuffer });
  } catch (error) {
    if (error.killed) throw new Error('读取 Git 提交历史超时。', { cause: error });
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('提交历史过长，无法继续读取。', { cause: error });
    throw new Error('无法读取此文档的 Git 提交历史。', { cause: error });
  }
  return parseHistory(output, repoPath);
}

function historyOffset(cursor, head) {
  if (cursor == null) return 0;
  const match = typeof cursor === 'string' && /^([0-9a-f]{40}(?:[0-9a-f]{24})?):(\d{1,8})$/.exec(cursor);
  if (!match || +match[2] < 1 || +match[2] % pageSize !== 0) throw new Error('提交历史分页位置无效。');
  if (match[1] !== head) throw new Error('当前 Git 版本已变化，请重新打开提交历史。');
  return +match[2];
}

async function listGitDocumentHistory({ documentPath, cursor } = {}) {
  const context = await gitDocumentContext(documentPath, { allowOutsideRepository: true });
  if (!context) return { status: 'not-repository', entries: [], nextCursor: null };
  const head = await currentHead(context.runGit);
  const offset = historyOffset(cursor, head);
  if (!head) return { status: 'empty', entries: [], nextCursor: null };

  // With --follow, Git's --skip counts unrelated commits as well as this file's history.
  const revisions = await history(context, head, offset + pageSize + 1);
  const entries = revisions.slice(offset, offset + pageSize).map(({ blob, path, ...entry }) =>
    path === context.repoPath ? entry : { ...entry, path });
  return { status: revisions.length ? 'ready' : 'empty', entries,
    nextCursor: revisions.length > offset + pageSize ? `${head}:${offset + pageSize}` : null };
}

async function readGitDocumentRevision({ documentPath, commit } = {}) {
  if (typeof commit !== 'string' || !objectId.test(commit)) throw new Error('所选 Git 提交无效。');
  const context = await gitDocumentContext(documentPath);
  const head = await currentHead(context.runGit);
  if (head) {
    for (let count = pageSize + 1; ; count *= 2) {
      const revisions = await history(context, head, count);
      const selected = revisions.find(entry => entry.commit === commit);
      if (selected) {
        if (!selected.available) throw new Error('这次提交删除了文档，或文档在该版本中不是普通文件。');
        return readGitBlob(context.runGit, selected.blob, `${commit.slice(0, 8)} · ${selected.subject || '无提交说明'}`);
      }
      if (revisions.length < count) break;
    }
  }
  throw new Error('这次提交不在当前文档的 Git 历史中。');
}

module.exports = { listGitDocumentHistory, readGitDocumentRevision };
