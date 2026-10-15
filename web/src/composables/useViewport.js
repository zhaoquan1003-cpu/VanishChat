import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 移动端视口 / 软键盘适配 —— 三大痛点的第一痛点。
 *
 * 写进 :root 的三个变量：
 *   --app-height = 应用外壳该有多高（可视区高度）
 *   --kb-offset  = 外壳需要在视觉上向下平移多少（iOS 系键盘弹出时浏览器会把
 *                  可视视口在页面里平移，外壳必须跟着走，否则整块 UI 被推走、
 *                  下面露出一大片空白）
 *   --kb-height  = 键盘大概占掉多少高度（给需要额外抬升的元素用）
 *
 * 为什么不能只取 visualViewport.height（血泪教训）：
 *   Chrome iOS 在键盘弹出时会把 visualViewport.height 报得明显偏小
 *   （实测 390×844 机型只剩几十像素），而真正的可视区还有 300 多像素。
 *   若照单全收，外壳会被压成一条，输入框孤零零浮在屏幕上半部、下方全是空白。
 *   因此高度按可信度择优：
 *     1) 浏览器自己缩小了布局视口（innerHeight 明显变小，如安卓
 *        interactive-widget=resizes-content、Chrome iOS）→ 布局视口就是可视区；
 *     2) visualViewport.height 小到不合常理（< 140px 且不足布局视口的 30%）时
 *        判为不可信，退回 innerHeight；
 *     3) 两者都可信时取较大值，杜绝"被一个偏小的数字压成一条"。
 *   平移量（--kb-offset）只在外壳高度确实等于可视区高度、且布局视口没被缩小时
 *   才跟随，并再按"文档实际能被平移掉的空间"钳制，避免把外壳整块推下去。
 */
const MIN_SANE_HEIGHT = 120
/** 键盘动画期间个别浏览器不发事件，focus 后短暂轮询兜底 */
const WATCH_MS = 150
const WATCH_TICKS = 8

/**
 * 真机排查用：地址上加 ?debug=1 打开读数浮层。
 * 注意本项目用的是 hash 路由，参数多半落在 # 后面（…/#/chat/xxx?debug=1），
 * 所以 search 和 hash 都要看一眼。
 */
export const DEBUG_ENABLED = /(^|[?&])debug(=|&|$)/.test(
  `${typeof location === 'undefined' ? '' : location.search}&${
    typeof location === 'undefined' ? '' : location.hash
  }`,
)

export function useViewport() {
  const isKeyboardOpen = ref(false)
  const keyboardHeight = ref(0)
  const viewportHeight = ref(0)
  /** ?debug=1 时在页面角落显示实时读数，方便真机排查 */
  const debugInfo = ref(null)
  const listeners = new Set()

  const debugEnabled = DEBUG_ENABLED

  let baselineHeight = 0
  let watchTimer = null

  const apply = () => {
    const root = document.documentElement
    const vv = window.visualViewport
    const innerHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || 0)
    const scrollTop = Math.round(window.scrollY || window.pageYOffset || 0)

    if (innerHeight > baselineHeight) baselineHeight = innerHeight

    let height = innerHeight
    let pan = 0
    let kb = 0
    let source = 'innerHeight'

    if (vv) {
      const vvHeight = Math.max(0, Math.round(vv.height))
      // 浏览器是否自己把布局视口缩小了（键盘的"挤占"直接体现在 innerHeight 上）
      const resized = baselineHeight - innerHeight > 60
      // visualViewport 的可信度：过小说明这个数字不可用（Chrome iOS 已知会报出几十像素）
      const trustworthy = vvHeight >= Math.max(140, innerHeight * 0.3)

      if (trustworthy) {
        // 布局视口也被浏览器缩小了 → 两者都可信，取较大值（宁可算高，不能压成一条）
        height = resized ? Math.max(innerHeight, vvHeight) : vvHeight
        // 只有"外壳高度==可视区高度"时跟随可视视口平移才有意义；
        // 布局视口被缩小的情况下，浏览器的滚动/平移交给它自己，跟着走容易把输入框顶出去
        if (!resized) pan = Math.max(0, Math.round(vv.offsetTop) - scrollTop)
        source = resized ? 'max(innerHeight,vv)' : 'visualViewport'
      } else {
        source = resized ? 'innerHeight(resized)' : 'innerHeight(vv-untrusted)'
      }
      kb = Math.max(0, innerHeight - vvHeight)
    }

    height = Math.max(MIN_SANE_HEIGHT, height)

    // 只有"文档比可视区高出来的部分"才可能被浏览器平移掉，超出即视为脏数据
    const docHeight = Math.max(
      height,
      root.scrollHeight || 0,
      document.body ? document.body.scrollHeight : 0,
    )
    pan = Math.min(pan, Math.max(0, docHeight - height))

    root.style.setProperty('--app-height', `${height}px`)
    root.style.setProperty('--kb-offset', `${pan}px`)
    root.style.setProperty('--kb-height', `${kb}px`)

    const opened = kb > 80
    if (opened !== isKeyboardOpen.value) {
      isKeyboardOpen.value = opened
      listeners.forEach((fn) => fn(opened, kb))
    }
    keyboardHeight.value = kb
    viewportHeight.value = height

    if (debugEnabled) {
      debugInfo.value = {
        innerHeight,
        vvHeight: vv ? Math.round(vv.height) : -1,
        vvOffsetTop: vv ? Math.round(vv.offsetTop) : -1,
        scale: vv ? Number(vv.scale.toFixed(2)) : -1,
        baseline: baselineHeight,
        docHeight,
        height,
        pan,
        kb,
        source,
      }
    }
  }

  let raf = 0
  const schedule = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      apply()
    })
  }

  /** 键盘弹出/收起后的短暂轮询：某些机型只发一次事件，跟不上布局变化 */
  const startWatch = () => {
    stopWatch()
    let ticks = 0
    watchTimer = setInterval(() => {
      apply()
      ticks += 1
      if (ticks >= WATCH_TICKS) stopWatch()
    }, WATCH_MS)
  }

  const stopWatch = () => {
    if (watchTimer) {
      clearInterval(watchTimer)
      watchTimer = null
    }
  }

  const onFocusChange = () => {
    schedule()
    startWatch()
  }

  const onOrientationChange = () => {
    // 横竖屏后布局视口基准完全变了，重置基准避免误判成"键盘把视口缩小了"
    baselineHeight = 0
    schedule()
    startWatch()
  }

  onMounted(() => {
    apply()
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', onOrientationChange)
    // 某些安卓机型只发一次 focus，兜底用 focusin/focusout
    window.addEventListener('focusin', onFocusChange)
    window.addEventListener('focusout', onFocusChange)
  })

  onBeforeUnmount(() => {
    window.visualViewport?.removeEventListener('resize', schedule)
    window.visualViewport?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('orientationchange', onOrientationChange)
    window.removeEventListener('focusin', onFocusChange)
    window.removeEventListener('focusout', onFocusChange)
    if (raf) cancelAnimationFrame(raf)
    stopWatch()
  })

  /** 订阅键盘开合，返回取消订阅函数 */
  const onKeyboardToggle = (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return {
    isKeyboardOpen,
    keyboardHeight,
    viewportHeight,
    debugInfo,
    onKeyboardToggle,
    refresh: apply,
  }
}

export default useViewport
