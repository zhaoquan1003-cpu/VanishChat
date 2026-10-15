import { EventEmitter } from 'node:events'

/**
 * 进程内事件总线。
 * 解耦「探测到过期/销毁」与「WebSocket 广播 / 物理文件删除」，
 * 让 sweeper、HTTP 层、Socket 层互不直接依赖。
 *
 * 事件：
 *   session:destroyed  { token, reason }       会话已被彻底销毁
 *   session:tick       { token, expireAt }     会话有效期被续期
 *   member:joined      { token, participant }  成员加入
 *   member:left        { token, participant }  成员离开
 */
export const bus = new EventEmitter()
bus.setMaxListeners(100)

export default bus
