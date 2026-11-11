import { useEffect, useRef, useState } from 'react'
import { desktop } from './desktop.js'

const systemSans = '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
const systemSerif = '"Songti SC", "Noto Serif CJK SC", "SimSun", Georgia, serif'
const systemMono = '"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace'

export const FONT_ROLES = [
  { id: 'bodyFont', label: '正文与标题', defaultId: 'source-serif', fallback: systemSerif },
  { id: 'sourceFont', label: '源码与代码', defaultId: 'jetbrains', fallback: systemMono },
  { id: 'uiFont', label: '菜单与界面', defaultId: 'inter', fallback: systemSans },
]

export const BUILT_IN_FONTS = [
  { id: 'inter', name: 'Inter', family: '"Inter", "Noto Sans SC"' },
  { id: 'source-serif', name: 'Source Serif 4', family: '"Source Serif 4", "Noto Serif SC"' },
  { id: 'jetbrains', name: 'JetBrains Mono', family: '"JetBrains Mono", "Noto Sans SC"' },
  { id: 'noto-sans-sc', name: 'Noto Sans SC', family: '"Noto Sans SC"' },
  { id: 'noto-serif-sc', name: 'Noto Serif SC', family: '"Noto Serif SC"' },
]

export const FONT_DEFAULTS = Object.fromEntries(FONT_ROLES.map(role => [role.id, role.defaultId]))
const importedPrefix = 'imported:'
export const importedFontId = id => importedPrefix + id
const familyForImport = id => 'Sujian Imported ' + id
const validId = /^[a-f0-9]{64}$/

export function fontStack(roleId, selection, imported) {
  const role = FONT_ROLES.find(item => item.id === roleId)
  if (selection === 'system') return role.fallback
  const selectedImport = imported.find(font => importedFontId(font.id) === selection)
  if (selectedImport && validId.test(selectedImport.id)) {
    return '"' + familyForImport(selectedImport.id) + '", "Noto Sans SC", ' + role.fallback
  }
  const preset = BUILT_IN_FONTS.find(font => font.id === selection) ??
    BUILT_IN_FONTS.find(font => font.id === role.defaultId)
  return preset.family + ', ' + role.fallback
}

export function useFonts(notify) {
  const [imported, setImported] = useState([])
  const [unavailable, setUnavailable] = useState([])
  const faces = useRef(new Map())

  useEffect(() => {
    if (!desktop.listFonts) return
    let active = true
    desktop.listFonts().then(list => { if (active) setImported(list) })
      .catch(error => { if (active) notify('无法读取本地字体。' + error.message, true) })
    return () => { active = false }
  }, [notify])

  useEffect(() => {
    let active = true
    const ids = new Set(imported.map(font => font.id))
    for (const [id, face] of faces.current) {
      if (!ids.has(id)) {
        document.fonts.delete(face)
        faces.current.delete(id)
      }
    }
    const load = async font => {
      if (faces.current.has(font.id)) return null
      try {
        const url = new URL(font.url, document.baseURI)
        if (!validId.test(font.id) || url.protocol !== 'sujian-app:' || url.hostname !== 'editor' ||
            !new RegExp('^/user-fonts/' + font.id + '\\.(ttf|otf|woff2?)$').test(url.pathname)) return font.id
        const face = new FontFace(familyForImport(font.id), 'url("' + url.href + '")')
        await face.load()
        if (active) {
          document.fonts.add(face)
          faces.current.set(font.id, face)
        }
        return null
      } catch {
        return font.id
      }
    }
    Promise.all(imported.map(load)).then(failed => { if (active) setUnavailable(failed.filter(Boolean)) })
    return () => { active = false }
  }, [imported])

  useEffect(() => () => {
    for (const face of faces.current.values()) document.fonts.delete(face)
    faces.current.clear()
  }, [])

  return {
    imported, unavailable, canImport: !!desktop.importFonts,
    async importFonts() {
      const result = await desktop.importFonts()
      setImported(result.fonts)
      return result
    },
    async removeFont(id) {
      setImported(await desktop.removeFont(id))
    },
  }
}
