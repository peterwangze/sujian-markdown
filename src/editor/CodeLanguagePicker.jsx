import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { isComposingKey } from '../workspace/commands.js';
import './code-language-picker.css';

const languages = [
  ['', '纯文本', 'plain plaintext text txt none'],
  ['javascript', 'JavaScript', 'js jsx mjs cjs node'],
  ['typescript', 'TypeScript', 'ts tsx mts cts'],
  ['python', 'Python', 'py python3'],
  ['bash', 'Bash / Shell', 'sh zsh shell terminal 命令行'],
  ['json', 'JSON', 'jsonc'],
  ['yaml', 'YAML', 'yml'],
  ['html', 'HTML / XML', 'xml xhtml svg markup'],
  ['css', 'CSS', 'stylesheet'],
  ['markdown', 'Markdown', 'md mdx'],
  ['sql', 'SQL', 'mysql postgresql sqlite'],
  ['diff', 'Diff', 'patch git'],
  ['mermaid', 'Mermaid 图表', 'diagram 流程图'],
  ['java', 'Java', ''],
  ['c', 'C', 'h'],
  ['cpp', 'C++', 'c++ cc cxx hpp'],
  ['csharp', 'C#', 'cs c# dotnet'],
  ['go', 'Go', 'golang'],
  ['rust', 'Rust', 'rs'],
  ['kotlin', 'Kotlin', 'kt kts'],
  ['swift', 'Swift', ''],
  ['ruby', 'Ruby', 'rb'],
  ['php', 'PHP', ''],
  ['powershell', 'PowerShell', 'ps ps1 pwsh'],
  ['dockerfile', 'Dockerfile', 'docker'],
  ['toml', 'TOML', 'ini'],
  ['lua', 'Lua', ''],
  ['r', 'R', 'rscript'],
  ['perl', 'Perl', 'pl'],
  ['scala', 'Scala', ''],
  ['graphql', 'GraphQL', 'gql'],
  ['makefile', 'Makefile', 'make'],
  ['regex', '正则表达式', 'regexp regular expression'],
].map(([token, label, aliases]) => ({ token, label, terms: [token, label.toLowerCase(), ...aliases.split(' ')] }));

const tokenPattern = /^[a-z0-9_][a-z0-9_+.#-]{0,39}$/i;

function matchLanguages(query, current) {
  if (!query) return tokenPattern.test(current) && !languages.some(item => item.token === current)
    ? [{ token: current, label: current, terms: [] }, ...languages] : languages;
  const needle = query.toLowerCase();
  const exact = languages.filter(language => language.terms.includes(needle));
  const partial = languages.filter(language => !exact.includes(language) && language.terms.some(term => term.includes(needle)));
  const custom = exact.length || !tokenPattern.test(query) ? [] : [{ token: query, label: `使用「${query}」`, terms: [] }];
  return [...exact, ...partial, ...custom];
}

export function CodeLanguagePicker({ language, onApply, onClose }) {
  const [query, setQuery] = useState('');
  const [selectedToken, setSelectedToken] = useState(null);
  const listId = useId();
  const input = useRef(null);
  const list = useRef(null);
  const current = language?.trim() ?? '';
  const canonical = languages.find(item => item.terms.includes(current.toLowerCase()))?.token ?? current;
  const trimmed = query.trim();
  const matches = matchLanguages(trimmed, canonical);
  const initial = !trimmed ? canonical : null;
  const index = Math.max(0, matches.findIndex(item => item.token === (selectedToken ?? initial)));
  const selected = matches[index];
  const optionId = selected ? `${listId}-language-${index}` : undefined;

  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [optionId, selected?.token]);

  function handleKey(event) {
    if (isComposingKey(event.nativeEvent) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key === 'Enter' && selected) {
      event.preventDefault();
      event.stopPropagation();
      onApply(selected.token);
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
      event.preventDefault();
      event.stopPropagation();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedToken(matches[(index + offset + matches.length) % matches.length].token);
    }
  }

  return <div className="code-language-picker" role="dialog" aria-label="代码块语言">
    <div className="code-language-search">
      <Search size={16} aria-hidden="true"/>
      <input ref={input} type="text" role="combobox" aria-label="搜索代码语言" aria-autocomplete="list"
        aria-expanded={Boolean(matches.length)} aria-controls={listId} aria-activedescendant={optionId}
        spellCheck={false} autoComplete="off" placeholder="搜索或输入语言" value={query}
        onChange={event => { setQuery(event.target.value); setSelectedToken(null); }} onKeyDown={handleKey}/>
    </div>
    <ul className="code-language-options" role="listbox" id={listId} ref={list} aria-label="代码语言选项" hidden={!matches.length}>
      {matches.map((item, position) => <li role="option" id={`${listId}-language-${position}`} key={item.token}
        aria-selected={selected?.token === item.token} onMouseDown={event => event.preventDefault()}
        onPointerMove={() => setSelectedToken(item.token)} onClick={() => onApply(item.token)}>
        <span>{item.label}</span>
        {item.terms.length > 0 && item.token && <code>{item.token}</code>}
        {item.token === canonical && <Check size={14} aria-label="当前语言"/>}
      </li>)}
    </ul>
    {!matches.length && <p className="code-language-empty" role="status">语言标记支持字母、数字和 +、#、.、-、_。</p>}
  </div>;
}
