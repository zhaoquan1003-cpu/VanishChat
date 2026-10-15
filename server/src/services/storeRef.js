/**
 * 存储实例的轻量引用容器。
 * 用来打破 store ← services ← store 的循环依赖：
 * 启动时 createStore() 拿到实例后 set()，各 service 通过 current 读取。
 */
export const storeRef = { current: null }

export function setStore(store) {
  storeRef.current = store
  return store
}

export function getStore() {
  if (!storeRef.current) throw new Error('存储尚未初始化')
  return storeRef.current
}

export default storeRef
