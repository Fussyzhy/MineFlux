import type { ReactElement } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  Blocks,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Coffee,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Info,
  ListTodo,
  Minus,
  Package,
  Pause,
  Play,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  Square,
  SquareStop,
  Trash2,
  X,
  Zap,
} from 'lucide-react'

/**
 * 界面图标。
 *
 * 底层统一使用 lucide-react（https://lucide.dev），这里只是把项目里的
 * 语义名映射到具体图标，并固化统一的尺寸 / 描边规范：
 *  - 24×24 视口、线性描边、`currentColor` 着色
 *  - 描边 1.9（lucide 默认 2，略微收细在 13~16px 下更精致）
 *  - 实际显示尺寸由外层 CSS 控制（`.nav-item svg` 等）
 *
 * 需要新图标时直接从这里 lucide 列表里补充，不要再手写 SVG。
 */
const STROKE = 1.9

type IconProps = { size?: number; strokeWidth?: number }

function create(Icon: typeof Info, defaults?: IconProps) {
  return function Wrapped(props: IconProps = {}): ReactElement {
    return (
      <Icon
        size={props.size ?? 16}
        strokeWidth={props.strokeWidth ?? defaults?.strokeWidth ?? STROKE}
        aria-hidden="true"
        focusable="false"
      />
    )
  }
}

// ------------------------------------------------------------------ 基础操作
export const IconDownload = create(Download)
export const IconPause = create(Pause)
export const IconPlay = create(Play)
export const IconStop = create(SquareStop)
export const IconRefresh = create(RotateCw)
export const IconCheck = create(Check)
export const IconAlert = create(AlertTriangle)
export const IconTrash = create(Trash2)
export const IconFolder = create(Folder)
export const IconFile = create(FileText)
export const IconSearch = create(Search)
export const IconCopy = create(Copy)
export const IconExternal = create(ExternalLink)

// ------------------------------------------------------------------ 导航 / 页面语义
/** 导航「下载」：原版游戏用方块阵列 */
export const IconBlocks = create(Blocks)
/** 整合包：包裹箱 */
export const IconBox = create(Package)
/** 实例管理：立方体 */
export const IconInstance = create(Box)
/** 任务：带勾选的清单，和「下载」的四宫格明显区分 */
export const IconTasks = create(ListTodo)
/** 设置：lucide 的齿轮，语义明确，不会被看成太阳 */
export const IconSettings = create(Settings)
/** 关于 / 信息 */
export const IconInfo = create(Info)
/** 校验 / 完整性 */
export const IconShield = create(ShieldCheck)
/** Java 运行时（lucide 的咖啡杯是 Java 的通用象征） */
export const IconJava = create(Coffee)
/** 下载到本地 / 下载源 */
export const IconDownloadSource = create(ArrowDownToLine)
/** 快速 / 推荐 */
export const IconBolt = create(Zap)
/** 时间 */
export const IconClock = create(Clock)
/** 进度中 */
export const IconProgress = create(RotateCw)
/** 空状态 */
export const IconEmpty = create(Package)

// ------------------------------------------------------------------ 方向 / 窗口
export const IconMinus = create(Minus)
/** 最大化：单一方框（Windows 标题栏惯例） */
export const IconSquare = create(Square)
/** 还原：两个叠放的方框（Windows 标题栏惯例） */
export const IconRestore = create(Copy)
export const IconClose = create(X)
export const IconArrowLeft = create(ArrowLeft)
export const IconChevronRight = create(ChevronRight)
export const IconChevronDown = create(ChevronDown)
