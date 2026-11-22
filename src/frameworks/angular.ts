/**
 * Angular 薄封装：不 import @angular/core。
 *
 * 核心是「指令的纯对象形态」createWorkspaceDirective()：用 WeakMap 为每个宿主元素保存一个
 * controller，mounted 建、updated 增量 update、unmounted destroy + delete。可直接注册进
 * declarations / standalone imports，或由一层薄 @Directive 类转发生命周期钩子：
 *   const directive = createWorkspaceDirective();
 *   ngAfterViewInit() { directive.mounted(this.ref.nativeElement, this.props); }
 *   ngOnChanges()     { directive.updated(this.ref.nativeElement, this.props); }
 *   ngOnDestroy()     { directive.unmounted(this.ref.nativeElement); }
 *
 * 另有 createAngularWorkspace(ng)（= createAngularDirective 别名）：注入式工厂，返回一个带
 * ngOnInit / ngOnChanges / ngOnDestroy 的指令类骨架，钩子已接好上面的 WeakMap 指令对象；
 * 若传入 ng.Directive 装饰器，则顺带把 selector 打到类上（不传则退化为纯类工厂）。
 *
 * 全程只用 EventTarget / WeakMap，不碰 document / window / customElements，SSR 可安全 import。
 */
import { createWorkspaceController } from './controller';
import type { WorkspaceProps, WorkspaceHost, WorkspaceController } from './controller';

// —— 面向 <stock-workspace> 的内核 re-export（值 / 类型分离，满足 verbatimModuleSyntax）——
export {
  createWorkspaceController, bindWorkspace, mountWorkspace,
  camelToEventName, diffConfig, WORKSPACE_EVENT_NAMES,
} from './controller';
export type {
  WorkspaceProps, WorkspaceController, WorkspaceHost, WorkspaceEventMap,
  WorkspaceEventName, WorkspaceEventHandler,
} from './controller';

/** Angular 指令的纯对象形态（不引用 @angular/core 的任何类型） */
export interface WorkspaceDirective {
  /** 指令选择器（如 '[stockWorkspace]'），纯元信息，可省略 */
  selector?: string;
  /** 挂载：为该元素建 controller（已存在则先销毁旧的） */
  mounted(el: WorkspaceHost, props?: WorkspaceProps): void;
  /** 属性变化：增量 update（内核做 diff，不全量解绑重绑） */
  updated(el: WorkspaceHost, props?: WorkspaceProps): void;
  /** 卸载：destroy 并从 WeakMap 移除 */
  unmounted(el: WorkspaceHost): void;
}

/**
 * 创建指令对象。内部用 WeakMap<WorkspaceHost, WorkspaceController> 管理每个元素，
 * 元素被 GC 时条目自动释放，无需挂在元素上的自定义字段。
 */
export function createWorkspaceDirective(): WorkspaceDirective {
  const controllers = new WeakMap<WorkspaceHost, WorkspaceController>();
  return {
    selector: '[stockWorkspace]',
    mounted(el: WorkspaceHost, props: WorkspaceProps = {}): void {
      controllers.get(el)?.destroy();
      const controller = createWorkspaceController(el, props);
      if (controller) controllers.set(el, controller);
    },
    updated(el: WorkspaceHost, props: WorkspaceProps = {}): void {
      controllers.get(el)?.update(props);
    },
    unmounted(el: WorkspaceHost): void {
      controllers.get(el)?.destroy();
      controllers.delete(el);
    },
  };
}

type AngularClassDecorator = (target: unknown) => void;
type AngularPropertyDecorator = (target: unknown, key: string) => void;

/** 注入式工厂依赖的最小 Angular 兼容接口（不 import @angular/core） */
export interface AngularLike {
  /** @Directive(meta) 返回的「类装饰器」；缺省时工厂退化为不带装饰器的纯类 */
  Directive?: (meta: Record<string, unknown>) => AngularClassDecorator;
  /** @Input() 返回的「属性装饰器」（占位，工厂不实例化输入） */
  Input?: (...args: unknown[]) => AngularPropertyDecorator;
  /** ElementRef / OnDestroy 仅作为注入/实现 token 描述，工厂不实例化它们 */
  ElementRef?: unknown;
  OnDestroy?: unknown;
}

/** Angular ElementRef 的最小形态（不 import @angular/core） */
export interface ElementRefLike {
  nativeElement: WorkspaceHost;
}

/**
 * 注入式组件/指令工厂（简化版）：返回带 ngOnInit / ngOnChanges / ngOnDestroy 的类。
 * 生命周期钩子转发到 createWorkspaceDirective() 管理的 WeakMap controller：
 *  - ngOnInit / ngOnChanges：读 this.props 做增量 update（首次由 ngOnInit 建 controller）；
 *  - ngOnDestroy：unmounted 解绑并释放。
 * 宿主元素可通过构造函数传入 ElementRefLike，或由外层 @Directive 包装把 nativeElement 赋给 this.el；
 * this.props 由外层通过 @Input() 绑定写入。ng.Directive 存在时把 selector 装饰器应用到类上。
 */
export function createAngularWorkspace(ng: AngularLike): unknown {
  const directive = createWorkspaceDirective();

  class WorkspaceAngularDirective {
    /** 宿主元素（通常由 ElementRef.nativeElement 注入，或由外层包装赋值） */
    el: WorkspaceHost | null = null;
    /** @Input() 绑定的 props */
    props: WorkspaceProps = {};

    constructor(elementRef?: ElementRefLike) {
      if (elementRef) this.el = elementRef.nativeElement;
    }

    ngOnInit(): void {
      if (this.el) directive.mounted(this.el, this.props);
    }

    ngOnChanges(): void {
      if (this.el) directive.updated(this.el, this.props);
    }

    ngOnDestroy(): void {
      if (this.el) directive.unmounted(this.el);
    }
  }

  if (typeof ng.Directive === 'function') {
    ng.Directive({ selector: directive.selector })(WorkspaceAngularDirective);
  }
  return WorkspaceAngularDirective;
}

/** createAngularWorkspace 的语义化别名（返回一个带生命周期钩子的指令类工厂） */
export const createAngularDirective = createAngularWorkspace;
