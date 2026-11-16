import { useEffect, useRef, useState } from 'react'
import { renderPreview } from '../editor/render-document.js'
import { desktop } from '../workspace/desktop.js'
import { Modal } from './Controls.jsx'
import './about-dialog.css'

const releaseHistory = 'https://github.com/peterwangze/sujian-markdown/releases'
const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
const fileSizeFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })

function fileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${fileSizeFormat.format(bytes / (1024 * 1024))} MiB`
  if (bytes >= 1024) return `${fileSizeFormat.format(bytes / 1024)} KiB`
  return `${bytes} B`
}

function ReleaseNotes({ notes, theme }) {
  const content = useRef(null)
  useEffect(() => {
    if (!notes) return
    const target = content.current
    let active = true
    renderPreview(notes, { theme, embeddedMediaOnly: true }).then(article => {
      if (!active) return
      for (const control of article.querySelectorAll('input, button')) control.disabled = true
      target.replaceChildren(article)
    }).catch(() => {
      if (!active) return
      const fallback = document.createElement('pre')
      fallback.textContent = notes
      target.replaceChildren(fallback)
    })
    return () => { active = false; target.replaceChildren() }
  }, [notes, theme])

  return <section className="update-notes" aria-labelledby="update-notes-title">
    <h3 id="update-notes-title">更新内容</h3>
    {notes ? <div className="update-notes-content" tabIndex={0} ref={content}/> : <p>这次发布没有附带更新说明。</p>}
  </section>
}

export function AboutDialog({ open, versionLabel, theme, onClose, run }) {
  const [check, setCheck] = useState(null)
  const [download, setDownload] = useState(null)
  const checking = check?.status === 'checking'
  const downloading = download?.status === 'downloading'
  const hasUpdate = check?.status === 'update-available'
  const supportsUpdates = Boolean(desktop.checkForUpdates)

  useEffect(() => desktop.onUpdateDownloadProgress?.(progress => {
    setDownload(previous => previous?.status === 'downloading' ? { ...previous, ...progress } : previous)
  }), [])

  async function checkForUpdates() {
    setCheck({ status: 'checking' })
    setDownload(null)
    try {
      setCheck(await desktop.checkForUpdates())
    } catch {
      setCheck({ status: 'error', message: '检查更新失败，请稍后重试。' })
    }
  }

  async function downloadUpdate(asset) {
    setDownload({ status: 'downloading', downloadedBytes: 0, totalBytes: asset.size })
    try {
      setDownload(await desktop.downloadUpdate(asset.name))
    } catch {
      setDownload({ status: 'error', message: '下载失败，请稍后重试。' })
    }
  }

  function cancelDownload() {
    setDownload(previous => previous?.status === 'downloading' ? { ...previous, cancelling: true } : previous)
    run(() => desktop.cancelUpdateDownload())
  }

  if (!open) return null

  return <Modal title="关于素笺" className={'about-dialog' + (hasUpdate ? ' has-update' : '')} onClose={onClose}>
    <dl className="about-version"><dt>当前版本</dt><dd>{versionLabel || '暂未取得版本信息'}</dd></dl>
    {checking && <p className="update-message" role="status">正在检查更新…</p>}
    {check?.status === 'up-to-date' && <p className="update-message" role="status">当前已是最新版</p>}
    {check?.status === 'ahead' && <p className="update-message" role="status">当前版本高于最新正式版 v{check.latestVersion}</p>}
    {check?.status === 'error' && <p className="update-message update-error" role="alert">{check.message}</p>}
    {hasUpdate && <section className="update-result" aria-labelledby="update-result-title">
      <h3 id="update-result-title" role="status">发现新版 v{check.latestVersion}</h3>
      <ReleaseNotes notes={check.notes} theme={theme}/>
      {check.assets.length ? <ul className="update-assets" aria-label="适合当前设备的安装包">
        {check.assets.map(asset => <li key={asset.name}>
          <div><strong>{platformNames[check.platform] || '安装包'} {check.arch} · {asset.format}</strong>
            <span>{asset.name} · {fileSize(asset.size)}</span></div>
          <button type="button" className="primary" disabled={downloading} onClick={() => void downloadUpdate(asset)}>
            {check.platform === 'linux' ? `下载 ${asset.format}` : '下载安装包'}
          </button>
        </li>)}
      </ul> : <p>这个版本暂时没有适合当前设备的安装包。</p>}
      {downloading && <div className="update-progress">
        <p role="status">{download.cancelling ? '正在取消下载…' : download.downloadedBytes === download.totalBytes ? '正在校验安装包…' : '正在下载安装包…'}</p>
        <progress aria-label="下载进度" value={download.downloadedBytes} max={download.totalBytes}/>
        <div><span>{fileSize(download.downloadedBytes)} / {fileSize(download.totalBytes)}</span>
          <button type="button" className="small-button" disabled={download.cancelling} onClick={cancelDownload}>取消下载</button></div>
      </div>}
      {download?.status === 'cancelled' && <p className="update-message" role="status">已取消下载</p>}
      {download?.status === 'error' && <p className="update-message update-error" role="alert">{download.message}</p>}
      {download?.status === 'completed' && <div className="update-complete">
        <div role="status"><strong>已下载并通过校验</strong><span>{download.fileName}</span></div>
        <button type="button" className="small-button" onClick={() => run(() => desktop.showItemInFolder(download.filePath))}>打开下载位置</button>
      </div>}
    </section>}
    <footer>
      <button type="button" onClick={() => run(() => desktop.openExternal(releaseHistory))}>查看发布记录</button>
      {supportsUpdates && <button type="button" className={hasUpdate ? '' : 'primary'} disabled={checking || downloading}
        onClick={() => void checkForUpdates()}>检查更新</button>}
    </footer>
  </Modal>
}
