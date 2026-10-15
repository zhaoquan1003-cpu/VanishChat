/** 复制到剪贴板：优先 Clipboard API，降级 execCommand（部分 WebView / 非安全上下文需要） */
export async function copyText(text) {
  const value = String(text ?? '')
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* 继续降级 */
  }

  try {
    const el = document.createElement('textarea')
    el.value = value
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.top = '-1000px'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    el.setSelectionRange(0, el.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

/** 原生分享（移动端）；不支持时返回 false 由调用方降级为复制 */
export async function shareText({ title, text, url }) {
  if (!navigator.share) return false
  try {
    await navigator.share({ title, text, url })
    return true
  } catch (err) {
    return err?.name === 'AbortError' ? true : false
  }
}

export default { copyText, shareText }
