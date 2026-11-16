import { useCallback, useEffect, useRef, useState } from 'react'
import { desktop } from '../workspace/desktop.js'
import { Modal } from './Controls.jsx'

export function useUpdateInstall({ ready, unsavedForUpdate, prepareUpdateExit }, notify) {
  const [step, setStep] = useState(null)
  const request = useRef(null)
  const safeFocus = useRef(null)

  useEffect(() => desktop.onUpdateInstallState?.(({ id, phase }) => {
    if (phase === 'hold') {
      request.current = id
      setStep({ id, phase })
    } else if (request.current === id) {
      if (phase === 'done') request.current = null
      setStep(phase === 'done' ? null : { id, phase })
    }
  }), [])

  const respond = useCallback(async (id, status, message) => {
    if (request.current !== id) return
    try {
      await desktop.respondToUpdateInstall(id, status, message)
    } catch (error) {
      if (request.current === id) {
        request.current = null
        setStep(null)
        notify(error.message, true)
      }
    }
  }, [notify])

  const finishPreparation = useCallback(async (id, saveChanges) => {
    try {
      const prepared = await prepareUpdateExit(saveChanges, () => request.current === id)
      if (request.current !== id) return
      if (prepared) setStep({ id, phase: 'ready' })
      await respond(id, prepared ? 'ready' : 'cancelled')
    } catch (error) {
      await respond(id, 'error', error.message)
    }
  }, [prepareUpdateExit, respond])

  useEffect(() => {
    if (step?.phase !== 'prepare') return
    const { id } = step
    if (!ready) {
      void respond(id, 'error', '有窗口仍在加载文档，请稍后重试。')
      return
    }
    unsavedForUpdate().then(documents => {
      if (request.current !== id) return
      if (documents.length) {
        setStep({ id, phase: 'confirm', documents })
        void respond(id, 'needs-save')
      } else void finishPreparation(id, false)
    }).catch(error => respond(id, 'error', error.message))
  }, [step, ready, unsavedForUpdate, finishPreparation, respond])

  const saving = step?.phase === 'saving'
  const confirm = step?.phase === 'confirm'
  const cancel = () => { if (step && !saving) void respond(step.id, 'cancelled') }

  const dialog = step && <Modal key={confirm || saving ? 'confirm-update' : 'hold-update'}
    title={confirm || saving ? '安装前保存文档' : '准备安装更新'} onClose={cancel} initialFocusRef={safeFocus}>
    {confirm || saving ? <>
      <p className="modal-detail">保存下列文档后，素笺将关闭并启动安装。</p>
      <ul className="update-unsaved-files">{step.documents.map(doc => <li key={doc.id}>{doc.name}</li>)}</ul>
    </> : <p className="modal-detail" role="status">{step.phase === 'ready' ? '文档已准备就绪，等待启动安装。' : '正在检查未保存的文档…'}</p>}
    {saving && <p role="status">正在保存文档…</p>}
    <footer>
      <button type="button" ref={safeFocus} disabled={saving} onClick={cancel}>取消</button>
      {(confirm || saving) && <button type="button" className="primary" disabled={saving} onClick={() => {
        setStep({ ...step, phase: 'saving' })
        void finishPreparation(step.id, true)
      }}>保存并安装</button>}
    </footer>
  </Modal>

  return { preparing: Boolean(step), dialog }
}
