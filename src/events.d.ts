/** 事件名常量表（冻结） */
export declare const CHART_EVENTS: Readonly<Record<string, string>>;
/** 统一派发：detail 恒为对象，options 默认 bubbles + composed */
export declare function emitEvent(host: EventTarget, name: string,
  detail?: unknown, options?: CustomEventInit): boolean;
