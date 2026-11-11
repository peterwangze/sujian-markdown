import { useState } from 'react'
import { Check, Upload, Trash2 } from 'lucide-react'
import { THEME_OPTIONS } from '../theme/themes.js'
import { BUILT_IN_FONTS, FONT_ROLES, fontStack, importedFontId } from '../workspace/fonts.js'
import { IconButton } from './Controls.jsx'

export function ThemeSettings({ settings, configure }) {
  return <>
    <div className="settings-label" id="settings-themes-label">主题</div>
    <div className="theme-grid" role="group" aria-labelledby="settings-themes-label">
      {THEME_OPTIONS.map(theme => <button key={theme.id} type="button" className="theme-choice"
        title={theme.description} aria-label={theme.name} aria-pressed={settings.theme === theme.id}
        onClick={() => configure({ theme: theme.id })}
        style={{
          '--swatch-canvas': theme.colors.canvas, '--swatch-ink': theme.colors.ink,
          '--swatch-chrome': theme.colors.chrome, '--swatch-accent': theme.colors.accent,
          '--swatch-border': theme.colors.border,
        }}>
        <div className="theme-swatch" aria-hidden="true"><span>Aa</span><i/><i/></div>
        <span className="theme-name">{theme.name}{settings.theme === theme.id && <Check size={14} aria-hidden="true"/>}</span>
      </button>)}
    </div>
    <label className="setting"><span>文档宽度</span><input type="range" min="520" max="1160" step="10"
      value={settings.width} onChange={event => configure({ width: +event.target.value })}/><output>{settings.width} px</output></label>
    <details className="theme-custom">
      <summary>自定义主题 CSS</summary>
      <label className="text-setting">样式表
        <textarea rows="4" spellCheck="false" value={settings.customCss} onChange={event => configure({ customCss: event.target.value })}
          placeholder="#write h1 { font-weight: 700; }"/>
      </label>
      <label className="small-button file-label">导入 CSS<input type="file" accept=".css,text/css" onChange={async event => {
        const file = event.target.files[0]
        if (file) configure({ customCss: await file.text() })
      }}/></label>
    </details>
  </>
}

export function FontSettings({ settings, configure, fonts }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const available = fonts.imported.filter(font => !fonts.unavailable.includes(font.id))

  async function update(action) {
    setBusy(true)
    setNotice(null)
    try {
      const text = await action()
      if (text) setNotice({ text })
    } catch (error) {
      setNotice({ text: error.message, error: true })
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="font-sample" style={{ '--sample-font': fontStack('bodyFont', settings.bodyFont, available) }}>
      <strong>写下今天的想法</strong>
      <p>Markdown 让文字、结构和格式各就其位。</p>
      <code>const note = '你好，Markdown'</code>
    </div>
    {FONT_ROLES.map(role => <label className="setting" key={role.id}>
      <span>{role.label}</span>
      <select aria-label={role.label} value={available.some(font => importedFontId(font.id) === settings[role.id]) ||
        BUILT_IN_FONTS.some(font => font.id === settings[role.id]) || settings[role.id] === 'system' ? settings[role.id] : role.defaultId}
        onChange={event => configure({ [role.id]: event.target.value })}>
        <option value="system">系统默认</option>
        <optgroup label="内置字体">
          {BUILT_IN_FONTS.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}
        </optgroup>
        {!!available.length && <optgroup label="本地导入">
          {available.map(font => <option key={font.id} value={importedFontId(font.id)}>{font.name}</option>)}
        </optgroup>}
      </select>
    </label>)}
    <label className="setting"><span>正文字号</span><input type="range" min="13" max="28"
      value={settings.fontSize} onChange={event => configure({ fontSize: +event.target.value })}/><output>{settings.fontSize} px</output></label>
    <label className="setting"><span>正文行距</span><input type="range" min="1.3" max="2.2" step=".02"
      value={settings.lineHeight} onChange={event => configure({ lineHeight: +event.target.value })}/><output>{settings.lineHeight.toFixed(2)}</output></label>
    {fonts.canImport && <div className="font-library">
      <div className="font-library-header"><strong>本地字体</strong>
        <button className="small-button font-import" type="button" disabled={busy} onClick={() => void update(async () => {
          const { imported, skipped = [] } = await fonts.importFonts()
          const result = imported ? '已导入 ' + imported + ' 个字体。' : ''
          const errors = skipped.map(item => item.name + ' · ' + item.reason)
          return [result, ...errors].filter(Boolean).join(' ')
        })}><Upload size={15}/> 导入字体</button>
      </div>
      {fonts.imported.map(font => <div className="font-library-row" key={font.id}>
        <span>{font.name} {fonts.unavailable.includes(font.id) && <small>无法载入</small>}</span>
        <IconButton icon={Trash2} label={'移除字体 ' + font.name} disabled={busy} onClick={() => void update(async () => {
          await fonts.removeFont(font.id)
          configure(previous => Object.fromEntries(FONT_ROLES.filter(role => previous[role.id] === importedFontId(font.id))
            .map(role => [role.id, role.defaultId])))
          return '已从素笺移除 ' + font.name
        })}/>
      </div>)}
      {!fonts.imported.length && <small>支持 TTF、OTF、WOFF 和 WOFF2。</small>}
    </div>}
    {notice && <p className={notice.error ? 'form-error' : 'modal-detail'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
  </>
}
