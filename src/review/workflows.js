export const workflowTemplates = [
  {
    name: '规格与验收',
    description: '创建规格、实施计划和任务文档，使用编号关联验收项和证据。',
    documents: [
      { name: 'spec.md', text: [
        '# 需求规格', '', '## 背景', '', '说明这次要解决的问题和影响范围。', '',
        '## REQ-001 验收条件', '', '写下一个可验证的预期结果。', '',
      ].join('\n') },
      { name: 'plan.md', text: [
        '# 实施计划', '', '## 规格', '', '[需求规格](spec.md)', '',
        '## 实施步骤', '', '1. 说明要调整的行为。', '2. 写下验证方式和回退条件。', '',
        '## 任务', '', '[任务与验收](tasks.md)', '',
      ].join('\n') },
      { name: 'tasks.md', text: [
        '# 任务与验收', '', '## TASK-001 实现与验证', '',
        '- 验收项：REQ-001', '- 证据：待填写', '- [ ] 完成验证', '',
      ].join('\n') },
    ],
  },
  {
    name: '纪要与跟进',
    description: '记录决定、待办和未决问题，给需要核对的结论附上来源。',
    documents: [
      { name: '会议纪要.md', text: [
        '# 会议纪要', '', '## 决定', '', '- 待确认', '',
        '## 待办', '', '| 行动 | 负责人 | 截止日期 | 来源 |', '| --- | --- | --- | --- |',
        '| 待确认 | 待确认 | 待确认 | 待补充 |', '',
        '## 未决问题', '', '- 待确认', '',
      ].join('\n') },
    ],
  },
]

function pathParts(value) {
  if (typeof value !== 'string' || !value) return null
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(value)
  const path = windows ? value.replaceAll('\\', '/') : value
  const root = path.match(windows ? /^(?:[a-z]:|\/\/[^/]+\/[^/]+)\//i : /^\//)?.[0]
  if (!root) return null
  const parts = path.slice(root.length).split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..')) return null
  return { root, parts, windows }
}

export function relativeSourcePath(from, to) {
  const source = pathParts(from)
  const target = pathParts(to)
  if (!source || !target || source.windows !== target.windows) return null
  const key = value => source.windows ? value.toLowerCase() : value
  if (key(source.root) !== key(target.root)) return null
  const directory = source.parts.slice(0, -1)
  let same = 0
  while (same < directory.length && same < target.parts.length - 1 && key(directory[same]) === key(target.parts[same])) same++
  const escaped = target.parts.slice(same).map(part => encodeURIComponent(part).replace(/[!'()*]/g, character =>
    '%' + character.charCodeAt(0).toString(16).toUpperCase()))
  return [...Array(directory.length - same).fill('..'), ...escaped].join('/')
}

export function sourceLine(anchor) {
  const match = /^L([1-9]\d{0,8})(?:-L[1-9]\d{0,8})?$/i.exec(anchor ?? '')
  return match ? Number(match[1]) : null
}

function headingsAndFields(document) {
  const entries = []
  let section = null
  let fence = null
  for (const [index, line] of document.text.split(/\r\n|\n|\r/).entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (marker) { fence = marker[1]; continue }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line)
    if (heading) {
      if (section && heading[1].length <= section.level) section = null
      const id = /^(REQ|TASK)-\d{3,}\b/.exec(heading[2])?.[0]
      if (id) {
        section = { id, docId: document.id, name: document.name, line: index + 1, level: heading[1].length, requirements: [], evidence: [] }
        entries.push(section)
      }
      continue
    }
    if (!section?.id.startsWith('TASK-')) continue
    const field = /^ {0,3}[-*+][ \t]+(验收项|证据)[：:][ \t]*(.*)$/.exec(line)
    if (field?.[1] === '验收项') section.requirements.push(...field[2].match(/\bREQ-\d{3,}\b/g) ?? [])
    if (field?.[1] === '证据') section.evidence.push(field[2])
  }
  return entries
}

export function inspectSpecs(documents) {
  const entries = documents.flatMap(headingsAndFields)
  const issues = []
  const byId = new Map()
  const covered = new Set()
  const issue = (entry, message) => issues.push({ docId: entry.docId, name: entry.name, line: entry.line, message })
  for (const entry of entries) {
    if (byId.has(entry.id)) issue(entry, '编号重复 · ' + entry.id)
    else byId.set(entry.id, entry)
  }
  for (const task of entries.filter(entry => entry.id.startsWith('TASK-'))) {
    if (!task.requirements.length) issue(task, task.id + ' 缺少验收项编号')
    for (const reference of new Set(task.requirements)) {
      if (byId.has(reference)) covered.add(reference)
      else issue(task, task.id + ' 引用了未找到的 ' + reference)
    }
    const link = /\[[^\]\n]+\]\((?:<[^>\n]+>|[^)\s]+)\)/
    if (!task.evidence.some(value => link.test(value) && !/\]\(\s*#\s*\)/.test(value))) {
      issue(task, task.id + ' 缺少测试证据链接')
    }
  }
  for (const requirement of entries.filter(entry => entry.id.startsWith('REQ-'))) {
    if (!covered.has(requirement.id)) issue(requirement, requirement.id + ' 尚未关联任务')
  }
  return { count: entries.length, issues }
}
